/**
 * The run, read as it happens — and picked up again if the connection drops.
 *
 * **`fetch` with a `ReadableStream`, not `EventSource`.** The browser's own SSE client can
 * only issue a GET, and starting a run is a POST carrying the charge sheet and the casting.
 * So the frames are parsed here by hand. That turns out to be the useful half of the deal:
 * `EventSource` reconnects on its own schedule and would silently re-POST nothing, whereas
 * the reconnect this file performs is the one the server was built for — a GET back to
 * `/api/run/:id/stream` from the last sequence number seen.
 *
 * **Why the reconnect is worth the code.** specs.md Part 3: a run costs seven requests out
 * of a daily allowance rationed in requests, nothing is exportable until it finishes, and
 * the run outlives the connection on the server side precisely so a moment's flakiness does
 * not destroy it. A client that gave up on the first dropped socket would waste exactly
 * what that buffer exists to protect. So: every event carries its `id:`, that number is
 * kept, and a dropped stream is resumed from it rather than restarted.
 *
 * **A refusal is not a failure to reconnect, and the difference matters.** A 400 from the
 * pre-flight means the case was rejected before a single model was called — nothing was
 * spent, and retrying would only produce the same refusal. It ends the stream immediately
 * and is reported as what it is.
 */

import type {
  JudgeView,
  PreflightEvent,
  PreflightFailure,
  RunRecordView,
  RunRequest,
  StatementView,
} from "./api.js";

export type RunEventName = "preflight" | "statement" | "judge" | "done" | "error";

export interface RunEvent {
  readonly seq: number;
  readonly event: RunEventName;
  readonly data: unknown;
}

/**
 * What the screen shows about the connection itself.
 *
 * `reconnecting` is deliberately visible rather than hidden: the run is still going on the
 * server, and a user watching four portraits stop moving deserves to be told that the
 * trial continues and the screen is catching up, not that it has stalled.
 */
export type StreamPhase = "connecting" | "live" | "reconnecting" | "closed";

export interface RunStreamHandlers {
  readonly onPreflight: (event: PreflightEvent) => void;
  readonly onStatement: (statement: StatementView) => void;
  readonly onJudge: (judge: JudgeView) => void;
  readonly onDone: (record: RunRecordView) => void;
  /** The server reporting a fault in itself. A model that failed is not this. */
  readonly onServerError: (message: string) => void;
  /** Refused before any model call: the pre-flight's failures, or a missing API key. */
  readonly onRefused: (failures: readonly PreflightFailure[], message: string | null) => void;
  /** The stream could not be resumed. The run may well still be finishing on the server. */
  readonly onLost: (message: string) => void;
  readonly onPhase: (phase: StreamPhase, attempt: number) => void;
}

/** Start a new trial, or rejoin one already in flight by its identifier. */
export type RunSource =
  | { readonly kind: "start"; readonly request: RunRequest }
  | { readonly kind: "rejoin"; readonly runId: string };

/**
 * How hard to try before giving up. Six attempts over roughly half a minute — long enough
 * to ride out a sleeping laptop's network or a proxy hiccup, short enough that a genuinely
 * dead server is not pretended about.
 */
const BACKOFF_MS = [800, 1600, 3200, 6400, 8000, 8000] as const;

/**
 * Opens the stream and drives it to its end. Returns a function that stops listening —
 * which does not stop the run: the server finishes it either way, and the record stays
 * reachable by its id until the buffer drops it.
 */
