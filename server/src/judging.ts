/**
 * judging.ts — the judge wave: three calls in parallel, each read by `judge-parser.ts`
 * and retried once at temperature 0 if the reply could not be read.
 *
 * specs.md Part 5: "A judge may return prose instead of the required form — read the
 * verdict from the text, retry the call once, and only then mark it an error; never
 * invent a verdict." The three steps are exactly the three below, and there is no
 * fourth step in which a verdict gets supplied.
 *
 * **Two retries are possible and they are not the same retry:**
 *
 *   · *No verdict could be read.* One more call, same model, temperature 0. If the
 *     second reply is unreadable too, the judge is an error — and a run with a failed
 *     judge is Hung or Inconclusive downstream, never a forced verdict.
 *
 *   · *A verdict, but no reasoning at all.* One more call, same model, temperature 0,
 *     and then it is accepted either way. **The first verdict always stands**: the
 *     retry can supply the missing reasoning but can never change the ruling, because
 *     the first ruling was validly given and this retry was about prose. If the second
 *     reply rules differently, its reasoning is not attached — that would be reasoning
 *     for a verdict it did not accompany.
 *
 * **Thin reasoning is not an error.** One reason, or a hundred and ten words, is
 * accepted and counts toward the majority. specs.md Part 2's "at least two distinct
 * reasons" is measured and reported (`reasonCount`, `thinReasoning`), never enforced by
 * discarding a real verdict.
 *
 * The model caller is injected, so the whole ladder is unit-testable with no API key
 * and no network.
 */

import { fallbackChainFor, type Mode } from "./casting.js";
import { releaseWave } from "./dispatch.js";
import type { TribunalData } from "./data.js";
import {
  OpenRouterError,
  callChat,
  type Attempt,
  type CallResult,
  type ErrorKind,
} from "./openrouter.js";
import type { ValidRun } from "./preflight.js";
import { buildJudgePrompt, type DeliveredStatement } from "./prompts.js";
import {
  parseJudgeReply,
  type SalvageProblem,
  type SalvageRoute,
  type Verdict,
} from "./judge-parser.js";
import type { ChatCaller } from "./statements.js";

/** specs.md Part 2 asks for at least two distinct reasons. Reported, never enforced. */
export const EXPECTED_REASONS = 2;

export type RetryReason = "unreadable_reply" | "empty_reasoning";

export interface JudgeOutcome {
  readonly judgeId: string;
  readonly name: string;
  /** `null` only when the judge failed or both replies were unreadable. Never invented. */
  readonly verdict: Verdict | null;
  readonly reasoning: string;
  readonly reasoningWords: number;
  readonly wordCap: number;
  /** Measured against the cap the prompt stated. Nothing acts on it yet. */
  readonly overCap: boolean;
  readonly reasonCount: number;
  /** Fewer than two distinct reasons — shown on the results panel, never a rejection. */
  readonly thinReasoning: boolean;
  /** How the verdict was read out of the reply. */
  readonly route: SalvageRoute;
  readonly problem: SalvageProblem | null;
  readonly retryReason: RetryReason | null;
  readonly requestedModel: string;
  readonly model: string | null;
  /** Exactly what the model sent, for the run record. */
  readonly rawText: string | null;
  readonly ok: boolean;
  readonly error: string | null;
  readonly errorKind: ErrorKind | null;
  readonly attempts: readonly Attempt[];
}

export interface JudgingResult {
  readonly judges: readonly JudgeOutcome[];
  readonly attempts: readonly Attempt[];
}

export interface JudgingOptions {
  /**
   * Milliseconds between releasing one call in this wave and the next.
   *
   * Defaults to `WAVE_STAGGER_MS`. A test that measures whether the wave is *parallel* sets
   * it to 0, because pacing and parallelism are different properties and a test for one
   * should not be able to fail on the other — `dispatch.test.ts` covers the pacing.
   */
  readonly staggerMs?: number;
  readonly run: ValidRun;
  readonly data: TribunalData;
  readonly mode: Mode;
  /** One model per judge, in `data.judges` order, from `resolveRunModels`. */
  readonly models: readonly string[];
  /** The delivered statements, labelled by side only. */
  readonly statements: readonly DeliveredStatement[];
  readonly call?: ChatCaller;
  /** Fired as each judge settles, so the SSE stream can send them one at a time. */
  readonly onVerdict?: (judge: JudgeOutcome) => void;
}

