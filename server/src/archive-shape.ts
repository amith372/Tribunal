/**
 * archive-shape.ts — pure translation between `RunRecord` and the two documents that
 * store it. No `mongodb` import here on purpose: this module must be unit-testable with
 * no database, so `archive.ts` is the only place that talks to one.
 *
 * **Why attempts are split out.** `Attempt` rows are in the record *twice* — flattened on
 * `record.attempts`, and nested inside each `StatementOutcome.attempts` and
 * `JudgeOutcome.attempts` (`aggregate.ts` concatenates the two waves to build the flat
 * list). Each attempt carries `raw: unknown`, the whole OpenRouter response body, so
 * storing both copies would double the biggest part of every document. `toArchived`
 * strips `attempts` off every statement and judge and keeps one flat, ordered copy in
 * `run_attempts` instead; `fromArchived` regroups by role so the record it hands back is
 * identical to the one that went in.
 *
 * **How the regrouping is exact.** Attempt labels are unique per role (`advocate:<id>`,
 * `judge:<id>`), so sorting the flat list by `seq` reproduces `record.attempts`, and
 * filtering that list by label reproduces each statement's and each judge's own
 * `attempts` — there is no ambiguity to resolve.
 */

import type { RunRecord } from "./aggregate.js";
import type { Attempt } from "./openrouter.js";
import type { Relation } from "./data.js";
import type { StatementOutcome } from "./statements.js";
import type { JudgeOutcome } from "./judging.js";

const CHARGE_PREVIEW_LENGTH = 120;

/** One `runs` document. The record broken into attributes, minus the attempts. */
export interface ArchivedRun {
  readonly _id: string;
  readonly schemaVersion: 1;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly chargeSheet: string;
  readonly chargeSheetWords: number;
  readonly defendant: { readonly id: string; readonly name: string };
  readonly casting: readonly { readonly id: string; readonly name: string; readonly side: string }[];
  /** Server-side only. Never reaches `fromArchived`'s returned record. */
  readonly relations: readonly Relation[];
  readonly mode: string;
  readonly statements: readonly Omit<StatementOutcome, "attempts">[];
  readonly judges: readonly Omit<JudgeOutcome, "attempts">[];
  readonly outcome: RunRecord["outcome"];
  readonly tally: RunRecord["tally"];
  readonly totals: RunRecord["totals"];
  readonly complete: boolean;
  readonly collisions: RunRecord["collisions"];
  readonly benchLineage: RunRecord["benchLineage"];
}

/** One `run_attempts` document — one model call. */
export interface ArchivedAttempt extends Attempt {
  readonly runId: string;
  /** Position in `record.attempts`, 0-based. */
  readonly seq: number;
}

/** The list-row payload. Small on purpose — no statements, no judges, no raw bodies. */
export interface ArchiveSummary {
  readonly runId: string;
  readonly startedAt: string;
  readonly defendant: { readonly id: string; readonly name: string };
  readonly chargePreview: string;
  readonly outcome: RunRecord["outcome"];
  readonly tally: RunRecord["tally"];
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly complete: boolean;
}

function previewOf(chargeSheet: string): string {
  if (chargeSheet.length <= CHARGE_PREVIEW_LENGTH) return chargeSheet;
  return `${chargeSheet.slice(0, CHARGE_PREVIEW_LENGTH)}…`;
}

export function toArchived(
  runId: string,
  record: RunRecord,
  relations: readonly Relation[],
): { run: ArchivedRun; attempts: readonly ArchivedAttempt[] } {
  const attempts: ArchivedAttempt[] = record.attempts.map((attempt, index) => ({
    ...attempt,
    runId,
    seq: index,
  }));

  const run: ArchivedRun = {
    _id: runId,
    schemaVersion: 1,
    startedAt: new Date(record.startedAt),
    finishedAt: new Date(record.finishedAt),
    chargeSheet: record.chargeSheet,
    chargeSheetWords: record.chargeSheetWords,
    defendant: record.defendant,
    casting: record.casting,
    relations,
    mode: record.mode,
    statements: record.statements.map(({ attempts: _attempts, ...rest }) => rest),
    judges: record.judges.map(({ attempts: _attempts, ...rest }) => rest),
    outcome: record.outcome,
    tally: record.tally,
    totals: record.totals,
    complete: record.complete,
    collisions: record.collisions,
    benchLineage: record.benchLineage,
  };

  return { run, attempts };
}

export function fromArchived(
  run: ArchivedRun,
  attempts: readonly ArchivedAttempt[],
): { runId: string; record: RunRecord } {
  const flatAttempts: Attempt[] = [...attempts]
    .sort((a, b) => a.seq - b.seq)
    .map(({ runId: _runId, seq: _seq, ...rest }) => rest);

  const byLabel = (label: string): Attempt[] =>
    flatAttempts.filter((attempt) => attempt.label === label);

  const statements: StatementOutcome[] = run.statements.map((statement) => ({
    ...statement,
    attempts: byLabel(`advocate:${statement.advocateId}`),
  }));

  const judges: JudgeOutcome[] = run.judges.map((judge) => ({
    ...judge,
    attempts: byLabel(`judge:${judge.judgeId}`),
  }));

  const record: RunRecord = {
    chargeSheet: run.chargeSheet,
    chargeSheetWords: run.chargeSheetWords,
    defendant: run.defendant,
    casting: run.casting as RunRecord["casting"],
    mode: run.mode as RunRecord["mode"],
    statements,
    judges,
    outcome: run.outcome,
    tally: run.tally,
    attempts: flatAttempts,
    totals: run.totals,
    complete: run.complete,
    collisions: run.collisions,
    benchLineage: run.benchLineage,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
  };

  return { runId: run._id, record };
}

export function summaryOf(run: ArchivedRun): ArchiveSummary {
  return {
    runId: run._id,
    startedAt: run.startedAt.toISOString(),
    defendant: run.defendant,
    chargePreview: previewOf(run.chargeSheet),
    outcome: run.outcome,
    tally: run.tally,
    costUsd: run.totals.costUsd,
    totalTokens: run.totals.totalTokens,
    complete: run.complete,
  };
}
