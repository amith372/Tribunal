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

import {
  ADVOCATE_SEATS,
  FALLBACK_ROUTER,
  getModelRegistry,
  getServerConfig,
  JUDGE_SEATS,
  resolveRunModels,
  type Mode,
} from "./config.js";
import type { RunRecord } from "./aggregate.js";
import type { TribunalData } from "./data.js";
import { buildExportHtml, exportFileName } from "./export.js";
import { coldModels } from "./model-health.js";
import {
  CHARGE_CUES,
  MAX_CHARGE_SHEET_WORDS,
  MIN_CHARGE_SHEET_WORDS,
  preflight,
  SEARCHED_NAMES,
} from "./preflight.js";
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
      // Objects rather than names since Stage 6: the Setup screen casts by `id`, shows the
      // description under each portrait, and has no business inventing either. The five
      // characters are read from `data/` here exactly as the pipeline reads them.
      characters: data.characters.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
      })),
      judges: data.judges.map((j) => j.name),
      relations: data.relations.length,
      // The pre-flight's rules, so the Setup screen can show its checks passing as the user
      // types without keeping a second copy of them. specs.md Part 1 leaves the server the
      // authority; this only lets the client agree with it in advance instead of guessing.
      preflight: {
        minChargeSheetWords: MIN_CHARGE_SHEET_WORDS,
        maxChargeSheetWords: MAX_CHARGE_SHEET_WORDS,
        searchedNames: SEARCHED_NAMES,
        chargeCues: CHARGE_CUES,
      },
      apiKeyConfigured: getServerConfig().apiKey !== null,
      // A count, and nothing else. No run is browsable or queryable by design.
      runsHeld: buffer.size(),
      // Which models this process has found refusing, and why — the one piece of state
      // worth exposing, because it explains why a run cast the way it did.
      coldModels: coldModels(),
    });
  });

  /**
   * The models this server will use, read-only.
   *
   * specs.md Part 1: the identifiers are chosen by the developer, live server-side, and
   * are never editable in the app. This endpoint is the *display* half of that rule and
   * not a hole in it — the Setup screen names the models a run will draw from, and it
   * names the ones this process actually holds, so changing a slot on the host changes
   * what the screen says without an edit anywhere else. A screen that listed models from
   * a copy of its own would go stale silently, which is the failure worth avoiding: a
   * user reading a model name that is not the one being called.
   *
   * It is a GET that reads nothing at all — no query, no body, no header is consulted —
   * so there is no field here through which a request could name a model. The registry it
   * reports from is the same one `assertAllowedModel` enforces, and every identifier in
   * it has already passed the free rule at startup.
   */
  app.get("/api/models", (_req, res) => {
    const { solo, judgePool, advocatePool } = getModelRegistry();
    res.json({
      ok: true,
      // Keyed by the two modes the toggle offers, because that is the only model-related
      // choice the browser has — and it chooses a mode, never a model.
      solo: { model: solo, seats: JUDGE_SEATS + ADVOCATE_SEATS },
      perRole: {
        judges: { seats: JUDGE_SEATS, pool: judgePool },
        advocates: { seats: ADVOCATE_SEATS, pool: advocatePool },
      },
      // Named so the screen can say what a run falls back to, rather than the token table
      // being the first place a reader meets it.
      fallbackRouter: FALLBACK_ROUTER,
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

  /**
   * The run record, as the file the user keeps.
   *
   * specs.md Part 3: there is no database, and the exported HTML file *is* the run record.
   * It is rendered here rather than in the browser for two reasons that are really one —
   * `buildExportHtml` is a pure function of the same `RunRecord` the panels render, so the
   * file's numbers cannot disagree with the screen's, and being server-side it is reachable
   * by the test suite instead of checkable only by someone opening a download. The browser
   * also does not have everything the record needs: the raw response bodies are on the
   * attempts the server holds.
   *
   * It is bounded by the same hold as the stream — a run is kept while in flight and for a
   * few minutes after, and then it is gone, because nothing about a run is stored. The
   * client asks for this the moment the run finishes rather than when the button is pressed,
   * so a reader who takes their time over the five panels is not the one who pays for that.
   */
  app.get("/api/run/:id/export", (req: Request, res: Response) => {
    // Express 5 types a route parameter as possibly repeated; this one never is.
    const held = buffer.get(req.params.id as string);
    if (!held) {
      res.status(404).json({
        ok: false,
        error:
          "That run is not being held any more. Runs are kept in memory while they are in " +
          "flight and for a few minutes after; none is stored, and none survives a restart. " +
          "If you exported the run while it was open, that file is still the record.",
      });
      return;
    }

    // The closing event carries the record. A run still under way has no record to export —
    // and a run that ended in an `error` never produced one at all.
    const done = held.events.find((event) => event.event === "done");
    if (!done) {
      res.status(409).json({
        ok: false,
        error: held.finished
          ? "That run stopped before it produced a record, so there is nothing to export."
          : "That run has not finished yet. The record exists once the bench has ruled.",
      });
      return;
    }

    const record = done.data as RunRecord;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Named where the file is built, so the name and the record are decided in one place.
    res.setHeader("Content-Disposition", `attachment; filename="${exportFileName(record)}"`);
    res.send(buildExportHtml(record));
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