/**
 * Runs the three judge calls in parallel and returns them in `data.judges` order,
 * regardless of which finished first.
 */
export async function runJudging(options: JudgingOptions): Promise<JudgingResult> {
  const { run, data, mode, models, statements } = options;
  const call = options.call ?? callChat;

  // The bench is released a stagger apart too, and is the wave that needs it more: it is
  // rate-limited more often than the advocates despite being smaller (`dispatch.ts`).
  const judges = await releaseWave(
    data.judges.map((judge, index) => async () => {
      const requestedModel = models[index];
      const prompt = buildJudgePrompt(run, judge, statements);
      const chain = fallbackChainFor(requestedModel, mode, "judge", models);
      const attempts: Attempt[] = [];

      const base = {
        judgeId: judge.id,
        name: judge.name,
        wordCap: prompt.wordCap,
        requestedModel,
      };

      // The retry is a deliberate second ask of the same model at temperature 0, not
      // another walk down the fallback chain — one logical call becomes at most three
      // requests, which keeps a run inside OpenRouter's per-minute limit.
      const ask: Ask = (retry = false) =>
        call({
          models: retry ? [requestedModel] : chain,
          messages: prompt.messages,
          maxTokens: prompt.maxTokens,
          label: prompt.label,
          // `priorAttempts` continues the numbering, so the retry reads as the third row
          // of one call rather than the first row of a second one.
          ...(retry
            ? { temperature: 0, maxAttempts: 1, priorAttempts: attempts.length }
            : {}),
        });

      let outcome: JudgeOutcome;
      try {
        const first = await ask();
        attempts.push(...first.attempts);
        const parsed = parseJudgeReply(first.text);

        // A reply the provider cut off is not an answer, however much of it parses.
        // `statement-check.ts` has always read `finish_reason` this way on the advocate
        // side; the bench had no equivalent, so a severed reply went to the parser as
        // though it were finished. Measured 2026-08-21: a judge spent 1,231 tokens
        // thinking against a 1,000 ceiling and his reasoning ended mid-sentence — the
        // parser salvaged a verdict from the fragment and nothing recorded that the
        // reply had been truncated at all. Treated as unreadable now, which buys the
        // retry the spec already provides for.
        if (first.finishReason === "length") {
          outcome = await afterUnreadable(base, first, truncated(parsed), ask, attempts);
        } else if (!parsed.verdict) {
          outcome = await afterUnreadable(base, first, parsed, ask, attempts);
        } else if (!parsed.reasoning) {
          outcome = await afterEmptyReasoning(base, first, parsed, ask, attempts);
        } else {
          outcome = settle(base, first, parsed, null, attempts);
        }
      } catch (error) {
        const failure = error as Error;
        if (error instanceof OpenRouterError) attempts.push(...error.attempts);
        outcome = {
          ...base,
          verdict: null,
          reasoning: "",
          reasoningWords: 0,
          overCap: false,
          reasonCount: 0,
          thinReasoning: true,
          route: "none",
          problem: null,
          retryReason: null,
          model: null,
          rawText: null,
          ok: false,
          error: failure.message,
          errorKind: error instanceof OpenRouterError ? error.kind : null,
          attempts,
        };
      }

      options.onVerdict?.(outcome);
      return outcome;
    }),
    options.staggerMs,
  );

  return { judges, attempts: judges.flatMap((judge) => judge.attempts) };
}

type Base = Pick<JudgeOutcome, "judgeId" | "name" | "wordCap" | "requestedModel">;
type Parsed = ReturnType<typeof parseJudgeReply>;
type Ask = (retry?: boolean) => Promise<CallResult>;

/**
 * Marks a parse as unusable because the reply was cut off, whatever the text managed
 * to yield. The verdict is dropped deliberately: a severed reply can parse cleanly and
 * still be half a ruling.
 */
