/**
 * `POST /api/run` and the reconnect, driven over a real socket. Zero model calls: the app
 * is built with a scripted caller.
 *
 * Everything below the routing layer already has its own tests, so what is asserted here
 * is only what the endpoint itself is responsible for:
 *
 *   · a refused run is a 400 with the typed failures and **not one model call**;
 *   · the stream arrives **incrementally**, which is the property Stage 7's avatars need
 *     and the one a test over a socket can actually prove — a test against the app object
 *     could not tell a stream from a batch;
 *   · a browser that lets go does not stop the run, and can come back for what it missed;
 *   · a `model` field in the body is not a way to choose a model.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp, type AppOptions } from "../app.js";
import type { RunArchive } from "../archive.js";
import { assertAllowedModel, FALLBACK_ROUTER, getModelRegistry } from "../config.js";
import {
  CHARGE_CUES,
  MAX_CHARGE_SHEET_WORDS,
  MIN_CHARGE_SHEET_WORDS,
  SEARCHED_NAMES,
} from "../preflight.js";
import { loadData } from "../data.js";
import { RunBuffer } from "../run-buffer.js";
import type { CallOptions, CallResult } from "../openrouter.js";
import { fakeResult } from "./fake-caller.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";

const data = loadData();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The endpoint refuses to start a run with no key, and rightly — but the caller here is a
// fake and no request leaves the machine. Set for this file only, restored after.
let hadKey: string | undefined;
beforeAll(() => {
  hadKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key-never-sent-anywhere";
});
afterAll(() => {
  if (hadKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = hadKey;
});

const VALID_BODY = {
  chargeSheet: PART_4_CHARGE_SHEET,
  defendant: "jon-snow",
  advocates: PART_4_CAST,
};

/** A caller that takes `delayMs` per call, so incremental delivery is observable. */
function pacedCaller(delayMs = 0) {
  const calls: CallOptions[] = [];
  const call = async (options: CallOptions): Promise<CallResult> => {
    calls.push(options);
    if (delayMs > 0) await sleep(delayMs);
    return fakeResult(
      options,
      options.label.startsWith("judge:")
        ? "Verdict: guilty. He was sworn to her. She was unarmed when he struck."
        : "The realm was already burning when he acted, and the charge sheet says so.",
    );
  };
  return { call, calls };
}

/** Starts the app on an ephemeral port and hands back its base URL and a stop function. */
async function serve(options: Omit<AppOptions, "data"> = {}): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const app = createApp({ data, logRuns: false, ...options });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

interface Frame {
  readonly event: string;
  readonly id: number;
  readonly data: Record<string, unknown>;
  /** Milliseconds after the request was sent — how the "one lump" failure is caught. */
  readonly atMs: number;
}

/** Reads an SSE body frame by frame, timing each one as it lands. */
async function readFrames(body: ReadableStream<Uint8Array>, startedAt: number): Promise<Frame[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffered = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const atMs = Date.now() - startedAt;

    let split = buffered.indexOf("\n\n");
    while (split !== -1) {
      const block = buffered.slice(0, split);
      buffered = buffered.slice(split + 2);
      const frame = parseFrame(block, atMs);
      if (frame) frames.push(frame);
      split = buffered.indexOf("\n\n");
    }
  }
  return frames;
}

function parseFrame(block: string, atMs: number): Frame | null {
  const lines = block.split("\n");
  const id = lines.find((line) => line.startsWith("id: "))?.slice(4);
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const payload = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!event || !payload || id === undefined) return null;
  return { event, id: Number(id), data: JSON.parse(payload) as Record<string, unknown>, atMs };
}