export function openRunStream(source: RunSource, handlers: RunStreamHandlers): () => void {
  let stopped = false;
  let runId = source.kind === "rejoin" ? source.runId : null;
  let lastSeq = 0;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });

  const dispatch = (event: RunEvent): boolean => {
    // The resume is by sequence number, so this should never fire — it is here because a
    // duplicated `statement` would double a card and a duplicated `done` would close the
    // screen twice, and neither is worth trusting a remote to prevent.
    if (event.seq > 0 && event.seq <= lastSeq) return false;
    if (event.seq > 0) lastSeq = event.seq;

    switch (event.event) {
      case "preflight": {
        const payload = event.data as PreflightEvent;
        // The id is what makes everything below it recoverable, so it is taken from the
        // first event rather than from the response, which has no body to read it from.
        runId = payload.runId;
        handlers.onPreflight(payload);
        return false;
      }
      case "statement":
        handlers.onStatement(event.data as StatementView);
        return false;
      case "judge":
        handlers.onJudge(event.data as JudgeView);
        return false;
      case "done":
        handlers.onDone(event.data as RunRecordView);
        return true;
      case "error":
        handlers.onServerError((event.data as { message?: string }).message ?? "The run failed.");
        return true;
      default:
        return false;
    }
  };

  void (async () => {
    let attempt = 0;
    let starting = source.kind === "start";

    while (!stopped) {
      controller = new AbortController();
      handlers.onPhase(attempt === 0 ? "connecting" : "reconnecting", attempt);

      // Every path out of the block below either returns or leaves this true, so it is
      // declared without an initial value: a `= false` here would be a value nothing ever
      // reads, and the reader would have to check that for themselves to know it.
      let dropped: boolean;
      try {
        const response = starting
          ? await fetch("/api/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // The whole request. There is no model field, here or anywhere.
              body: JSON.stringify((source as { request: RunRequest }).request),
              signal: controller.signal,
            })
          : await fetch(`/api/run/${runId as string}/stream?from=${lastSeq}`, {
              signal: controller.signal,
            });

        if (!response.ok || !response.body) {
          const ended = await handleNotOk(response, starting, handlers);
          if (ended) return;
          dropped = true;
        } else {
          let sawAnything = false;
          const terminal = await readFrames(response.body, (event) => {
            if (!sawAnything) {
              sawAnything = true;
              handlers.onPhase("live", attempt);
            }
            return dispatch(event);
          });
          if (terminal) {
            handlers.onPhase("closed", attempt);
            return;
          }
          // The body ended without a `done` or an `error`: the socket went, not the run.
          dropped = true;
        }
      } catch {
        if (stopped) return;
        dropped = true;
      }

      if (!dropped || stopped) return;

      // Nothing to resume: the run never got as far as telling us its identifier, so there
      // is nothing on the server to rejoin, and a second POST would spend a second seven
      // requests. Say so instead.
      if (runId === null) {
        handlers.onLost(
          "The connection failed before the trial opened. Nothing was spent — the server " +
            "never reported a run. Check that it is running, and try again.",
        );
        return;
      }

      const wait = BACKOFF_MS[attempt];
      if (wait === undefined) {
        handlers.onLost(
          "Lost the connection to the trial and could not pick it back up. The run itself " +
            "is very likely still finishing on the server — it does not stop when the " +
            "browser lets go — but this screen can no longer follow it.",
        );
        return;
      }
      attempt += 1;
      starting = false;
      await sleep(wait);
    }
  })();

  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  };
}

/**
 * A response that is not a stream. Returns true if this ends the attempt for good.
 *
 * The three that end it are all deliberate answers from the server rather than accidents:
 * a pre-flight refusal, a server with no API key, and a run the buffer no longer holds.
 */
async function handleNotOk(
  response: Response,
  starting: boolean,
  handlers: RunStreamHandlers,
): Promise<boolean> {
  const body = (await response.json().catch(() => null)) as {
    failures?: readonly PreflightFailure[];
    error?: string;
  } | null;

  // 400 — the pre-flight refused the case. 503 — the server cannot call anything. Both
  // are answers rather than failures to connect, and neither spent a request.
  if (starting && (response.status === 400 || response.status === 503)) {
    handlers.onRefused(body?.failures ?? [], body?.error ?? null);
    return true;
  }

  if (!starting && response.status === 404) {
    handlers.onLost(
      body?.error ??
        "That run is not being held any more. Runs live in memory while they are in " +
          "flight and for a few minutes after, and none is stored.",
    );
    return true;
  }

  return false;
}

/**
 * Reads SSE frames off the body until it ends, or until an event closes the run.
 * Returns whether the run closed — the difference between "finished" and "cut off".
 */
async function readFrames(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RunEvent) => boolean,
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;

  try {
    while (!terminal) {
      const { value, done } = await reader.read();
      if (done) break;
      // Carriage returns are dropped rather than handled: any real one inside a model's
      // prose is already escaped by the server's `JSON.stringify`, so every `\r` left on
      // the wire is a line ending.
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

      let split = buffer.indexOf("\n\n");
      while (split >= 0) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const event = parseFrame(frame);
        if (event && onEvent(event)) terminal = true;
        split = buffer.indexOf("\n\n");
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }

  return terminal;
}

/** One frame. Comment lines (the heartbeat) and the opening `retry:` yield nothing. */
function parseFrame(frame: string): RunEvent | null {
  let seq = 0;
  let name = "";
  let data = "";
  let hasData = false;

  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "id") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 0) seq = parsed;
    } else if (field === "event") {
      name = value;
    } else if (field === "data") {
      data = hasData ? `${data}\n${value}` : value;
      hasData = true;
    }
  }

  if (name === "" || !hasData) return null;
  try {
    return { seq, event: name as RunEventName, data: JSON.parse(data) };
  } catch {
    return null;
  }
}
