/**
 * judge-parser.ts — reads a verdict and reasoning out of whatever a judge actually
 * sent back. Pure: a string in, a parse out, no network and no key.
 *
 * specs.md Part 5: "A judge may return prose instead of the required form — read the
 * verdict from the text, retry the call once, and only then mark it an error; never
 * invent a verdict." This module is the "read it from the text" half. `judging.ts` owns
 * the retry, and neither of them ever supplies a verdict the model did not give.
 *
 * **The salvage ladder.** Each rung is tried in turn and the first that resolves wins:
 *
 *   1. `json`            — the reply parses as JSON (whole, fenced, or embedded).
 *   2. `truncated_json`  — JSON-shaped but unparseable, usually cut off mid-string;
 *                          the fields are read straight out of the text.
 *   3. `labelled`        — a labelled verdict in prose: `Verdict: not guilty`.
 *   4. `declared`        — a declaration: `I find the defendant guilty`.
 *   5. `sole_token`      — exactly one verdict reading appears anywhere in the reply.
 *   6. `none`            — nothing usable. `problem` says which kind of nothing.
 *
 * **Where it refuses to guess.** Salvage is lenient about *form* and strict about
 * *meaning*. If a rung finds two different verdicts, the parse fails there rather than
 * dropping to a looser rung that would pick one — a looser rung is more likely to be
 * wrong, not less. The same goes for a bare "guilty" sitting under a negation ("I do
 * not find him guilty", "no doubt he is guilty"): both readings are live, the parser
 * will not choose between them, and the cost is one retry. Reporting the opposite
 * verdict would corrupt the majority, the export and the run record at once; a retry
 * costs a few seconds.
 *
 * **Reasoning is never a gate.** `reasonCount` is a rough measure for display, so
 * specs.md Part 2's "at least two distinct reasons" is something the results panel can
 * show and a reader can check. It never causes a verdict to be discarded.
 */

export type Verdict = "guilty" | "not_guilty";

export type SalvageRoute =
  | "json"
  | "truncated_json"
  | "labelled"
  | "declared"
  | "sole_token"
  | "none";

export type SalvageProblem =
  /** Nothing came back, or only whitespace. */
  | "empty_reply"
  /** Readable text, but no verdict word anywhere in it. */
  | "no_verdict"
  /** Both verdicts are live in the text, or a lone "guilty" sits under a negation. */
  | "contradictory"
  /**
   * The provider cut the reply off (`finish_reason: "length"`). Set by `judging.ts`
   * rather than found here — the parser sees only text, and a severed reply can parse
   * perfectly well. It is not an answer, however much of it reads like one.
   */
  | "truncated";

export interface ParsedJudgeReply {
  /** `null` whenever the reply did not clearly give one. Never inferred. */
  readonly verdict: Verdict | null;
  /** May be empty even on a good verdict — an empty one is retried, never discarded. */
  readonly reasoning: string;
  readonly reasoningWords: number;
  /** Rough count of distinct reasons, for display only (specs.md Part 2). */
  readonly reasonCount: number;
  readonly route: SalvageRoute;
  /** Set exactly when `verdict` is `null`. */
  readonly problem: SalvageProblem | null;
}

/** Human labels for the route, shared by the printed case table and the tests. */
export const ROUTE_LABEL: Record<SalvageRoute, string> = {
  json: "parsed as JSON",
  truncated_json: "JSON-shaped, read from the text",
  labelled: 'labelled verdict ("Verdict: …")',
  declared: 'a declared ruling ("I find …")',
  sole_token: "only one verdict word in the reply",
  none: "nothing salvageable",
};

export const PROBLEM_LABEL: Record<SalvageProblem, string> = {
  empty_reply: "the reply was empty",
  no_verdict: "no verdict word in the reply",
  contradictory: "both readings live — neither chosen",
  truncated: "the provider cut the reply off",
};

const VERDICT_KEYS = ["verdict", "ruling", "decision", "finding", "judgment", "judgement", "result"];
const REASON_KEYS = ["reasoning", "reason", "reasons", "rationale", "explanation", "justification"];

/**
 * The verdict words. `not guilty` comes first in every alternation, because it contains
 * `guilty` and a first-match engine would otherwise read the negation as its opposite.
 *
 * `acquitted` / `convicted` / `innocent` are accepted because free models reach for
 * them, and refusing a clear ruling on vocabulary would be pedantry — but only in a
 * labelled or declared position, never in the last-resort sweep, where a stray
 * "the prosecution seeks to convict him" would be read as a verdict.
 */
const VERDICT_WORD = String.raw`not[\s_-]*guilty|guilty|acquitt?\w*|convict\w*|innocent`;

/** Words that make a following "guilty" mean its opposite, or mean nothing certain. */
const NEGATOR = String.raw`not|never|no|cannot|can't|isn't|aren't|wasn't|nor|neither|without|hardly|far from|anything but`;