async function runToCompletion(url: string, body: unknown = VALID_BODY): Promise<Frame[]> {
  const startedAt = Date.now();
  const response = await fetch(`${url}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
  return readFrames(response.body as ReadableStream<Uint8Array>, startedAt);
}

describe("a run the pre-flight refuses", () => {
  it("is a 400 carrying the typed failures, and spends no model call", async () => {
    const { call, calls } = pacedCaller();
    const { url, stop } = await serve({ call });

    const response = await fetch(`${url}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Part 4's second invalid case: a three-to-one split.
      body: JSON.stringify({
        ...VALID_BODY,
        advocates: [
          { id: "tyrion", side: "for" },
          { id: "cersei", side: "against" },
          { id: "daenerys", side: "against" },
          { id: "grey-worm", side: "against" },
        ],
      }),
    });
    const body = (await response.json()) as { ok: boolean; failures: { code: string }[] };

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(body.ok).toBe(false);
    expect(body.failures.map((failure) => failure.code)).toContain("split_not_two_two");
    expect(calls).toHaveLength(0);

    await stop();
  });

  it("gives every failure a code, a field and a message the screen can show", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });

    const response = await fetch(`${url}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chargeSheet: "", defendant: "gandalf", advocates: [] }),
    });
    const body = (await response.json()) as {
      failures: { code: string; field: string; message: string }[];
    };

    expect(body.failures.length).toBeGreaterThan(1);
    for (const failure of body.failures) {
      expect(failure.code).toBeTruthy();
      expect(["chargeSheet", "defendant", "advocates"]).toContain(failure.field);
      expect(failure.message.length).toBeGreaterThan(20);
    }

    await stop();
  });

  it("holds no run for a case it refused", async () => {
    const buffer = new RunBuffer();
    const { url, stop } = await serve({ call: pacedCaller().call, buffer });

    await fetch(`${url}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chargeSheet: "too short", defendant: "jon-snow", advocates: [] }),
    });

    expect(buffer.size()).toBe(0);
    await stop();
  });
});

describe("a run the pre-flight passes", () => {
  it("streams the casting, then each statement, then each verdict, then the record", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });
    const frames = await runToCompletion(url);

    expect(frames.map((frame) => frame.event)).toEqual([
      "preflight",
      "statement", "statement", "statement", "statement",
      "judge", "judge", "judge",
      "done",
    ]);
    expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    await stop();
  });

  it("arrives one event at a time rather than as one lump at the end", async () => {
    // 100ms per call: the advocate wave is parallel so it costs ~100ms, the bench another
    // ~100ms. If the response were buffered, every frame would carry the same arrival time.
    //
    // **The delay is generous on purpose, and the threshold below is not.** At 40ms this
    // assertion sat 10ms from its own limit, and a loaded machine sampling a few
    // milliseconds late failed a run that had streamed perfectly well — observed at 26ms
    // against a floor of 30. The property under test is that frames arrive *apart* rather
    // than together, and a buffered response would put them microseconds apart, so the
    // floor was never the interesting number. Raising the delay rather than lowering the
    // floor keeps the assertion exactly as strict and moves the flake out of reach.
    const { url, stop } = await serve({ call: pacedCaller(100).call });
    const frames = await runToCompletion(url);

    const preflightAt = frames[0]?.atMs;
    const firstStatementAt = frames[1]?.atMs;
    const firstJudgeAt = frames[5]?.atMs;
    const doneAt = frames.at(-1)?.atMs as number;

    // The casting is on screen before any model has answered.
    expect(firstStatementAt - preflightAt).toBeGreaterThanOrEqual(30);
    // The bench is heard after the advocates, not with them.
    expect(firstJudgeAt - firstStatementAt).toBeGreaterThanOrEqual(30);
    expect(doneAt).toBeGreaterThan(firstStatementAt);

    await stop();
  });

  it("names the model that answered on every seat, and closes with one record", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });
    const frames = await runToCompletion(url);

    for (const frame of frames.filter((f) => f.event === "statement" || f.event === "judge")) {
      expect(typeof frame.data.model).toBe("string");
    }

    const record = frames.at(-1)?.data as {
      totals: { calls: number; totalTokens: number; costUsd: number };
      attempts: { usage: { totalTokens: number } }[];
      outcome: { kind: string };
    };
    expect(record.totals.calls).toBe(7);
    expect(record.totals.costUsd).toBe(0);
    const summed = record.attempts.reduce((sum, a) => sum + a.usage.totalTokens, 0);
    expect(record.totals.totalTokens).toBe(summed);
    expect(record.outcome.kind).toBe("verdict");

    await stop();
  });

  it("ignores a `model` field in the body — it is not a way to choose a model", async () => {
    const { call, calls } = pacedCaller();
    const { url, stop } = await serve({ call });

    await runToCompletion(url, {
      ...VALID_BODY,
      model: "anthropic/claude-opus-4",
      models: ["openai/gpt-5"],
    });

    // Every chain is built from `config.ts`, and nothing the body said appears in one.
    const asked = calls.flatMap((options) => options.models);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.some((model) => model.includes("claude") || model.includes("gpt-5"))).toBe(false);
    expect(asked.every((model) => model.endsWith(":free") || model === "openrouter/free")).toBe(true);

    await stop();
  });
});

