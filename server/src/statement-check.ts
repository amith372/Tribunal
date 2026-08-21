/**
 * statement-check.ts — the screen an advocate's reply passes before it becomes a
 * statement. The advocates' answer to `judge-parser.ts`.
 *
 * specs.md Part 5: a judge's text goes through a parser that refuses what it cannot
 * read, while whatever an advocate returns simply *is* the statement — shown to the
 * user, put in front of all three judges, and written into the export. A model that
 * answers with its own working ("the user wants a statement as Tyrion, under 120
 * words, let me draft") would have that judged as a courtroom argument.
 *
 * The principle is the parser's: **lenient about style, strict about whether the thing
 * is a statement at all.** An advocate may be florid, rude, one sentence long, or over
 * its word cap — none of that is this module's business. What it refuses is a reply
 * that is about the *task* rather than about the *case*, plus one that arrived empty or
 * was cut off mid-thought.
 *
 * It never rewrites. Trimming the meta-commentary off the front and keeping the rest
 * would be the app writing part of the statement, which is the same error as inventing
 * a verdict. A refused reply is worth one more call and then an honest failure.
 */

export type StatementProblem = "empty" | "truncated" | "meta_commentary";

export interface StatementCheck {
  readonly usable: boolean;
  readonly problem: StatementProblem | null;
  /** Written to be read on screen and in the export, like the pre-flight refusals. */
  readonly detail: string | null;
}

/**
 * Phrases that belong to the machinery of being asked, not to a courtroom. Each is
 * chosen to be one an advocate arguing a case would have no reason to write — the
 * tests hold real statements against them to keep that true.
 *
 * Deliberately *not* here: "I", "let me be plain", "my lord", or anything else a
 * character might actually say. A false refusal costs a real statement and a retry;
 * these patterns are the ones worth that risk.
 */
const META_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bthe user\b/i, "addresses “the user”"],
  [/\buser wants\b/i, "describes what the user wants"],
  [/\bthe (system )?prompt\b/i, "refers to the prompt"],
  [/\bthe assistant\b/i, "refers to the assistant"],
  [/\bas an ai\b/i, "refers to itself as an AI"],
  [/\blanguage model\b/i, "refers to itself as a language model"],
  [/\bword count\b/i, "discusses the word count"],
  [/\b(at most|under|within|max(imum)?|about|around|roughly)\s+\d{2,3}\s*words\b/i, "discusses its word limit"],
  [/\blet me (draft|write|count|craft|produce)\b/i, "narrates drafting"],
  [/\bfirst[- ]person\b/i, "discusses the required voice"],
  [/^\s*draft\s*:/im, "is labelled a draft"],
  [/<\/?think>/i, "carries reasoning tags"],
];

/**
 * @param text  the reply as it arrived, already trimmed by the caller.
 * @param finishReason  the API's `finish_reason`; `length` means it was cut off.
 */
export function checkStatement(text: string, finishReason: string | null): StatementCheck {
  if (text.trim().length === 0) {
    return { usable: false, problem: "empty", detail: "The reply was empty." };
  }

  for (const [pattern, description] of META_PATTERNS) {
    if (pattern.test(text)) {
      return {
        usable: false,
        problem: "meta_commentary",
        detail: `The reply ${description} rather than arguing the case.`,
      };
    }
  }

  // Checked after the meta patterns on purpose: a truncated reply full of the model's
  // working should be reported for what it is, which is the more useful diagnosis.
  if (finishReason === "length") {
    return {
      usable: false,
      problem: "truncated",
      detail: "The reply was cut off before it finished.",
    };
  }

  return { usable: true, problem: null, detail: null };
}
