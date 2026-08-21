/**
 * The judge-reply case catalogue — one list, read by two things:
 *   - `judge-parser.test.ts`, which asserts each case comes out as stated;
 *   - `server/scripts/parser-table.ts`, which prints the same cases as a table showing
 *     what went in and what was salvaged out.
 *
 * Same arrangement as `preflight-cases.ts`, for the same reason: the printed table
 * cannot claim a salvage the tests do not hold to, and the table is what gets read at
 * the stage gate instead of the code.
 *
 * The replies below are the shapes free models actually produce — the six the build
 * plan names (prose, fenced JSON, "Verdict: Guilty.", empty, truncated, contradictory)
 * plus the near-misses that are easy to get wrong in the opposite direction: a verdict
 * under a negation, a lone "guilty" inside an argument, an unfamiliar verdict word.
 */

import type { SalvageProblem, SalvageRoute, Verdict } from "../judge-parser.js";

export interface ParserCase {
  readonly id: string;
  /** The shape of reply this case stands for. */
  readonly title: string;
  /** Exactly what the model sent. */
  readonly reply: string;
  readonly expect: {
    readonly verdict: Verdict | null;
    readonly route: SalvageRoute;
    readonly problem: SalvageProblem | null;
    /** A phrase the salvaged reasoning must contain. `""` asserts it came back empty. */
    readonly reasoningHas: string;
  };
  /** Why this case is in the list — printed under the table. */
  readonly note?: string;
}

