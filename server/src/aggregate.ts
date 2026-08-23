/**
 * aggregate.ts — the last pipeline stage: fold a finished run into one record.
 *
 * specs.md Part 3: "One run produces one record, and everything downstream renders
 * that." The panels, the stream's closing message and the exported HTML are three
 * renderings of the object this module returns, not three places that each work the
 * numbers out. That is what makes Part 2's "its numbers match what the app showed" true
 * by construction — there is only one place the numbers exist.
 *
 * Two properties this module holds to:
 *
 *   1. **It is pure.** No clock, no I/O, no randomness — `startedAt` and `finishedAt`
 *      are passed in. A run can therefore be rebuilt from stored stage output and
 *      checked without a server, a key or a browser.
 *
 *   2. **The outcome is a shape, not a verdict with excuses attached.** Where no
 *      verdict was reached there is no `verdict` field to read, so Part 5's "never
 *      invent a verdict" is held by the type rather than by every renderer remembering
 *      to check a flag first.
 */

import type { Attempt, Usage } from "./openrouter.js";
import type { JudgeOutcome } from "./judging.js";
import type { Verdict } from "./judge-parser.js";
import type { RunModels } from "./config.js";
import type { CastAdvocate, Side, ValidRun } from "./preflight.js";
import type { AbortReason, StatementOutcome, StatementsResult } from "./statements.js";

/** How the three seats voted. Failed judges are counted, never silently dropped. */
export interface Tally {
  readonly guilty: number;
  readonly notGuilty: number;
  readonly failed: number;
}

/**
 * How a run ended.
 *
 * `verdict` carries one; the other three deliberately have no such field at all.
 * specs.md Part 2: a majority is two of the three seats, so two agreeing judges carry
 * it even where the third failed; one against one is hung; a single surviving verdict
 * is inconclusive, because one judge is not a bench.
 */
export type RunOutcome =
  | { readonly kind: "verdict"; readonly verdict: Verdict; readonly tally: Tally }
  | { readonly kind: "hung"; readonly tally: Tally }
  | { readonly kind: "inconclusive"; readonly tally: Tally; readonly why: string }
  | { readonly kind: "aborted"; readonly reason: AbortReason; readonly message: string };

/** Summed across every attempt in the run, retries and failures included. */
export interface RunTotals {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Counted and shown because they were really spent (specs.md Part 5). */
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly elapsedMs: number;
  /** True if any attempt reported no usage, so a total can be shown as a floor. */
  readonly usageMissing: boolean;
}

/** Two roles that ended up on the same model. Disclosed, never hidden (Part 1). */
export interface ModelCollision {
  readonly model: string;
  /** The role labels that shared it, e.g. `judge:barak`. */
  readonly roles: readonly string[];
}

/**
 * Two judges that answered on models from the same maker.
 *
 * The casting never does this and the fallback avoids it, but the free roster is thin
 * enough that a judge whose model fails may have nothing left but a model sharing a maker
 * with a sibling — and taking it is better than an unvetted model off the router or an
 * empty seat. What makes that acceptable is that it is *said*. Two judges built from shared
 * weights can agree for reasons that are not judicial, and with a majority of three such a
 * pair decides the verdict; a reader who can see it happened can weigh the verdict knowing
 * that. A reader who cannot is being told three independent judges agreed when they may not
 * have been three.
 */
export interface LineageCollision {
  /** The maker both seats ended up on, e.g. `nvidia`. */
  readonly maker: string;
  readonly judges: readonly string[];
}