describe("the finished run is archived when an archive is configured", () => {
  it("saves the record and the data's relations under the run's own id", async () => {
    const saved: { runId: string; record: unknown; relations: unknown }[] = [];
    const archive: RunArchive = {
      save(runId, record, relations) {
        saved.push({ runId, record, relations });
        return Promise.resolve();
      },
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(null),
    };

    const { url, stop } = await serve({ call: pacedCaller().call, archive });
    const frames = await runToCompletion(url);
    const runId = (frames[0]?.data as { runId: string }).runId;

    // The save is fire-and-forget behind the resolved response; give the microtask
    // queue one more turn to let it land before asserting on it.
    await new Promise((resolve) => setImmediate(resolve));

    expect(saved).toHaveLength(1);
    expect(saved[0]?.runId).toBe(runId);
    expect(saved[0]?.relations).toEqual(data.relations);
    expect((saved[0]?.record as { outcome: { kind: string } }).outcome.kind).toBe("verdict");

    await stop();
  });

  it("does not touch an unconfigured archive — there is none", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call, archive: null });
    const frames = await runToCompletion(url);
    expect(frames.at(-1)?.event).toBe("done");
    await stop();
  });
});

describe("a browser that lets go of a run", () => {
  it("does not stop it, and can come back for everything it missed", async () => {
    const buffer = new RunBuffer();
    const { url, stop } = await serve({ call: pacedCaller(60).call, buffer });

    // Start the run, read the casting, then walk away.
    const controller = new AbortController();
    const response = await fetch(`${url}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
      signal: controller.signal,
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/event: preflight/);
    const runId = (JSON.parse(first.split("data: ")[1]?.split("\n")[0]) as { runId: string })
      .runId;
    controller.abort();
    await reader.cancel().catch(() => {});

    // Come back on the reconnect route, saying what was already seen.
    const startedAt = Date.now();
    const resumed = await fetch(`${url}/api/run/${runId}/stream?from=1`);
    const frames = await readFrames(resumed.body as ReadableStream<Uint8Array>, startedAt);

    expect(frames.map((frame) => frame.event)).toEqual([
      "statement", "statement", "statement", "statement",
      "judge", "judge", "judge",
      "done",
    ]);
    // The run was seven calls whoever was watching: the reconnect cost nothing.
    expect((frames.at(-1)?.data as { totals: { calls: number } }).totals.calls).toBe(7);

    await stop();
  });

  it("replays a finished run in full to a client that arrives late", async () => {
    const buffer = new RunBuffer();
    const { url, stop } = await serve({ call: pacedCaller().call, buffer });

    const frames = await runToCompletion(url);
    const runId = (frames[0]?.data as { runId: string }).runId;

    const late = await fetch(`${url}/api/run/${runId}/stream`);
    const replayed = await readFrames(late.body as ReadableStream<Uint8Array>, Date.now());

    expect(replayed.map((frame) => frame.event)).toEqual(frames.map((frame) => frame.event));
    expect(replayed.at(-1)?.data).toEqual(frames.at(-1)?.data);

    await stop();
  });

  it("honours Last-Event-ID, which is what a browser's own EventSource sends", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });
    const frames = await runToCompletion(url);
    const runId = (frames[0]?.data as { runId: string }).runId;

    const resumed = await fetch(`${url}/api/run/${runId}/stream`, {
      headers: { "Last-Event-ID": "6" },
    });
    const replayed = await readFrames(resumed.body as ReadableStream<Uint8Array>, Date.now());

    expect(replayed.map((frame) => frame.id)).toEqual([7, 8, 9]);

    await stop();
  });

  it("says plainly that a run it no longer holds is gone, rather than pretending", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });

    const response = await fetch(`${url}/api/run/11111111-2222-3333-4444-555555555555/stream`);
    const body = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not survive a restart|not being held/);

    await stop();
  });
});

describe("health", () => {
  it("still needs no API key, and counts held runs without listing any", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });

    const body = (await (await fetch(`${url}/api/health`)).json()) as Record<string, unknown>;

    expect(body.ok).toBe(true);
    expect(body.characters).toHaveLength(5);
    expect(body.runsHeld).toBe(0);
    // A count and nothing more — no ids, no charge sheets, nothing browsable.
    expect(JSON.stringify(body)).not.toMatch(/chargeSheet/);

    await stop();
  });

  it("carries the roster and the pre-flight's rules, so the setup screen mirrors rather than guesses", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });

    const body = (await (await fetch(`${url}/api/health`)).json()) as {
      characters: { id: string; name: string; description: string }[];
      preflight: {
        minChargeSheetWords: number;
        maxChargeSheetWords: number;
        searchedNames: Record<string, string[]>;
        chargeCues: string[];
      };
    };

    // Cast by id, shown by name and description: all three come from `data/`.
    expect(body.characters.map((c) => c.id)).toContain("jon-snow");
    expect(body.characters.every((c) => c.name.length > 0 && c.description.length > 0)).toBe(true);

    // The rules the client mirrors are the pre-flight's own, not a second copy of them.
    expect(body.preflight.minChargeSheetWords).toBe(MIN_CHARGE_SHEET_WORDS);
    expect(body.preflight.maxChargeSheetWords).toBe(MAX_CHARGE_SHEET_WORDS);
    expect(body.preflight.searchedNames["jon-snow"]).toEqual(SEARCHED_NAMES["jon-snow"]);
    expect(body.preflight.chargeCues).toEqual(CHARGE_CUES);

    await stop();
  });
});

describe("GET /api/models", () => {
  it("reports the models this process holds, and every one of them is free", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });

    const body = (await (await fetch(`${url}/api/models`)).json()) as {
      ok: boolean;
      solo: { model: string; seats: number };
      perRole: {
        judges: { seats: number; pool: string[] };
        advocates: { seats: number; pool: string[] };
      };
      fallbackRouter: string;
    };
    const registry = getModelRegistry();

    expect(body.ok).toBe(true);
    expect(body.solo.model).toBe(registry.solo);
    expect(body.perRole.judges.pool).toEqual(registry.judgePool);
    expect(body.perRole.advocates.pool).toEqual(registry.advocatePool);
    expect(body.fallbackRouter).toBe(FALLBACK_ROUTER);

    // Every pool is deeper than the seats it fills — specs.md Part 1 — and every
    // identifier the browser is shown is one the guard would let through.
    expect(body.perRole.judges.pool.length).toBeGreaterThan(body.perRole.judges.seats);
    expect(body.perRole.advocates.pool.length).toBeGreaterThan(body.perRole.advocates.seats);
    for (const id of [body.solo.model, ...body.perRole.judges.pool, ...body.perRole.advocates.pool]) {
      expect(() => assertAllowedModel(id)).not.toThrow();
    }

    await stop();
  });

  it("is read-only: nothing it is sent can name a model", async () => {
    const { url, stop } = await serve({ call: pacedCaller().call });

    // A query string is the only input a GET has. It changes nothing, and the paid model
    // named in it comes back nowhere in the answer.
    const plain = await (await fetch(`${url}/api/models`)).text();
    const injected = await (
      await fetch(`${url}/api/models?model=openai/gpt-4o&solo=openai/gpt-4o`)
    ).text();

    expect(injected).toBe(plain);
    expect(injected).not.toMatch(/gpt-4o/);

    // And it is a GET: there is no POST /api/models to send a body to.
    const posted = await fetch(`${url}/api/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ solo: "openai/gpt-4o" }),
    });
    expect(posted.status).toBe(404);

    await stop();
  });
});
