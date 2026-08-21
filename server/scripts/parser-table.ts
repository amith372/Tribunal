/**
 * Prints every judge-reply case as a table: what the model sent on the left, what the
 * parser salvaged on the right. It is the stage-gate check for Stage 3 — the salvage
 * rules should be readable without reading the code.
 *
 * It walks the same catalogue `judge-parser.test.ts` asserts against, so the table
 * cannot claim a salvage the tests do not hold to. Run it with:  npm run parser:table
 *
 * No API key, no network, no model calls.
 */

import {
  PROBLEM_LABEL,
  ROUTE_LABEL,
  parseJudgeReply,
  type ParsedJudgeReply,
} from "../src/judge-parser.js";
import { PARSER_CASES, type ParserCase } from "../src/__tests__/judge-parser-cases.js";

const LEFT = 46;
const RIGHT = 46;

const pad = (text: string, width: number) =>
  (text.length > width ? `${text.slice(0, width - 1)}…` : text).padEnd(width);

/** Splits on real line breaks first, then wraps what is still too long. */
function column(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }
    // Short lines pass through untouched, so the reply keeps its own spacing and the
    // labels on the right stay aligned.
    if (paragraph.length <= width) {
      out.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out.length > 0 ? out : [""];
}

function sideBySide(left: string, right: string): string {
  const a = column(left, LEFT);
  const b = column(right, RIGHT);
  const rows = Math.max(a.length, b.length);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    lines.push(`  ${pad(a[i] ?? "", LEFT)} │ ${b[i] ?? ""}`);
  }
  return lines.join("\n");
}

/** What the parser produced, written out the way a person would describe it. */
function salvaged(parsed: ParsedJudgeReply): string {
  const lines: string[] = [];
  lines.push(`VERDICT:  ${parsed.verdict ?? "— none, and none inferred"}`);
  lines.push(`HOW:      ${ROUTE_LABEL[parsed.route]}`);
  if (parsed.problem) lines.push(`WHY NOT:  ${PROBLEM_LABEL[parsed.problem]}`);
  lines.push(
    `REASONING (${parsed.reasoningWords} words, ${parsed.reasonCount} reason${
      parsed.reasonCount === 1 ? "" : "s"
    }):`,
  );
  lines.push(parsed.reasoning === "" ? "— empty; judging.ts retries once for it" : parsed.reasoning);
  return lines.join("\n");
}

function asSpecified(testCase: ParserCase, parsed: ParsedJudgeReply): boolean {
  const reasoningOk =
    testCase.expect.reasoningHas === ""
      ? parsed.reasoning === ""
      : parsed.reasoning.includes(testCase.expect.reasoningHas);
  return (
    parsed.verdict === testCase.expect.verdict &&
    parsed.route === testCase.expect.route &&
    parsed.problem === testCase.expect.problem &&
    reasoningOk
  );
}

console.log("\nThe Tribunal — the judge-output parser, case by case");
console.log(
  "specs.md Part 5: read the verdict from the text, retry the call once, and only then",
);
console.log("mark it an error. Never invent a verdict.\n");

console.log("The salvage ladder — the first rung that resolves wins:");
console.log("  1. json             the reply parses as JSON (whole, fenced, or embedded)");
console.log("  2. truncated_json   JSON-shaped but cut off; fields read out of the text");
console.log('  3. labelled         a labelled verdict in prose: "Verdict: not guilty"');
console.log('  4. declared         a declaration: "I find the defendant guilty"');
console.log("  5. sole_token       exactly one verdict reading appears in the whole reply");
console.log("  6. none             nothing usable — one retry, then an error\n");
console.log("Where it refuses to guess: if a rung finds two different verdicts, it stops there");
console.log("rather than dropping to a looser rung that would pick one. A looser rung is more");
console.log("likely to be wrong, not less, and reporting the opposite verdict would corrupt the");
console.log("majority and the export at once. A retry costs seconds.\n");

const NUM = 3;
const TITLE = 58;
const VERDICT = 11;
const ROUTE = 16;

console.log(
  `${pad("#", NUM)} ${pad("Reply shape", TITLE)} ${pad("Salvaged", VERDICT)} ${pad("How", ROUTE)} As specified`,
);
console.log(
  `${"─".repeat(NUM)} ${"─".repeat(TITLE)} ${"─".repeat(VERDICT)} ${"─".repeat(ROUTE)} ────────────`,
);

let mismatches = 0;
const parsedCases = PARSER_CASES.map((testCase, index) => {
  const parsed = parseJudgeReply(testCase.reply);
  const ok = asSpecified(testCase, parsed);
  if (!ok) mismatches++;

  console.log(
    `${pad(String(index + 1), NUM)} ${pad(testCase.title, TITLE)} ` +
      `${pad(parsed.verdict ?? "—", VERDICT)} ${pad(parsed.route, ROUTE)} ${ok ? "yes" : "NO"}`,
  );

  return { number: index + 1, testCase, parsed, ok };
});

console.log("\n\nWhat went in, and what came out:\n");
for (const { number, testCase, parsed } of parsedCases) {
  console.log(`  ${number}. ${testCase.title}`);
  console.log(`  ${pad("THE REPLY, exactly as sent", LEFT)} │ WHAT THE PARSER TOOK FROM IT`);
  console.log(`  ${"─".repeat(LEFT)} │ ${"─".repeat(RIGHT)}`);
  console.log(sideBySide(testCase.reply.trim() === "" ? "(nothing but whitespace)" : testCase.reply, salvaged(parsed)));
  if (testCase.note) {
    console.log(`\n${column(`Why this case: ${testCase.note}`, 92).map((line) => `     ${line}`).join("\n")}`);
  }
  console.log();
}

const withVerdict = parsedCases.filter((entry) => entry.parsed.verdict !== null).length;
console.log(
  `${PARSER_CASES.length} cases — ${withVerdict} salvaged a verdict, ` +
    `${PARSER_CASES.length - withVerdict} refused to guess and go to a retry, ` +
    `${mismatches === 0 ? "all as specified" : `${mismatches} NOT as specified`}. Model calls made: 0.\n`,
);

process.exit(mismatches === 0 ? 0 : 1);