function normaliseVerdictWord(raw: string): Verdict | null {
  const word = raw
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ")
    .replace(/[^a-z ]/g, "");
  if (/^not guilty/.test(word)) return "not_guilty";
  if (/^guilty/.test(word)) return "guilty";
  if (/^(innocent|acquit)/.test(word)) return "not_guilty";
  if (/^convict/.test(word)) return "guilty";
  return null;
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * A rough count of how many distinct reasons the reasoning offers: sentences and
 * clause-level separators, ignoring fragments too short to be a reason. Deliberately
 * crude — it is a number shown next to the reasoning, not a test the reasoning passes.
 */
function countReasons(reasoning: string): number {
  if (!reasoning.trim()) return 0;
  return reasoning
    .split(/[.!?;]+|\n+|(?:^|\s)[-•*]\s+/)
    .map((part) => part.trim())
    .filter((part) => words(part) >= 3).length;
}

function done(
  verdict: Verdict | null,
  reasoning: string,
  route: SalvageRoute,
  problem: SalvageProblem | null,
): ParsedJudgeReply {
  const text = reasoning.trim();
  return {
    verdict,
    reasoning: text,
    reasoningWords: words(text),
    reasonCount: countReasons(text),
    route,
    problem,
  };
}

/** Strips ``` fences so the prose rungs see the content rather than the wrapper. */
function stripFences(text: string): string {
  return text.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim();
}

/**
 * The first brace-balanced `{...}` run, honouring strings and escapes so a `}` inside
 * the reasoning does not end the object early.
 */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function readKey(object: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const [key, value] of Object.entries(object)) {
    if (keys.includes(key.trim().toLowerCase())) return value;
  }
  return undefined;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" ");
  return "";
}

/** Rung 1. Returns `null` when there is no JSON here, or none carrying a verdict. */
function fromJson(text: string): ParsedJudgeReply | null {
  const candidates = [text.trim(), stripFences(text), firstJsonObject(stripFences(text)) ?? ""];

  for (const candidate of candidates) {
    if (!candidate.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;

    const object = parsed as Record<string, unknown>;
    const verdict = normaliseVerdictWord(asText(readKey(object, VERDICT_KEYS)));
    if (!verdict) continue;
    return done(verdict, asText(readKey(object, REASON_KEYS)), "json", null);
  }
  return null;
}

/**
 * Rung 2. JSON-shaped but unparseable — nearly always a reply cut off mid-string,
 * which is exactly the truncation specs.md Part 5 warns the token ceiling causes. The
 * verdict field is short and lands before the cut, so it is usually intact; the
 * reasoning is taken up to wherever the text stops.
 */
function fromTruncatedJson(text: string): ParsedJudgeReply | null {
  if (!text.includes("{")) return null;

  const verdictMatch = new RegExp(
    String.raw`["']?(?:${VERDICT_KEYS.join("|")})["']?\s*:\s*["']?\s*(${VERDICT_WORD})`,
    "i",
  ).exec(text);
  if (!verdictMatch?.[1]) return null;

  const verdict = normaliseVerdictWord(verdictMatch[1]);
  if (!verdict) return null;

  // The closing quote is optional on purpose: an unterminated string is the whole point.
  const reasonMatch = new RegExp(
    String.raw`["']?(?:${REASON_KEYS.join("|")})["']?\s*:\s*"([^"]*)`,
    "i",
  ).exec(text);

  return done(verdict, reasonMatch?.[1] ?? "", "truncated_json", null);
}

/** Every distinct verdict a pattern finds. Two means the rung refuses to choose. */
function collect(pattern: RegExp, text: string): Set<Verdict> {
  const found = new Set<Verdict>();
  for (const match of text.matchAll(pattern)) {
    const verdict = normaliseVerdictWord(match[1] ?? "");
    if (verdict) found.add(verdict);
  }
  return found;
}

const LABELLED = new RegExp(
  String.raw`(?:^|[^\p{L}])(?:final\s+|my\s+|the\s+)?(?:${VERDICT_KEYS.join("|")})` +
    String.raw`[\s*_"':]*(?::|=|—|–|\bis\b|\bof\b)[\s*_"']*(${VERDICT_WORD})\b`,
  "giu",
);

const DECLARED = new RegExp(
  String.raw`\bi\s+(?:hereby\s+|therefore\s+|must\s+|would\s+|do\s+|thus\s+)*` +
    String.raw`(?:find|rule|hold|conclude|judge|vote|declare|deem|adjudge)\b` +
    String.raw`[^.!?\n]{0,80}?\b(${VERDICT_WORD})\b`,
  "giu",
);

const DECLARED_OF_DEFENDANT = new RegExp(
  String.raw`\b(?:the\s+)?(?:defendant|accused)\b[^.!?\n]{0,40}?\b(?:is|remains|stands)\s+` +
    String.raw`(?:therefore\s+|hereby\s+)?(not[\s_-]*guilty|guilty|innocent)\b`,
  "giu",
);

/** A bare "guilty" governed by a negation, e.g. "I do not find him guilty". */
const NEGATED_GUILTY = new RegExp(
  String.raw`\b(?:${NEGATOR})\b[^.!?\n]{0,30}?\bguilty\b`,
  "iu",
);

const NOT_GUILTY = /\bnot[\s_-]*guilty\b/giu;
const BARE_GUILTY = /\bguilty\b/giu;

/**
 * Reads a verdict and reasoning out of a judge's reply, however it was written.
 *
 * A `null` verdict is a refusal to guess, not a failure to look. The caller retries
 * once at temperature 0 and only then records an error (specs.md Part 5).
 */
export function parseJudgeReply(raw: string): ParsedJudgeReply {
  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) return done(null, "", "none", "empty_reply");

  const structured = fromJson(text) ?? fromTruncatedJson(text);
  if (structured) return structured;

  const prose = stripFences(text);

  // Rungs 3 and 4: a stated verdict. Two different ones is a contradiction to report,
  // never something to resolve by dropping to a looser rung.
  for (const [pattern, route] of [
    [LABELLED, "labelled"],
    [DECLARED, "declared"],
    [DECLARED_OF_DEFENDANT, "declared"],
  ] as const) {
    const found = collect(pattern, prose);
    if (found.size === 1) {
      const verdict = [...found][0];
      return done(verdict, reasoningFromProse(prose), route, null);
    }
    if (found.size > 1) return done(null, "", "none", "contradictory");
  }

  // Rung 5: the last resort. Only the plain verdict words count here — "convict" and
  // "acquit" appear in ordinary argument far too often to read as a ruling.
  const notGuiltyCount = (prose.match(NOT_GUILTY) ?? []).length;
  const masked = prose.replace(NOT_GUILTY, " \u0000 ");
  const bareGuiltyCount = (masked.match(BARE_GUILTY) ?? []).length;

  if (notGuiltyCount === 0 && bareGuiltyCount === 0) {
    return done(null, "", "none", "no_verdict");
  }
  if (notGuiltyCount > 0 && bareGuiltyCount > 0) {
    return done(null, "", "none", "contradictory");
  }
  if (bareGuiltyCount > 0 && NEGATED_GUILTY.test(masked)) {
    // "I do not find him guilty" and "no doubt he is guilty" are the same shape and
    // opposite meanings. Both readings stay live and the caller retries.
    return done(null, "", "none", "contradictory");
  }

  return done(
    notGuiltyCount > 0 ? "not_guilty" : "guilty",
    reasoningFromProse(prose),
    "sole_token",
    null,
  );
}

