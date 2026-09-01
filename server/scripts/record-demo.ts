/**
 * record-demo.ts — prints one finished RunRecord, built from scripted replies.
 *
 * The run record is what the panels, the stream and the export all render, so being
 * able to look at one without spending seven model calls is worth a script. Zero
 * network, zero key, zero cost: `npm run record:demo`.
 */

import { aggregate } from "../src/aggregate.js";
import { buildExportHtml } from "../src/export.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveRunModels } from "../src/casting.js";
import { loadData } from "../src/data.js";
import { runJudging } from "../src/judging.js";
import { preflight } from "../src/preflight.js";
import { runStatements, toDeliveredStatements } from "../src/statements.js";
import { scriptedCaller } from "../src/__tests__/fake-caller.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "../src/__tests__/preflight-cases.js";

const data = loadData();
const result = preflight(
  { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
  data,
);
if (!result.ok) throw new Error("Part 4's case must pass pre-flight");
const run = result.run;

const models = resolveRunModels("per-role");
const script: Record<string, readonly string[]> = {};
run.advocates.forEach((advocate, i) => {
  script[`advocate:${advocate.character.id}`] = [`Statement ${i + 1} for the ${advocate.side}.`];
});
data.judges.forEach((judge, i) => {
  const verdict = i === 1 ? "not_guilty" : "guilty";
  // Real-shaped reasoning: `countReasons` only counts clauses of three words or more,
  // so a two-word sentence reads as no reason at all and the demo would libel the bench.
  const reasoning =
    verdict === "guilty"
      ? "He swore an oath to her and broke it himself. No court authorised the act."
      : "Necessity was made out on the evidence. No lawful means remained to him.";
  script[`judge:${judge.id}`] = [`{"verdict": "${verdict}", "reasoning": "${reasoning}"}`];
});

const caller = scriptedCaller(script);
const startedAt = new Date();

const statements = await runStatements({
  run,
  data,
  mode: "per-role",
  models: models.advocates,
  call: caller.call,
});
const judging = await runJudging({
  run,
  data,
  mode: "per-role",
  models: models.judges,
  statements: toDeliveredStatements(statements),
  call: caller.call,
});

const record = aggregate({ run, models, statements, judging, startedAt, finishedAt: new Date() });

console.log("\noutcome    :", JSON.stringify(record.outcome));
console.log("tally      :", JSON.stringify(record.tally));
console.log("complete   :", record.complete, " collisions:", record.collisions.length);
console.log("totals     :", JSON.stringify(record.totals));
console.log("\nper-call table:");
for (const attempt of record.attempts) {
  console.log(
    `  ${attempt.ok ? "ok  " : "FAIL"} ${attempt.label.padEnd(20)} ${(attempt.respondedModel ?? "-").padEnd(40)} ${String(attempt.usage.totalTokens ?? "-").padStart(5)} tok`,
  );
}
console.log("\njudges:");
for (const judge of record.judges) {
  console.log(`  ${judge.name.padEnd(18)} ${String(judge.verdict).padEnd(11)} reasons=${judge.reasonCount} thin=${judge.thinReasoning}`);
}
console.log();

// Writes the run record as the self-contained file the user would download, so it
// can be opened from disk and checked by eye without spending seven model calls.
// Repo root, not the workspace directory npm happens to run this from.
// fileURLToPath, not .pathname — on Windows the latter yields "/D:/…%20…".
const out = fileURLToPath(new URL("../../tribunal-demo-run.html", import.meta.url));
writeFileSync(out, buildExportHtml(record), "utf8");
console.log(`export     : ${out}`);
