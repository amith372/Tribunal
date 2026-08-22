/**
 * app.ts — the routing layer, deliberately thin.
 *
 * specs.md Part 3: the pipeline stages stay plain functions this layer calls, so each is
 * testable without a running server. Nothing here decides anything about a trial; it
 * reads a request, hands it to `preflight`, hands a valid run to `executeRun`, and turns
 * the events that come back into SSE frames.
 *
 * Three rules this layer holds:
 *
 *   · **No model call before the pre-flight passes.** A refusal is a 400 carrying the
 *     typed failures, and not one request has left the server (specs.md Parts 1 and 4).
 *
 *   · **`mode` is the only model-related input.** A `model` field in the body is not
 *     rejected, it is simply never read — the identifiers live in `config.ts` and the
 *     free rule is enforced where the call is made. specs.md Part 5: a user-editable
 *     model field is a cost hole, and this app has no login to close it.
 *
 *   · **The run outlives the connection.** A browser that drops does not stop the run; it
 *     unsubscribes. What it missed is in the buffer, addressed by the run's id, and it can
 *     come back for it. Seven rationed requests are too expensive to lose to a refresh.
 *
 * The app is built by a function rather than at import time so a test can pass its own
 * data, its own buffer clock and a scripted caller, and drive the whole endpoint over a
 * real socket without an API key.
 */

import express, { type Express, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getServerConfig, resolveRunModels, type Mode } from "./config.js";
import type { TribunalData } from "./data.js";
import { coldModels } from "./model-health.js";
import { preflight } from "./preflight.js";
import { executeRun, type RunEmit } from "./run.js";
import { RunBuffer } from "./run-buffer.js";
import { appendRun } from "./runs-log.js";
import { openSse, resumeFrom } from "./sse.js";
import type { ChatCaller } from "./statements.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  readonly data: TribunalData;
  /** Defaults to a fresh in-process buffer. A test may pass one with its own clock. */
  readonly buffer?: RunBuffer;
  /** The seam the tests replace. Defaults to the real OpenRouter client. */
  readonly call?: ChatCaller;
  readonly timeoutMs?: number;
  /** Off in tests: a debugging log is not worth a file write per assertion. */
  readonly logRuns?: boolean;
}

/** The body shape. Everything is `unknown` — the pre-flight is what makes it a run. */
interface RunRequestBody {
  readonly chargeSheet?: unknown;
  readonly defendant?: unknown;
  readonly advocates?: unknown;
  readonly mode?: unknown;
}

/**
 * The only model-related thing a request may say. Anything unrecognised is per-role,
 * which is the mode the app is actually about — seven seats, seven different models.
 */
function readMode(value: unknown): Mode {
  return value === "solo" ? "solo" : "per-role";
}

