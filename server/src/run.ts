/**
 * run.ts — one whole run, start to record, as a plain function.
 *
 * specs.md Part 3 keeps the pipeline stages as functions the routing layer calls, so this
 * is the fourth of them: `setup → statements → judging → aggregate` assembled once, with
 * a hook that pushes each result the moment it settles. `app.ts` turns those pushes into
 * SSE frames; a script can pass a hook that prints them. Nothing here knows about HTTP.
 *
 * Three things live at this level because nothing below it can see them:
 *
 *   1. **The whole-run deadline.** `openrouter.ts` bounds a single call at 90s and three
 *      attempts. A run is two sequential waves of parallel calls — four advocates, then
 *      three judges — so the worst case is 2 waves x 3 attempts x 90s = 540s. Without a
 *      cap at this level a hung free model would stall the stream silently for as long as
 *      it liked. On the deadline the run aborts **keeping every partial result**: the
 *      roles that answered are in the record, the ones that never reported are marked
 *      failed, and the record says the run timed out rather than pretending the bench
 *      simply lost some judges.
 *
 *   2. **The daily cap.** specs.md Part 5: a 429 for the account's exhausted daily free
 *      allowance is a different animal from a 429 on one model, and it "stops the run at
 *      once and reports itself in plain words, because 'try again in a moment' is wrong
 *      advice when the answer is tomorrow." Only a whole run can tell that story: an
 *      advocate that failed sees one refusal, but a wave in which the cap appears at all
 *      means the three judge calls after it would be refused too. So the run stops there
 *      rather than spending three more requests to be told the same thing.
 *
 *   3. **Nothing is emitted after the record.** The waves below run to completion whether
 *      or not anyone is still waiting for them, so a call that lands after the deadline
 *      would otherwise fire its hook behind the closing event. Part 3 has the finished
 *      record close the stream; `emit` enforces that literally.
 */

import { aggregate, type RunRecord } from "./aggregate.js";
import type { Mode, RunModels } from "./config.js";
import type { TribunalData } from "./data.js";
import { runJudging, type JudgeOutcome } from "./judging.js";
import type { Attempt } from "./openrouter.js";
import type { CastAdvocate, ValidRun } from "./preflight.js";
import { ADVOCATE_WORD_CAP, JUDGE_WORD_CAP } from "./prompts.js";
import type { RunEventName } from "./run-buffer.js";
import {
  runStatements,
  toDeliveredStatements,
  type ChatCaller,
  type StatementOutcome,
  type StatementsAbort,
  type StatementsResult,
} from "./statements.js";

/**
 * Two waves x three attempts x the 90s per-call timeout. Derived from the shape of a run,
 * not chosen: raising the per-call timeout or the attempt cap without raising this would
 * let a single wave outlive the run that contains it.
 *
 * A ceiling, emphatically not a target. Three measured runs finished in 26, 77 and 101
 * seconds; this number is what a run would take if every one of its seven calls failed
 * twice and answered on the third, which has never happened.
 */
export const RUN_TIMEOUT_MS = 540_000;

export type RunEmit = (event: RunEventName, data: unknown) => void;

export interface ExecuteRunOptions {
  readonly run: ValidRun;
  readonly data: TribunalData;
  /** The seven models for this run, already resolved so the caller can announce them. */
  readonly models: RunModels;
  /** Fired as each role settles, and once more with the finished record. */
  readonly emit: RunEmit;
  /** The seam the tests replace. Defaults to the real OpenRouter client. */
  readonly call?: ChatCaller;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

const TIMED_OUT = Symbol("timed-out");

/**
 * Races a wave against what is left of the run's deadline. The wave is not cancelled —
 * the requests are already in flight and their tokens are already being spent — it is
 * simply no longer waited on, and what its hook already reported is what the record keeps.
 */
async function beforeDeadline<T>(work: Promise<T>, msLeft: number): Promise<T | typeof TIMED_OUT> {
  if (msLeft <= 0) return TIMED_OUT;
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), msLeft);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/** An advocate the deadline overtook: a real gap in the record, never a silent absence. */
function unreportedStatement(
  advocate: CastAdvocate,
  requestedModel: string,
  message: string,
): StatementOutcome {
  return {
    advocateId: advocate.character.id,
    name: advocate.character.name,
    side: advocate.side,
    ok: false,
    text: null,
    words: null,
    wordCap: ADVOCATE_WORD_CAP,
    overCap: false,
    requestedModel,
    model: null,
    error: message,
    errorKind: "timeout",
    problem: null,
    rescreened: false,
    attempts: [],
  };
}

/** The same, for a seat on the bench. `verdict: null` — a missing verdict is never filled. */
function unreportedJudge(
  judge: { readonly id: string; readonly name: string },
  requestedModel: string,
  message: string,
): JudgeOutcome {
  return {
    judgeId: judge.id,
    name: judge.name,
    verdict: null,
    reasoning: "",
    reasoningWords: 0,
    wordCap: JUDGE_WORD_CAP,
    overCap: false,
    reasonCount: 0,
    thinReasoning: true,
    route: "none",
    problem: null,
    retryReason: null,
    requestedModel,
    model: null,
    rawText: null,
    ok: false,
    error: message,
    errorKind: "timeout",
    attempts: [],
  };
}

const TIMEOUT_MESSAGE =
  "The run passed its overall time limit before this call came back. What had already " +
  "arrived is kept; nothing was invented for what had not.";

