/**
 * trial-run.ts — runs one whole trial through the real pipeline, against real models.
 *
 * This is the half of Stage 3's gate that no test can close. `prompts.test.ts` proves
 * the grounding rule is *stated* to all seven models; nothing can prove one obeyed it.
 * Two questions need real output and a person reading it:
 *
 *   1. Do the four voices actually differ, and does Barak reason unlike Shamgar?
 *   2. Does anyone assert a fact that is not in `data/` or the charge sheet? That is
 *      specs.md Part 1's non-negotiable failing, and it is a prompt fix, not a code fix.
 *
 * It uses no fakes: `runStatements` and `runJudging` fall through to the real
 * `callChat`. The case is specs.md Part 4's, built through the real pre-flight.
 *
 * **It spends 7 requests from a rationed daily free allowance**, more if a call retries.
 *
 * Run it with:  npm run trial:run          (per-role: a different model per seat)
 *               npm run trial:run -- solo  (one model for all seven)
 */

import "../src/env.js";
import { aggregate, type RunRecord } from "../src/aggregate.js";
import { getServerConfig } from "../src/config.js";
import { resolveRunModels, type Mode } from "../src/casting.js";
import { loadData } from "../src/data.js";
import { runJudging } from "../src/judging.js";
import { preflight } from "../src/preflight.js";
import { runStatements, toDeliveredStatements } from "../src/statements.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "../src/__tests__/preflight-cases.js";
import type { Attempt } from "../src/openrouter.js";

const RULE = "═".repeat(88);
const THIN = "─".repeat(88);

const mode: Mode = process.argv[2] === "solo" ? "solo" : "per-role";

function wrap(text: string, width = 84, indent = "  "): string {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out.map((line) => indent + line).join("\n");
}

/**
 * Proper nouns in a statement that appear nowhere in `data/` or the charge sheet.
 *
 * **A hint for the reader, never a verdict.** Sentence-initial words are dropped, but
 * plenty of innocent capitalisation will still surface here, and a model can break the
 * grounding rule without using a single proper noun. It narrows where to look; the
 * judgement stays with the person reading the statements.
 */
