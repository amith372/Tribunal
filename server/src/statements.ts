/**
 * statements.ts — the advocate wave: four independent calls, in parallel, none of them
 * aware of the others (specs.md Part 1: "Advocates each speak once; there is no debate,
 * and no advocate sees another's statement").
 *
 * The model caller is injected, defaulting to the real one, so the whole wave — the
 * parallelism, the failure handling, the abort rule — is unit-testable with no API key
 * and no network.
 *
 * **A failed advocate is a gap, not a dead run.** `openrouter.ts` has already walked
 * the fallback chain by the time a call throws here. When one still fails, that
 * advocate is marked failed and judging proceeds on the statements that did arrive; the
 * run is labelled incomplete and fails specs.md Part 2's four-statement criterion
 * openly, rather than being thrown away.
 *
 * **But losing a whole side aborts the run.** Judges hearing only the prosecution would
 * return a verdict that looks legitimate and is structurally rigged, and the exported
 * HTML would carry it as a real result. An honest error beats a rigged verdict.
 *
 * **Over-length is measured here and not acted on.** `words` and `overCap` are recorded
 * against the cap the prompt stated. What to *do* about an over-length statement — flag
 * it, trim at the last full sentence, or ask again for brevity — is deliberately
 * undecided until there are real numbers from real calls.
 */

import { fallbackChainFor, type Mode } from "./config.js";
import type { TribunalData } from "./data.js";
import {
  OpenRouterError,
  callChat,
  type Attempt,
  type CallOptions,
  type CallResult,
  type ErrorKind,
} from "./openrouter.js";
import type { Side, ValidRun } from "./preflight.js";
import { buildAdvocatePrompt, countWords, type DeliveredStatement } from "./prompts.js";
import { checkStatement, type StatementProblem } from "./statement-check.js";

/** Thrown when both replies failed the screen. Carries every attempt for the table. */
class StatementRefused extends Error {
  constructor(
    readonly check: ReturnType<typeof checkStatement>,
    readonly attempts: readonly Attempt[],
  ) {
    super(check.detail ?? "The reply was not a statement.");
    this.name = "StatementRefused";
  }
}

/** The seam the tests replace. Signature-identical to `callChat`. */
export type ChatCaller = (options: CallOptions) => Promise<CallResult>;

export interface StatementOutcome {
  readonly advocateId: string;
  readonly name: string;
  readonly side: Side;
  readonly ok: boolean;
  readonly text: string | null;
  /** Words in the delivered statement, `null` if none arrived. */
  readonly words: number | null;
  readonly wordCap: number;
  /** Measured against the cap the prompt stated. Nothing acts on it yet. */
  readonly overCap: boolean;
  /** The identifier asked for first. */
  readonly requestedModel: string;
  /** The identifier that answered — differs when the fallback router resolved. */
  readonly model: string | null;
  readonly error: string | null;
  readonly errorKind: ErrorKind | null;
  /** Why a reply was refused as not-a-statement, if one was (specs.md Part 5). */
  readonly problem: StatementProblem | null;
  /** True when a refused first reply bought one more call. */
  readonly rescreened: boolean;
  /** Every request made for this advocate, including retries and fallbacks. */
  readonly attempts: readonly Attempt[];
}

export type AbortReason = "no_statements" | "side_silenced";

export interface StatementsAbort {
  readonly reason: AbortReason;
  /** Written to be shown as-is, like the pre-flight refusals. */
  readonly message: string;
}

export interface StatementsResult {
  /** All four, in casting order, whether they succeeded or not. */
  readonly statements: readonly StatementOutcome[];
  /** Only those that arrived, in casting order. What the judges will hear. */
  readonly delivered: readonly StatementOutcome[];
  /** True only when all four arrived (specs.md Part 2's four-statement criterion). */
  readonly complete: boolean;
  /** Set when judging must not proceed. `delivered` is still populated for the record. */
  readonly abort: StatementsAbort | null;
  /** Every attempt across the wave, for the token table. */
  readonly attempts: readonly Attempt[];
}

export interface StatementsOptions {
  readonly run: ValidRun;
  readonly data: TribunalData;
  readonly mode: Mode;
  /** One model per advocate, in casting order, from `resolveRunModels`. */
  readonly models: readonly string[];
  readonly call?: ChatCaller;
  /** Fired as each advocate settles, so the SSE stream can send them one at a time. */
  readonly onStatement?: (statement: StatementOutcome) => void;
}

/** What the judges are shown: the side and the text, never the speaker. */
export function toDeliveredStatements(
  result: StatementsResult,
): readonly DeliveredStatement[] {
  return result.delivered.map((statement) => ({
    side: statement.side,
    text: statement.text as string,
  }));
}