export interface RunRecord {
  readonly chargeSheet: string;
  readonly chargeSheetWords: number;
  readonly defendant: { readonly id: string; readonly name: string };
  readonly casting: readonly { readonly id: string; readonly name: string; readonly side: Side }[];
  readonly mode: RunModels["mode"];
  readonly statements: readonly StatementOutcome[];
  readonly judges: readonly JudgeOutcome[];
  readonly outcome: RunOutcome;
  readonly tally: Tally;
  /** Every request made, in order — the per-call model/token/price/time table. */
  readonly attempts: readonly Attempt[];
  readonly totals: RunTotals;
  /** All four statements arrived and all three judges ruled. */
  readonly complete: boolean;
  readonly collisions: readonly ModelCollision[];
  /** Judges that answered on one maker — empty on almost every run (Part 1). */
  readonly benchLineage: readonly LineageCollision[];
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface AggregateInput {
  readonly run: ValidRun;
  readonly models: RunModels;
  readonly statements: StatementsResult;
  /** Absent when the run aborted before judging. */
  readonly judging?: {
    readonly judges: readonly JudgeOutcome[];
    readonly attempts: readonly Attempt[];
  } | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

const add = (a: number, b: number | null): number => a + (b ?? 0);

function sumUsage(attempts: readonly Attempt[]): RunTotals {
  let usageMissing = false;
  const totals = attempts.reduce(
    (acc, attempt) => {
      const usage: Usage = attempt.usage;
      if (usage.totalTokens === null) usageMissing = true;
      return {
        promptTokens: add(acc.promptTokens, usage.promptTokens),
        completionTokens: add(acc.completionTokens, usage.completionTokens),
        reasoningTokens: add(acc.reasoningTokens, usage.reasoningTokens),
        totalTokens: add(acc.totalTokens, usage.totalTokens),
        costUsd: add(acc.costUsd, usage.costUsd),
        elapsedMs: acc.elapsedMs + attempt.elapsedMs,
      };
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      elapsedMs: 0,
    },
  );
  return { calls: attempts.length, ...totals, usageMissing };
}

function tallyOf(judges: readonly JudgeOutcome[]): Tally {
  return {
    guilty: judges.filter((judge) => judge.verdict === "guilty").length,
    notGuilty: judges.filter((judge) => judge.verdict === "not_guilty").length,
    failed: judges.filter((judge) => judge.verdict === null).length,
  };
}

/**
 * A majority is two of the three seats — not two of however many happened to answer.
 * Two agreeing judges carry it even with the third failed, because two of three is a
 * majority of the bench either way.
 */
function outcomeOf(judges: readonly JudgeOutcome[], statements: StatementsResult): RunOutcome {
  if (statements.abort) {
    return {
      kind: "aborted",
      reason: statements.abort.reason,
      message: statements.abort.message,
    };
  }

  const tally = tallyOf(judges);
  if (tally.guilty >= 2) return { kind: "verdict", verdict: "guilty", tally };
  if (tally.notGuilty >= 2) return { kind: "verdict", verdict: "not_guilty", tally };
  if (tally.guilty === 1 && tally.notGuilty === 1) return { kind: "hung", tally };

  const ruled = tally.guilty + tally.notGuilty;
  return {
    kind: "inconclusive",
    tally,
    why:
      ruled === 0
        ? "No judge returned a readable verdict."
        : "Only one judge returned a verdict, and one judge is not a bench.",
  };
}

/** Roles that answered on the same model — possible once the free router resolves. */
function collisionsOf(
  statements: readonly StatementOutcome[],
  judges: readonly JudgeOutcome[],
): ModelCollision[] {
  const byModel = new Map<string, string[]>();
  const note = (model: string | null, role: string): void => {
    if (!model) return;
    byModel.set(model, [...(byModel.get(model) ?? []), role]);
  };

  for (const statement of statements) note(statement.model, `advocate:${statement.advocateId}`);
  for (const judge of judges) note(judge.model, `judge:${judge.judgeId}`);

  return [...byModel.entries()]
    .filter(([, roles]) => roles.length > 1)
    .map(([model, roles]) => ({ model, roles }));
}

/** The maker half of an identifier — `nvidia` in `nvidia/nemotron-3-nano-30b-a3b:free`. */
function makerOf(model: string): string {
  return model.split("/")[0];
}

/**
 * Judges sharing a maker. Read from the model that *answered*, never the one requested —
 * a fallback is exactly how this arises, so asking what was requested would miss it.
 */
function lineageOf(judges: readonly JudgeOutcome[]): LineageCollision[] {
  const byMaker = new Map<string, string[]>();
  for (const judge of judges) {
    if (!judge.model) continue;
    const maker = makerOf(judge.model);
    byMaker.set(maker, [...(byMaker.get(maker) ?? []), judge.judgeId]);
  }
  return [...byMaker.entries()]
    .filter(([, seats]) => seats.length > 1)
    .map(([maker, seats]) => ({ maker, judges: seats }));
}

/** Folds a finished run into the one object every renderer reads. */
export function aggregate(input: AggregateInput): RunRecord {
  const { run, models, statements, startedAt, finishedAt } = input;
  const judges = input.judging?.judges ?? [];
  const attempts = [...statements.attempts, ...(input.judging?.attempts ?? [])];
  const tally = tallyOf(judges);

  return {
    chargeSheet: run.chargeSheet,
    chargeSheetWords: run.chargeSheetWords,
    defendant: { id: run.defendant.id, name: run.defendant.name },
    casting: run.advocates.map((advocate: CastAdvocate) => ({
      id: advocate.character.id,
      name: advocate.character.name,
      side: advocate.side,
    })),
    mode: models.mode,
    statements: statements.statements,
    judges,
    outcome: outcomeOf(judges, statements),
    tally,
    attempts,
    totals: sumUsage(attempts),
    complete: statements.complete && judges.length > 0 && tally.failed === 0,
    collisions: collisionsOf(statements.statements, judges),
    benchLineage: lineageOf(judges),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}