export const PARSER_CASES: readonly ParserCase[] = [
  {
    id: "clean-json",
    title: "The form we asked for",
    reply: '{"verdict": "not_guilty", "reasoning": "He acted to stop a slaughter. No lesser means remained."}',
    expect: {
      verdict: "not_guilty",
      route: "json",
      problem: null,
      reasoningHas: "stop a slaughter",
    },
  },
  {
    id: "fenced-json",
    title: "JSON in a markdown fence",
    reply:
      '```json\n{"verdict": "guilty", "reasoning": "He swore her his loyalty. He killed her unarmed."}\n```',
    expect: { verdict: "guilty", route: "json", problem: null, reasoningHas: "swore her his loyalty" },
  },
  {
    id: "json-with-preamble",
    title: "JSON with a sentence of preamble around it",
    reply:
      'Here is my ruling.\n\n{"verdict": "guilty", "reasoning": "An oath binds. A killing outside the law is not justice."}\n\nI trust that is clear.',
    expect: { verdict: "guilty", route: "json", problem: null, reasoningHas: "An oath binds" },
    note: "The object is found inside the prose rather than the prose defeating it.",
  },
  {
    id: "json-uppercase-value",
    title: 'JSON whose verdict reads "Not Guilty" rather than "not_guilty"',
    reply: '{"verdict": "Not Guilty", "reasoning": "The charge sheet does not establish intent."}',
    expect: { verdict: "not_guilty", route: "json", problem: null, reasoningHas: "establish intent" },
    note: "Case, spacing and the underscore are normalised; the meaning is what is read.",
  },
  {
    id: "json-reasons-array",
    title: "JSON whose reasoning came back as a list",
    reply:
      '{"verdict": "guilty", "reasons": ["He was sworn to her.", "He chose the moment himself."]}',
    expect: { verdict: "guilty", route: "json", problem: null, reasoningHas: "sworn to her" },
  },
  {
    id: "truncated-json",
    title: "JSON cut off mid-sentence by the token ceiling",
    reply: '{"verdict": "not_guilty", "reasoning": "The realm faced a ruler who had already burned a city and',
    expect: {
      verdict: "not_guilty",
      route: "truncated_json",
      problem: null,
      reasoningHas: "already burned a city",
    },
    note: "specs.md Part 5's truncation pitfall: the verdict lands before the cut, so it survives.",
  },
  {
    id: "labelled-verdict-line",
    title: 'A labelled verdict on its own line, then the reasoning',
    reply: "Verdict: Guilty.\n\nHe broke a sworn oath, and he chose the moment and the manner himself.",
    expect: { verdict: "guilty", route: "labelled", problem: null, reasoningHas: "broke a sworn oath" },
  },
  {
    id: "labelled-inline",
    title: "A bolded label with the reasoning on the same line",
    reply: "**Verdict:** NOT GUILTY — the killing prevented a greater slaughter, and no court could have stopped her in time.",
    expect: {
      verdict: "not_guilty",
      route: "labelled",
      problem: null,
      reasoningHas: "greater slaughter",
    },
    note: "The label is stripped from the reasoning; the argument after it is kept.",
  },
  {
    id: "verdict-only",
    title: 'A bare "Verdict: Guilty." and nothing else',
    reply: "Verdict: Guilty.",
    expect: { verdict: "guilty", route: "labelled", problem: null, reasoningHas: "" },
    note: "A real verdict with no reasoning. judging.ts retries once for the reasoning and keeps the verdict either way.",
  },
  {
    id: "declared-in-prose",
    title: "Pure prose, no form at all",
    reply:
      "Having weighed both sides, I find the defendant not guilty. The prosecution rested on an oath, and an oath cannot bind a man to permit mass killing.",
    expect: {
      verdict: "not_guilty",
      route: "declared",
      problem: null,
      reasoningHas: "cannot bind a man",
    },
  },
  {
    id: "declared-of-defendant",
    title: 'Prose ruling in the third person: "the defendant is guilty"',
    reply: "The law is not a matter of sentiment. The defendant is guilty, and the manner of the killing aggravates rather than excuses it.",
    expect: { verdict: "guilty", route: "declared", problem: null, reasoningHas: "aggravates" },
  },
  {
    id: "acquitted-word",
    title: 'A verdict word we never asked for: "Acquitted"',
    reply: "Verdict: Acquitted. Necessity was made out, and the accused had no lawful means left.",
    expect: { verdict: "not_guilty", route: "labelled", problem: null, reasoningHas: "Necessity" },
    note: "Accepted in a labelled position only. Refusing a clear ruling over vocabulary would be pedantry.",
  },
  {
    id: "sole-token",
    title: "No label and no declaration — one verdict word in the whole reply",
    reply:
      "The oath was freely given and freely broken. Whatever the provocation, that is guilty on any reading of this charge sheet.",
    expect: { verdict: "guilty", route: "sole_token", problem: null, reasoningHas: "freely broken" },
    note: "The last rung, and the only one that reads a verdict from a word rather than a statement.",
  },
  {
    id: "empty",
    title: "Nothing came back",
    reply: "   \n  ",
    expect: { verdict: null, route: "none", problem: "empty_reply", reasoningHas: "" },
  },
  {
    id: "no-verdict-word",
    title: "Reasoning that never reaches a verdict",
    reply:
      "Both sides made their case with some force, and the charge sheet leaves the central question of intent unresolved. The tribunal would benefit from more evidence.",
    expect: { verdict: null, route: "none", problem: "no_verdict", reasoningHas: "" },
    note: "Nothing is inferred from the leaning of the prose. This is a retry, then an error.",
  },
  {
    id: "contradictory",
    title: "Both verdicts asserted",
    reply: "Verdict: guilty.\n\nOn reflection, my verdict is not guilty — the necessity defence holds.",
    expect: { verdict: null, route: "none", problem: "contradictory", reasoningHas: "" },
    note: "Two labelled verdicts disagree, so the parser stops rather than dropping to a looser rung that would pick one.",
  },
  {
    id: "negated-guilty",
    title: 'A lone "guilty" under a negation: "I do not find him guilty"',
    reply: "I do not find him guilty on this charge sheet, which never establishes what he knew.",
    expect: { verdict: null, route: "none", problem: "contradictory", reasoningHas: "" },
    note:
      'Same shape as "no doubt he is guilty" and the opposite meaning. Reading it either way risks reporting the reverse verdict, so it goes to a retry instead.',
  },
  {
    id: "guilty-inside-argument",
    title: 'A ruling that also quotes the other side\'s "not guilty"',
    reply:
      "Verdict: guilty. The defense would have me return not guilty on necessity, but necessity is not a licence to rule by fire.",
    expect: { verdict: "guilty", route: "labelled", problem: null, reasoningHas: "licence to rule" },
    note: "The labelled rung resolves it before the word-sweep ever runs, which is why the sweep is last.",
  },
  {
    id: "reasoning-label",
    title: "Two labelled sections, verdict and reasoning",
    reply: "VERDICT: not guilty\nREASONING: the charge sheet establishes the act but not the malice, and the alternative was a burning city.",
    expect: {
      verdict: "not_guilty",
      route: "labelled",
      problem: null,
      reasoningHas: "not the malice",
    },
  },
  {
    id: "leading-json-key-no-braces",
    title: "The JSON keys survived but the braces did not",
    reply: '"verdict": "guilty", "reasoning": "He was her sworn shield and he used the position to reach her."',
    expect: { verdict: "guilty", route: "labelled", problem: null, reasoningHas: "sworn shield" },
    note: 'Without a brace this is not JSON-shaped, so it falls through — and `"verdict": "guilty"` is itself a labelled verdict, which is where it lands.',
  },
];