/**
 * Runs the four advocate calls in parallel and returns them in casting order,
 * regardless of the order they finished in — the order is part of the run record and
 * should not depend on which free model happened to be quick.
 */
export async function runStatements(options: StatementsOptions): Promise<StatementsResult> {
  const { run, data, mode, models } = options;
  const call = options.call ?? callChat;

  const statements = await Promise.all(
    run.advocates.map(async (advocate, index) => {
      const requestedModel = models[index] as string;
      const prompt = buildAdvocatePrompt(run, advocate, data);

      const base = {
        advocateId: advocate.character.id,
        name: advocate.character.name,
        side: advocate.side,
        wordCap: prompt.wordCap,
        requestedModel,
      };

      const request = {
        models: fallbackChainFor(requestedModel, mode, "advocate", models),
        messages: prompt.messages,
        maxTokens: prompt.maxTokens,
        label: prompt.label,
      };

      let outcome: StatementOutcome;
      try {
        let result = await call(request);
        let screen = checkStatement(result.text, result.finishReason);
        let rescreened = false;
        const attempts: Attempt[] = [...result.attempts];

        // specs.md Part 5: a reply that is about the task rather than the case is worth
        // one more call. Temperature 0 for the retry, as with an unreadable verdict.
        if (!screen.usable) {
          rescreened = true;
          // **The retry moves to a different model.** Unlike an unreadable verdict —
          // a formatting slip that temperature 0 can fix on the same model — a reply
          // about the task rather than the case is a behavioural tendency, and asking
          // again mostly returns another one. Measured on 2026-08-21: one advocate
          // model produced meta-commentary on both attempts of the same call, and the
          // same model did it again in the next run. So the model that produced the
          // refused text is dropped from the chain for the second ask.
          const refused = result.attempts.filter((a) => a.ok).at(-1)?.requestedModel;
          const remaining = request.models.filter((model) => model !== refused);
          const second = await call({
            ...request,
            models: remaining.length > 0 ? remaining : request.models,
            temperature: 0,
          });
          attempts.push(...second.attempts);
          const secondScreen = checkStatement(second.text, second.finishReason);
          if (secondScreen.usable) {
            result = second;
            screen = secondScreen;
          } else {
            // Never trimmed, never patched — an invented statement is the same error
            // as an invented verdict.
            throw new StatementRefused(secondScreen, attempts);
          }
        }

        const wordCount = countWords(result.text);
        outcome = {
          ...base,
          ok: true,
          text: result.text,
          words: wordCount,
          overCap: wordCount > prompt.wordCap,
          model: result.model,
          error: null,
          errorKind: null,
          problem: null,
          rescreened,
          attempts,
        };
      } catch (error) {
        const refused = error instanceof StatementRefused ? error : null;
        const failure = error as Error;
        outcome = {
          ...base,
          ok: false,
          text: null,
          words: null,
          overCap: false,
          model: null,
          error: refused ? (refused.check.detail as string) : failure.message,
          errorKind: error instanceof OpenRouterError ? error.kind : null,
          problem: refused ? refused.check.problem : null,
          rescreened: refused !== null,
          attempts: refused
            ? refused.attempts
            : error instanceof OpenRouterError
              ? error.attempts
              : [],
        };
      }

      options.onStatement?.(outcome);
      return outcome;
    }),
  );

  const delivered = statements.filter((statement) => statement.ok);

  return {
    statements,
    delivered,
    complete: delivered.length === statements.length,
    abort: abortReason(statements, delivered),
    attempts: statements.flatMap((statement) => statement.attempts),
  };
}

/**
 * Judging proceeds on a gap, and stops on a silenced side.
 *
 * A side with nothing to say is not a thinner trial, it is a different one: whatever
 * the judges then return is a verdict on an unopposed case.
 */
function abortReason(
  statements: readonly StatementOutcome[],
  delivered: readonly StatementOutcome[],
): StatementsAbort | null {
  if (delivered.length === 0) {
    return {
      reason: "no_statements",
      message:
        "No advocate managed to deliver a statement, so there is nothing for the judges to " +
        "weigh. This is a model failure, not a problem with your case — try the run again.",
    };
  }

  for (const side of ["for", "against"] as const) {
    const cast = statements.filter((statement) => statement.side === side);
    if (cast.length > 0 && !cast.some((statement) => statement.ok)) {
      const label = side === "for" ? "defense" : "prosecution";
      return {
        reason: "side_silenced",
        message:
          `Both advocates for the ${label} failed to deliver a statement, so the judges would ` +
          `hear only one side. A verdict reached that way would look legitimate and be rigged, ` +
          "so the run was stopped instead. Try the run again.",
      };
    }
  }

  return null;
}