function outsideVocabulary(text: string, allowed: Set<string>): string[] {
  const found = new Set<string>();
  // Split into sentences so the first word of each can be excused its capital.
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const tokens = sentence.match(/[\p{Lu}][\p{L}']*/gu) ?? [];
    const first = sentence.trim().split(/\s+/)[0]?.replace(/[^\p{L}']/gu, "") ?? "";
    for (const token of tokens) {
      if (token === first) continue;
      if (token.length < 3) continue;
      if (!allowed.has(token.toLowerCase())) found.add(token);
    }
  }
  return [...found];
}

function attemptRow(attempt: Attempt): string {
  const tokens = attempt.usage.totalTokens;
  const reasoning = attempt.usage.reasoningTokens;
  return (
    `  ${attempt.label.padEnd(20)} ${(attempt.respondedModel ?? attempt.requestedModel).padEnd(42)} ` +
    `${String(tokens ?? "—").padStart(6)} ${String(reasoning ?? "—").padStart(6)} ` +
    `${`${(attempt.elapsedMs / 1000).toFixed(1)}s`.padStart(7)} ` +
    `${attempt.ok ? "ok" : `FAILED ${attempt.errorKind}`}${attempt.isRetry ? "  (retry)" : ""}`
  );
}

/**
 * The per-call model/token/time table. Printed on an aborted run as well as a finished
 * one — those requests were spent either way, and which model failed and how is the
 * whole diagnosis of an abort.
 */
function printCallTable(record: RunRecord): void {
  console.log(
    `\n  ${"call".padEnd(20)} ${"model that answered".padEnd(42)} ` +
      `${"tokens".padStart(6)} ${"think".padStart(6)} ${"time".padStart(7)}`,
  );
  console.log(`  ${"─".repeat(20)} ${"─".repeat(42)} ${"─".repeat(6)} ${"─".repeat(6)} ${"─".repeat(7)}`);
  for (const attempt of record.attempts) console.log(attemptRow(attempt));
}

function printTotals(record: RunRecord, startedAt: Date): void {
  const t = record.totals;
  console.log(
    `\n  ${t.calls} calls · ${t.totalTokens} tokens (${t.promptTokens} prompt + ` +
      `${t.completionTokens} completion, of which ${t.reasoningTokens} thinking)`,
  );
  console.log(
    `  $${t.costUsd.toFixed(4)} · ${(t.elapsedMs / 1000).toFixed(1)}s of call time · ` +
      `wall clock ${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s`,
  );
  if (t.usageMissing) console.log("  note: at least one attempt reported no usage, so the total is a floor.");
}

async function main(): Promise<void> {
  console.log(`\n${RULE}`);
  console.log("THE TRIBUNAL — ONE REAL TRIAL. THIS MAKES 7 LIVE MODEL CALLS.");
  console.log(RULE);

  if (!getServerConfig().apiKey) {
    console.error("\nOPENROUTER_API_KEY is not set. Nothing was called.\n");
    process.exit(1);
  }

  const data = loadData();
  const check = preflight(
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
    data,
  );
  if (!check.ok) {
    console.error("\nPart 4's case did not pass pre-flight:", check.failures);
    process.exit(1);
  }
  const run = check.run;
  const models = resolveRunModels(mode);

  // Everything the advocates are permitted to know, for the proper-noun hint below.
  const allowed = new Set(
    [
      run.chargeSheet,
      ...data.characters.map((c) => `${c.name} ${c.description}`),
      ...data.relations.map((r) => r.text),
      ...data.judges.map((j) => `${j.name} ${j.persona}`),
    ]
      .join(" ")
      .toLowerCase()
      .match(/[\p{L}']+/gu) ?? [],
  );

  console.log(`\nCase:      ${run.defendant.name}, ${run.chargeSheetWords} words of charge sheet`);
  console.log(`Mode:      ${mode}`);
  for (const [i, advocate] of run.advocates.entries()) {
    console.log(
      `  ${(advocate.side === "for" ? "defending" : "prosecuting").padEnd(12)} ` +
        `${advocate.character.name.padEnd(20)} ${models.advocates[i]}`,
    );
  }
  for (const [i, judge] of data.judges.entries()) {
    console.log(`  ${"judging".padEnd(12)} ${judge.name.padEnd(20)} ${models.judges[i]}`);
  }

  const startedAt = new Date();

  console.log(`\n${RULE}`);
  console.log("THE ADVOCATES — four calls, in parallel");
  console.log(RULE);

  const statements = await runStatements({
    run,
    data,
    mode,
    models: models.advocates,
    onStatement: (statement) => {
      const state = statement.ok ? "delivered" : "FAILED";
      console.log(`  · ${statement.name} ${state}${statement.rescreened ? " (re-asked once)" : ""}`);
    },
  });

  for (const statement of statements.statements) {
    console.log(`\n${THIN}`);
    console.log(
      `${statement.name} — ${statement.side === "for" ? "FOR THE DEFENSE" : "FOR THE PROSECUTION"}`,
    );
    console.log(
      `model: ${statement.model ?? statement.requestedModel}   ·   ` +
        `${statement.words ?? 0} words of ${statement.wordCap} ` +
        `${statement.overCap ? "· OVER THE CAP" : "· within cap"}`,
    );
    console.log(THIN);
    if (statement.ok && statement.text) {
      console.log(wrap(statement.text));
      const outside = outsideVocabulary(statement.text, allowed);
      if (outside.length > 0) {
        console.log(`\n  ⚠ proper nouns not found in data/ or the charge sheet: ${outside.join(", ")}`);
        console.log("    (a hint for your eye, not a verdict — check whether it asserts a fact)");
      } else {
        console.log("\n  ✓ no proper noun outside data/ or the charge sheet");
      }
    } else {
      console.log(`  ${statement.error ?? "no statement"}`);
      if (statement.problem) console.log(`  refused as: ${statement.problem}`);
    }
  }

  if (statements.abort) {
    console.log(`\n${RULE}`);
    console.log(`RUN ABORTED — ${statements.abort.reason}`);
    console.log(RULE);
    console.log(wrap(statements.abort.message));
    // An aborted run still spent every request it made, and which model failed and how
    // is the whole diagnosis — so the table prints here exactly as it does on success.
    const record = aggregate({ run, models, statements, judging: null, startedAt, finishedAt: new Date() });
    printCallTable(record);
    printTotals(record, startedAt);
    process.exit(1);
  }

  console.log(`\n${RULE}`);
  console.log("THE BENCH — three calls, in parallel");
  console.log(RULE);

  const judging = await runJudging({
    run,
    data,
    mode,
    models: models.judges,
    statements: toDeliveredStatements(statements),
    onVerdict: (judge) => {
      console.log(`  · ${judge.name}: ${judge.verdict ?? "NO VERDICT"} (read as: ${judge.route})`);
    },
  });

  for (const judge of judging.judges) {
    console.log(`\n${THIN}`);
    console.log(`${judge.name} — ${judge.verdict ?? "NO VERDICT RETURNED"}`);
    console.log(
      `model: ${judge.model ?? judge.requestedModel}   ·   ` +
        `${judge.reasoningWords} words of ${judge.wordCap} ` +
        `${judge.overCap ? "· OVER THE CAP" : "· within cap"}   ·   ` +
        `${judge.reasonCount} reason${judge.reasonCount === 1 ? "" : "s"}` +
        `${judge.thinReasoning ? " · THIN" : ""}   ·   read as: ${judge.route}` +
        `${judge.retryReason ? ` · retried (${judge.retryReason})` : ""}`,
    );
    console.log(THIN);
    console.log(judge.reasoning ? wrap(judge.reasoning) : `  ${judge.error ?? "no reasoning"}`);
  }

  const record = aggregate({ run, models, statements, judging, startedAt, finishedAt: new Date() });

  console.log(`\n${RULE}`);
  console.log("THE RESULT");
  console.log(RULE);
  const outcome = record.outcome;
  console.log(
    `\n  Verdict:   ${outcome.kind === "verdict" ? outcome.verdict.toUpperCase() : outcome.kind.toUpperCase()}`,
  );
  console.log(
    `  Tally:     ${record.tally.guilty} guilty · ${record.tally.notGuilty} not guilty · ` +
      `${record.tally.failed} failed`,
  );
  console.log(`  Complete:  ${record.complete}`);
  if (record.collisions.length > 0) {
    for (const collision of record.collisions) {
      console.log(`  Shared:    ${collision.model} served ${collision.roles.join(" and ")}`);
    }
  }

  printCallTable(record);
  printTotals(record, startedAt);

  const t = record.totals;
  const summed = record.attempts.reduce((sum, a) => sum + (a.usage.totalTokens ?? 0), 0);
  console.log(`\n  Part 2 check — total equals the sum of the rows: ${summed === t.totalTokens} (${summed})`);
  console.log(`  Part 2 check — price is $0 on free models: ${t.costUsd === 0}\n`);
}

main().catch((error: unknown) => {
  console.error(`\nTrial failed: ${(error as Error).message}\n`);
  process.exit(1);
});