export function createApp(options: AppOptions): Express {
  const { data } = options;
  const buffer = options.buffer ?? new RunBuffer();
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  /**
   * Health, and the proof that `data/` was found and parsed. Deliberately needs no API
   * key — the app must be runnable and checkable without one, and the keep-warm pinger
   * hits this endpoint too.
   */
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      characters: data.characters.map((c) => c.name),
      judges: data.judges.map((j) => j.name),
      relations: data.relations.length,
      apiKeyConfigured: getServerConfig().apiKey !== null,
      // A count, and nothing else. No run is browsable or queryable by design.
      runsHeld: buffer.size(),
      // Which models this process has found refusing, and why — the one piece of state
      // worth exposing, because it explains why a run cast the way it did.
      coldModels: coldModels(),
    });
  });

  /**
   * Starts a run and streams it. The response is an event stream from the first byte, so
   * the four advocates and three judges arrive as they settle rather than in one lump at
   * the end — Part 3's "pushed as they settle", and what Stage 7's avatars depend on.
   */
  app.post("/api/run", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as RunRequestBody;

    // ---- the pre-flight, before a single model call ---------------------------------
    const check = preflight(
      { chargeSheet: body.chargeSheet, defendant: body.defendant, advocates: body.advocates },
      data,
    );
    if (!check.ok) {
      res.status(400).json({ ok: false, failures: check.failures });
      return;
    }

    // A missing key is a fault in the deployment, not in the case. Saying so plainly is
    // better than letting seven calls fail one by one and reporting a silenced bench.
    if (getServerConfig().apiKey === null) {
      res.status(503).json({
        ok: false,
        failures: [],
        error:
          "This server has no OPENROUTER_API_KEY set, so it cannot call any model. Your case " +
          "is fine — the server is not configured.",
      });
      return;
    }

    const mode = readMode(body.mode);
    const models = resolveRunModels(mode);
    const runId = buffer.open();

    const emit: RunEmit = (event, payload) => {
      if (event === "done" || event === "error") buffer.close(runId, event, payload);
      else buffer.push(runId, event, payload);
    };

    stream(res, buffer, runId, 0);

    // The casting, before anything has been asked of a model: what Stage 7 draws the
    // room from while the first wave is still in flight.
    emit("preflight", {
      runId,
      mode,
      chargeSheet: check.run.chargeSheet,
      chargeSheetWords: check.run.chargeSheetWords,
      defendant: { id: check.run.defendant.id, name: check.run.defendant.name },
      casting: check.run.advocates.map((advocate, index) => ({
        id: advocate.character.id,
        name: advocate.character.name,
        side: advocate.side,
        requestedModel: models.advocates[index],
      })),
      bench: data.judges.map((judge, index) => ({
        id: judge.id,
        name: judge.name,
        requestedModel: models.judges[index],
      })),
    });

    void executeRun({
      run: check.run,
      data,
      models,
      emit,
      ...(options.call ? { call: options.call } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
      .then((record) => {
        if (options.logRuns !== false) void appendRun(runId, record);
      })
      .catch((error: unknown) => {
        // Only a fault in the app itself reaches here — everything a model did is an
        // outcome the record already carries honestly.
        const message = (error as Error).message;
        console.error(`Run ${runId} failed: ${message}`);
        emit("error", { message });
      });
  });

  /**
   * Rejoins a run in flight, or one that has just finished.
   *
   * specs.md Part 3: the server holds a run while it is in flight and briefly after, so a
   * reconnecting browser is sent everything that has already arrived and then continues
   * with the rest. `Last-Event-ID` is what a browser's own EventSource sends on reconnect;
   * `?from=` is for a client that reads the stream by hand, as the first connection does.
   */
  app.get("/api/run/:id/stream", (req: Request, res: Response) => {
    const runId = req.params.id as string;
    if (!buffer.get(runId)) {
      res.status(404).json({
        ok: false,
        error:
          "That run is not being held any more. Runs are kept in memory while they are " +
          "in flight and for a few minutes after; they do not survive a restart, and none " +
          "is stored. Start a new run.",
      });
      return;
    }
    stream(res, buffer, runId, resumeFrom(req.headers["last-event-id"], req.query.from));
  });

  // In production the Vite build sits next to the server build and is served from here.
  const webDist = resolve(here, "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      res.sendFile(join(webDist, "index.html"));
    });
  }

  return app;
}

/**
 * Attaches one connection to a run: replay what it missed, then follow it live, then end
 * when the record closes the run.
 *
 * Dropping the connection unsubscribes and nothing more. The run goes on, and everything
 * it produces is still in the buffer for whoever comes back for it.
 */
function stream(res: Response, buffer: RunBuffer, runId: string, fromSeq: number): void {
  const connection = openSse(res);
  const unsubscribe = buffer.subscribe(runId, fromSeq, (event) => {
    connection.send(event);
    if (event.event === "done" || event.event === "error") connection.close();
  });

  if (!unsubscribe) {
    connection.close();
    return;
  }

  // `res` and not `req`: an IncomingMessage emits "close" as soon as its body has been
  // read, which for a POST with a JSON body is immediately — detaching on that would end
  // every stream after its first event. The response's "close" is the one that means the
  // client is gone, and it also fires on a normal end, where detaching is harmless.
  res.on("close", () => {
    unsubscribe();
    connection.close();
  });
}