/** A line that is nothing but a labelled verdict — dropped from the reasoning. */
const VERDICT_ONLY_LINE = new RegExp(
  String.raw`^["'\s*_#>-]*(?:final\s+|my\s+|the\s+)?(?:${VERDICT_KEYS.join("|")})` +
    String.raw`[\s*_"':=—–]*(?:${VERDICT_WORD})[\s.*_"'!]*$`,
  "iu",
);

/** A labelled verdict opening a line that carries the reasoning after it. */
const VERDICT_PREFIX = new RegExp(
  String.raw`^["'\s*_#>-]*(?:final\s+|my\s+|the\s+)?(?:${VERDICT_KEYS.join("|")})` +
    String.raw`[\s*_"':=—–]*(?:${VERDICT_WORD})[\s.*_"'!,;:—–-]*`,
  "iu",
);

const REASONING_LABEL = new RegExp(
  String.raw`(?:^|\n)["'\s*_#>-]*(?:${REASON_KEYS.join("|")})["'\s*_]*[:=—–]\s*"?`,
  "i",
);

/**
 * The reasoning, from a reply that was not JSON: everything after a `Reasoning:` label
 * if there is one, otherwise the whole reply with any verdict-only line removed.
 *
 * The remainder can legitimately be empty — a judge that answered "Guilty." gave a real
 * verdict and no reasoning, which is a retry, not a discarded verdict.
 */
function reasoningFromProse(prose: string): string {
  const labelled = REASONING_LABEL.exec(prose);
  if (labelled) return prose.slice(labelled.index + labelled[0].length).trim();

  const withoutVerdictLines = prose
    .split(/\r?\n/)
    .filter((line) => !VERDICT_ONLY_LINE.test(line.trim()))
    .join("\n")
    .trim();

  // "Verdict: Guilty — he broke his oath." keeps its reasoning and loses its label.
  return withoutVerdictLines.replace(VERDICT_PREFIX, "").trim();
}