function timedOutAbort(seconds: number): StatementsAbort {
  return {
    reason: "run_timeout",
    message:
      `The run passed its ${seconds}-second limit before the advocates finished, so the ` +
      "judges were never asked. Everything that did arrive is kept below. Free models are " +
      "sometimes very slow — running the case again usually draws a different set.",
  };
}

const DAILY_LIMIT_ABORT: StatementsAbort = {
  reason: "daily_limit",
  message:
    "OpenRouter's daily free-model allowance is spent, so no further model can be called " +
    "today. The run was stopped here rather than spending the judges' requests to be " +
    "refused three more times. This is not a problem with your case — the allowance " +
    "resets at 00:00 UTC.",
};

/**
 * Whether the account-wide daily cap showed up anywhere in the wave — read both from how
 * each role failed and from the individual request rows, because one advocate can be
 * refused for the cap while another was merely rate-limited on its own model, and it is
 * the presence of the cap anywhere that decides the run.
 */
function hitDailyLimit(statements: StatementsResult): boolean {
  return (
    statements.statements.some((statement) => statement.errorKind === "daily_limit") ||
    statements.attempts.some((attempt: Attempt) => attempt.errorKind === "daily_limit")
  );
}

/**
 * Runs one case and returns the record every renderer reads.
 *
 * It resolves rather than rejects for anything a model did — a failed advocate, a silenced
 * side, an exhausted allowance, a run that ran out of time are all *outcomes*, and each is
 * carried honestly in the record. It rejects only for a fault in the app itself, which is
 * the routing layer's `error` event rather than a run at all.
 */
export async function executeRun(options: ExecuteRunOptions): Promise<RunRecord> {
  const { run, data, models } = options;
  const mode: Mode = models.mode;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS;

  const startedAt = now();
  const deadline = startedAt.getTime() + timeoutMs;
  const msLeft = (): number => deadline - now().getTime();

  // Part 3: the finished record closes the stream. Anything a late call reports after
  // that is dropped rather than arriving behind the closing event.
  let sealed = false;
  const emit: RunEmit = (event, payload) => {
    if (sealed) return;
    if (event === "done" || event === "error") sealed = true;
    options.emit(event, payload);
  };

  const seenStatements: StatementOutcome[] = [];
  const statementsWave = runStatements({
    run,
    data,
    mode,
    models: models.advocates,
    ...(options.call ? { call: options.call } : {}),
    onStatement: (statement) => {
      seenStatements.push(statement);
      emit("statement", statement);
    },
  });

  const waveResult = await beforeDeadline(statementsWave, msLeft());
  // A wave the deadline overtook is rebuilt from what its hook reported, with the
  // advocates who never came back written in as the gaps they are.
  const statements: StatementsResult =
    waveResult === TIMED_OUT
      ? partialStatements(run, models, seenStatements, timedOutAbort(Math.round(timeoutMs / 1000)))
      : waveResult;

  // The daily cap outranks whatever the wave itself concluded: "no advocate answered, try
  // again" is wrong advice when every free model is refusing the account until tomorrow.
  const abort = hitDailyLimit(statements) ? DAILY_LIMIT_ABORT : statements.abort;
  const afterStatements: StatementsResult =
    abort === statements.abort ? statements : { ...statements, abort };

  if (afterStatements.abort) {
    return finish(emit, {
      run,
      models,
      statements: afterStatements,
      judging: null,
      startedAt,
      finishedAt: now(),
    });
  }

  const seenJudges: JudgeOutcome[] = [];
  const judgingWave = runJudging({
    run,
    data,
    mode,
    models: models.judges,
    statements: toDeliveredStatements(afterStatements),
    ...(options.call ? { call: options.call } : {}),
    onVerdict: (judge) => {
      seenJudges.push(judge);
      emit("judge", judge);
    },
  });

  const benchResult = await beforeDeadline(judgingWave, msLeft());
  const judging =
    benchResult === TIMED_OUT
      ? {
          judges: partialJudges(data, models, seenJudges),
          attempts: seenJudges.flatMap((judge) => judge.attempts),
        }
      : benchResult;

  return finish(emit, {
    run,
    models,
    statements: afterStatements,
    judging,
    startedAt,
    finishedAt: now(),
  });
}

/** Folds the run and sends the record that closes the stream — one record, one emit. */
function finish(emit: RunEmit, input: Parameters<typeof aggregate>[0]): RunRecord {
  const record = aggregate(input);
  emit("done", record);
  return record;
}

function partialStatements(
  run: ValidRun,
  models: RunModels,
  seen: readonly StatementOutcome[],
  abort: StatementsAbort,
): StatementsResult {
  const byId = new Map(seen.map((statement) => [statement.advocateId, statement]));
  // Casting order, not arrival order — the order is part of the record.
  const statements = run.advocates.map(
    (advocate, index) =>
      byId.get(advocate.character.id) ??
      unreportedStatement(advocate, models.advocates[index] as string, TIMEOUT_MESSAGE),
  );
  const delivered = statements.filter((statement) => statement.ok);
  return {
    statements,
    delivered,
    complete: false,
    abort,
    attempts: statements.flatMap((statement) => statement.attempts),
  };
}

function partialJudges(
  data: TribunalData,
  models: RunModels,
  seen: readonly JudgeOutcome[],
): readonly JudgeOutcome[] {
  const byId = new Map(seen.map((judge) => [judge.judgeId, judge]));
  return data.judges.map(
    (judge, index) =>
      byId.get(judge.id) ?? unreportedJudge(judge, models.judges[index] as string, TIMEOUT_MESSAGE),
  );
}