function truncated(parsed: Parsed): Parsed {
  return { ...parsed, verdict: null, route: "none", problem: "truncated" };
}

/** Builds the outcome for a reply that was read successfully. */
function settle(
  base: Base,
  result: CallResult,
  parsed: Parsed,
  retryReason: RetryReason | null,
  attempts: readonly Attempt[],
  reasoningOverride?: Parsed,
): JudgeOutcome {
  const reasoning = reasoningOverride ?? parsed;
  return {
    ...base,
    verdict: parsed.verdict,
    reasoning: reasoning.reasoning,
    reasoningWords: reasoning.reasoningWords,
    overCap: reasoning.reasoningWords > base.wordCap,
    reasonCount: reasoning.reasonCount,
    thinReasoning: reasoning.reasonCount < EXPECTED_REASONS,
    route: parsed.route,
    problem: parsed.problem,
    retryReason,
    model: result.model,
    rawText: result.text,
    ok: parsed.verdict !== null,
    error: null,
    errorKind: null,
    attempts,
  };
}

/**
 * The reply could not be read. One more call, temperature 0, same model. If that one
 * cannot be read either, the judge is an error — the parse problem is kept so the
 * results panel can say *why* rather than just "failed".
 */
async function afterUnreadable(
  base: Base,
  first: CallResult,
  firstParse: Parsed,
  ask: Ask,
  attempts: Attempt[],
): Promise<JudgeOutcome> {
  let second: CallResult;
  try {
    second = await ask(true);
  } catch (error) {
    if (error instanceof OpenRouterError) attempts.push(...error.attempts);
    return unreadable(base, first, firstParse, attempts, (error as Error).message);
  }
  attempts.push(...second.attempts);

  // The retry is held to the same standard as the first reply: a severed answer is not
  // an answer just because it is the second one. Without this the ceiling failure would
  // slip through on the retry, which is exactly where it is least likely to be noticed.
  const parsed = second.finishReason === "length"
    ? truncated(parseJudgeReply(second.text))
    : parseJudgeReply(second.text);
  if (parsed.verdict) return settle(base, second, parsed, "unreadable_reply", attempts);
  return unreadable(base, second, parsed, attempts, null);
}

function unreadable(
  base: Base,
  result: CallResult,
  parsed: Parsed,
  attempts: readonly Attempt[],
  callError: string | null,
): JudgeOutcome {
  return {
    ...base,
    verdict: null,
    reasoning: "",
    reasoningWords: 0,
    overCap: false,
    reasonCount: 0,
    thinReasoning: true,
    route: parsed.route,
    problem: parsed.problem,
    retryReason: "unreadable_reply",
    model: result.model,
    rawText: result.text,
    ok: false,
    error:
      callError ??
      `${base.name} gave no readable verdict in two attempts (${parsed.problem ?? "unreadable"}). ` +
        "No verdict was inferred from the text.",
    errorKind: null,
    attempts,
  };
}

/**
 * A real verdict arrived with no reasoning at all. One more call, temperature 0, and
 * then it is accepted whatever comes back. The first verdict stands throughout — the
 * retry may fill in the reasoning, never overturn the ruling.
 */
async function afterEmptyReasoning(
  base: Base,
  first: CallResult,
  firstParse: Parsed,
  ask: Ask,
  attempts: Attempt[],
): Promise<JudgeOutcome> {
  let second: CallResult;
  try {
    second = await ask(true);
  } catch (error) {
    // The verdict is already in hand, so a failed retry costs the reasoning and nothing
    // more. Its attempts still belong in the token table.
    if (error instanceof OpenRouterError) attempts.push(...error.attempts);
    return settle(base, first, firstParse, "empty_reasoning", attempts);
  }
  attempts.push(...second.attempts);

  const parsed = parseJudgeReply(second.text);
  const usable = parsed.reasoning !== "" && parsed.verdict === firstParse.verdict;
  return settle(base, first, firstParse, "empty_reasoning", attempts, usable ? parsed : undefined);
}
