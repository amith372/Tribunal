/**
 * What the browser reads from the server, and the shapes it comes in.
 *
 * Two GETs, both free of an API key and of any model call: `/api/health` for the roster
 * and the pre-flight's rules, `/api/models` for the identifiers a run will draw from —
 * and, below them, the shapes the run stream carries. `run-stream.ts` moves the bytes;
 * this file says what is in them.
 *
 * **Nothing here can name a model.** `/api/models` is read-only and reads nothing back
 * — specs.md Part 1: the identifiers live server-side and are never editable in the app.
 * The one model-related thing this client ever sends is a mode, and that goes on the run
 * request, not here.
 */

import type { Side } from "@record/preflight.js";
export type { Side };

export interface Character {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/**
 * The pre-flight's own rules, served so the setup screens can show their checks passing
 * as the user types. The server re-checks everything and is authoritative; this only
 * lets the screen agree with it in advance rather than keep a second copy of the rules
 * that would eventually disagree.
 */
export interface PreflightRules {
  readonly minChargeSheetWords: number;
  readonly maxChargeSheetWords: number;
  /** Per character id, the names the charge sheet is searched for. Shown to the user. */
  readonly searchedNames: Readonly<Record<string, readonly string[]>>;
  /** Word stems that read as an accusation. */
  readonly chargeCues: readonly string[];
}

/**
 * What `/api/health` sends, minus what no screen reads.
 *
 * The endpoint also reports `relations`, `apiKeyConfigured`, `runsHeld` and `coldModels`.
 * They are deliberately absent here: a field nothing renders is a field that can change
 * shape without any screen noticing, so the type states what is actually used and lets
 * the rest arrive and be ignored. Same rule as the run types below.
 */
export interface Health {
  readonly ok: boolean;
  readonly characters: readonly Character[];
  readonly judges: readonly string[];
  readonly preflight: PreflightRules;
}

export interface ModelsView {
  readonly ok: boolean;
  readonly solo: { readonly model: string; readonly seats: number };
  readonly perRole: {
    readonly judges: { readonly seats: number; readonly pool: readonly string[] };
    readonly advocates: { readonly seats: number; readonly pool: readonly string[] };
  };
  readonly fallbackRouter: string;
}

/** The run's only model-related input: a mode, never an identifier. */
export type Mode = "solo" | "per-role";

/** The server's own words where it has any — a 404's `{ error }` reads better than a code. */
async function errorFrom(path: string, response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `${path} answered HTTP ${response.status}`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw await errorFrom(path, response);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(path, response);
  return (await response.json()) as T;
}

export const getHealth = () => getJson<Health>("/api/health");
export const getModels = () => getJson<ModelsView>("/api/models");

/* ---------------------------------------------------------------------------------------
 * The run, and what its stream carries.
 *
 * These mirror the server's own types — `StatementOutcome`, `JudgeOutcome`, `RunRecord`
 * and the rest — deliberately by hand rather than by importing them. The two workspaces
 * compile separately and the browser is a different trust boundary from the pipeline, so
 * what is written here is *what the screen reads*, which is a subset: every field below is
 * one the run screen or the results panels actually render. A field the server adds and
 * nothing here reads simply arrives and is ignored, which is the right outcome; a field
 * that changes shape is caught by the screen that stops compiling.
 *
 * Nothing in the request can name a model. `mode` is the only model-related field there
 * is — specs.md Part 1 — and the identifiers below arrive *from* the server as a report of
 * what actually answered.
 * ------------------------------------------------------------------------------------ */

/** The one thing the browser sends to start a trial. */
export interface RunRequest {
  readonly chargeSheet: string;
  readonly defendant: string;
  readonly advocates: readonly { readonly id: string; readonly side: Side }[];
  readonly mode: Mode;
}

/** A pre-flight refusal, as the 400 body carries it. Shown to the user as written. */
export interface PreflightFailure {
  readonly code: string;
  readonly field: "chargeSheet" | "defendant" | "advocates";
  readonly message: string;
}

/**
 * The record's vocabulary, read from the server rather than restated here.
 *
 * Every one of these was written out by hand for as long as the browser kept its own copy
 * of what a run says. It does not any more — `vite.config.ts` explains why that is safe —
 * and a hand-copied type was exactly the drift that copy risked: a field that changed shape
 * on the server would have gone on compiling here, and the screen would have read a record
 * that no longer existed.
 *
 * Every line below is a type-only re-export, erased at build. The browser gains the
 * server's vocabulary and none of its code: no model identifier, no key, no Node.
 */
export type {
  AttemptView as Attempt,
  JudgeOutcomeView as JudgeView,
  StatementOutcomeView as StatementView,
} from "@record/record-view.js";
export type { Usage } from "@record/openrouter.js";
export type { Verdict } from "@record/judge-parser.js";

// Imported as well as re-exported: the shapes below are declared in terms of them.
import type { RunOutcome, RunTotals, Tally } from "@record/aggregate.js";
import type { RunRecordView } from "@record/record-view.js";
export type { RunOutcome, RunRecordView, RunTotals, Tally };

/**
 * The first event of a run: the casting and the bench, sent before a single model has been
 * asked anything. It is what the trial screen draws the room from while the whole first
 * wave is still in flight.
 */
export interface PreflightEvent {
  readonly runId: string;
  readonly mode: Mode;
  readonly chargeSheet: string;
  readonly chargeSheetWords: number;
  readonly defendant: { readonly id: string; readonly name: string };
  readonly casting: readonly {
    readonly id: string;
    readonly name: string;
    readonly side: Side;
    readonly requestedModel: string;
  }[];
  readonly bench: readonly {
    readonly id: string;
    readonly name: string;
    readonly requestedModel: string;
  }[];
}

/* ---------------------------------------------------------------------------------------
 * The archive: past runs this browser has kept the id of. `run-memory.ts` holds the ids;
 * these two calls resolve them into something to render. Mirrors the server's own
 * `ArchiveSummary` and `RunRecordView` shapes by hand, for the same reason as above.
 * ------------------------------------------------------------------------------------ */

/** The list-row payload for one archived run. Small on purpose. */
export interface ArchiveSummary {
  readonly runId: string;
  readonly startedAt: string;
  readonly defendant: { readonly id: string; readonly name: string };
  readonly chargePreview: string;
  readonly outcome: RunOutcome;
  readonly tally: Tally;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly complete: boolean;
}

/** An archived run's full record, in the same shape a live run's `done` event carries. */
export const getArchivedRun = (id: string) =>
  getJson<{ ok: boolean; runId: string; record: RunRecordView }>(
    `/api/archive/${encodeURIComponent(id)}`,
  );

/** Resolves a browser's own remembered run ids into summaries, newest first. */
export async function listArchive(ids: readonly string[]): Promise<readonly ArchiveSummary[]> {
  if (ids.length === 0) return [];
  const body = await postJson<{ ok: boolean; runs: readonly ArchiveSummary[] }>(
    "/api/archive/list",
    { ids },
  );
  return body.runs;
}
