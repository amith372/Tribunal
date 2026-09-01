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
  type Mode,
} from "./config.js";
import type { RunRecord } from "./aggregate.js";
import { type RunArchive } from "./archive.js";
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
import { toRunRecordView } from "./record-view.js";
import { securityHeaders } from "./security-headers.js";
import { executeRun, type RunEmit } from "./run.js";
import type { RunEvent } from "./run-buffer.js";
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
  /** `null` (the default) when no archive is configured — the archive routes 404. */
  readonly archive?: RunArchive | null;
}

const NOT_HELD_OR_ARCHIVED =
  "That run is not being held or archived. If you downloaded the export while it was " +
  "open, that file is still the record.";

const NO_ARCHIVE_CONFIGURED = "This server has no archive configured.";

const ARCHIVE_LIST_CAP = 100;

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
  const archive = options.archive ?? null;
  const app = express();
  // Before every route and before the static files, so the policy covers the app itself
  // and not only the API under it.
  app.use(securityHeaders);
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
   * What happens to a record once the run has finished with it.
   *
   * **Fire-and-forget, warn-and-swallow, and that is the whole rule.** A run has already
   * spent seven rationed requests by the time it gets here; a database outage must never
   * turn that into a failed run. The two writes had this discipline written out twice,
   * which is two places for it to be got wrong later.
   */
  const keep = (runId: string, record: RunRecord): void => {
    if (options.logRuns !== false) void appendRun(runId, record);
    if (archive) {
      void archive.save(runId, record, data.relations).catch((error: unknown) => {
        console.warn(`Could not archive run ${runId}: ${(error as Error).message}`);
      });
    }
  };

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

    const runId = buffer.open();

    const emit: RunEmit = (event, payload) => {
      if (event === "done" || event === "error") buffer.close(runId, event, payload);
      else buffer.push(runId, event, payload);
    };

    stream(res, buffer, runId, 0);

    // Everything from here is the run's own business, the opening frame included: what the
    // casting is, which model each seat was asked for, and in what order any of it is
    // announced. This layer reads a request, refuses an invalid one, opens the stream and
    // gets out of the way.
    void executeRun({
      run: check.run,
      data,
      mode: readMode(body.mode),
      runId,
      emit,
      ...(options.call ? { call: options.call } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
      .then((record) => keep(runId, record))
      .catch((error: unknown) => {
        // Only a fault in the app itself reaches here — everything a model did is an
        // outcome the record already carries honestly. Which is exactly why the message
        // is not forwarded: a fault in *this* process is described in this process's own
        // terms, and those terms are for the log, not for a reader watching a trial.
        console.error(`Run ${runId} failed: ${(error as Error).message}`);
        emit("error", {
          message:
            "The tribunal stopped on a fault in the app itself, not in the case or in any " +
            "model. Nothing further was spent. The run cannot be completed.",
        });
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
          "That run's live connection is not being held any more — a run is kept in " +
          "memory only while it is in flight and for a few minutes after, and this " +
          "stream does not come back. If the run finished, it was archived and can be " +
          "found from the archive screen; otherwise, start a new run.",
      });
      return;
    }
    stream(res, buffer, runId, resumeFrom(req.headers["last-event-id"], req.query.from));
  });

  /**
   * The run record, as the file the user keeps.
   *
   * specs.md Part 3: the exported HTML file *is* the run record, self-contained and
   * rebuildable from the archive as well as from the live buffer. It is rendered here
   * rather than in the browser for two reasons that are really one — `buildExportHtml` is
   * a pure function of the same `RunRecord` the panels render, so the file's numbers
   * cannot disagree with the screen's, and being server-side it is reachable by the test
   * suite instead of checkable only by someone opening a download. The browser also does
   * not have everything the record needs: the raw response bodies are on the attempts the
   * server holds.
   *
   * The buffer is tried first — a run just finished is served from memory, no database
   * round trip needed — and the archive only when the buffer has let it go. This fixes a
   * real limitation the buffer-only version had: an export used to be unreachable the
   * moment the ten-minute hold lapsed.
   */
  app.get("/api/run/:id/export", (req: Request, res: Response) => {
    // Express 5 types a route parameter as possibly repeated; this one never is.
    const runId = req.params.id as string;
    const held = buffer.get(runId);

    if (held) {
      // The closing event carries the record. A run still under way has no record to
      // export — and a run that ended in an `error` never produced one at all.
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
      sendExport(res, done.data as RunRecord);
      return;
    }

    if (archive) {
      archive
        .get(runId)
        .then((found) => {
          if (!found) {
            res.status(404).json({ ok: false, error: NOT_HELD_OR_ARCHIVED });
            return;
          }
          sendExport(res, found.record);
        })
        .catch((error: unknown) => {
          archiveFailed(res, "export rebuild (live)", error);
        });
      return;
    }

    res.status(404).json({ ok: false, error: NOT_HELD_OR_ARCHIVED });
  });

  /**
   * POST /api/archive/list — summaries for the run ids a browser already holds.
   *
   * POST rather than GET: the id list can be long, and the answer is not cacheable. The
   * ids themselves come from the browser's own `localStorage` — specs.md Part 3's
   * per-browser rule — so this only resolves ids a browser already remembers into
   * something to render; it is not a way to discover a run whose id you do not hold.
   */
  app.post("/api/archive/list", (req: Request, res: Response) => {
    if (!archive) {
      res.status(404).json({ ok: false, error: NO_ARCHIVE_CONFIGURED });
      return;
    }
    const body = req.body as { ids?: unknown };
    if (!Array.isArray(body.ids)) {
      res.status(400).json({ ok: false, error: '"ids" must be an array of run ids.' });
      return;
    }
    const ids = body.ids
      .filter((id): id is string => typeof id === "string")
      .slice(0, ARCHIVE_LIST_CAP);

    archive
      .list(ids)
      .then((runs) => res.json({ ok: true, runs }))
      .catch((error: unknown) => {
        archiveFailed(res, "list", error);
      });
  });

  /**
   * GET /api/archive/:id — an archived run's record, shaped exactly as a live run's
   * `done` event is (`record-view.ts`): no raw response bodies, no judge `rawText`. One
   * shape, whether a run is read live or read back later.
   */
  app.get("/api/archive/:id", (req: Request, res: Response) => {
    if (!archive) {
      res.status(404).json({ ok: false, error: NO_ARCHIVE_CONFIGURED });
      return;
    }
    const runId = req.params.id as string;
    archive
      .get(runId)
      .then((found) => {
        if (!found) {
          res.status(404).json({ ok: false, error: "No archived run has that id." });
          return;
        }
        res.json({ ok: true, runId: found.runId, record: toRunRecordView(found.record) });
      })
      .catch((error: unknown) => {
        archiveFailed(res, "read", error);
      });
  });

  /** GET /api/archive/:id/export — the same HTML export, rebuilt from the archive. */
  app.get("/api/archive/:id/export", (req: Request, res: Response) => {
    if (!archive) {
      res.status(404).json({ ok: false, error: NO_ARCHIVE_CONFIGURED });
      return;
    }
    const runId = req.params.id as string;
    archive
      .get(runId)
      .then((found) => {
        if (!found) {
          res.status(404).json({ ok: false, error: "No archived run has that id." });
          return;
        }
        sendExport(res, found.record);
      })
      .catch((error: unknown) => {
        archiveFailed(res, "export rebuild (archived)", error);
      });
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
 * The buffer keeps the full record — raw response bodies included — for the export
 * route. The browser must not see that much: a `done` event is reshaped through
 * `toRunRecordView` on its way onto the wire, and nothing else is.
 */
function forWire(event: RunEvent): RunEvent {
  if (event.event !== "done") return event;
  return { ...event, data: toRunRecordView(event.data as RunRecord) };
}

/**
 * A failure inside the archive, reported without handing the reader the inside of it.
 *
 * These call sites used to return `(error as Error).message` straight to the browser. A
 * driver error is written for whoever runs the server, not for whoever uses it: the MongoDB
 * client puts the cluster host — and on some failures the credentialed URI — into the text,
 * so the message that told a developer what broke was also the one that published the
 * connection string to anyone able to make the call fail.
 *
 * The detail therefore goes to the log, where the operator is, and the reader is given a
 * sentence that says what happened and what it means for them. **The run itself is never
 * what failed here** — it finished, it was archived or it was not, and saying so is the
 * part that matters to someone holding an id.
 */
function archiveFailed(res: Response, doing: string, error: unknown): void {
  console.error(`Archive ${doing} failed: ${(error as Error).message}`);
  res.status(500).json({
    ok: false,
    error:
      "The archive could not be reached, so this run could not be read back. The run itself " +
      "is unaffected and nothing was spent — try again in a moment.",
  });
}

/**
 * Writes a record out as the download the export routes promise — the full record, raw
 * response bodies included, unlike what reaches the browser off the SSE wire.
 */
function sendExport(res: Response, record: RunRecord): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Named where the file is built, so the name and the record are decided in one place.
  res.setHeader("Content-Disposition", `attachment; filename="${exportFileName(record)}"`);
  res.send(buildExportHtml(record));
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
    connection.send(forWire(event));
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
