/**
 * export-from-log.ts — renders the exported run record from a run that really happened.
 *
 * `record:demo` renders a record built from scripted replies, which is the right tool for
 * checking the *structure* of the file and useless for checking how it *reads*: the words
 * are canned, every call took the same made-up time, and no model ever failed. But the
 * exported file is the run record (specs.md Part 3), and what it has to survive is real
 * output — a statement that ran to 150 words, a judge that retried, a model that fell back,
 * token counts that are not round numbers.
 *
 * The server appends every finished run to a local, ignored `runs.jsonl` (Part 3: a
 * developer's log, not a store — nothing reads it back and the app does not depend on it).
 * This script is the one thing that reads it, and only ever by hand: it takes a line from
 * that file and hands it to the same `buildExportHtml` the download endpoint calls. So the
 * export can be looked at against a real run without spending seven requests to make one.
 *
 *   npm run export:log            the most recent run in the log
 *   npm run export:log -- 2       the run at index 2, counting from the top
 *   npm run export:log -- 2 out.html
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RunRecord } from "../src/aggregate.js";
import { buildExportHtml, exportFileName } from "../src/export.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(join(here, "..", ".."));
const logPath = join(repoRoot, "runs.jsonl");

if (!existsSync(logPath)) {
  console.error(
    `\n  No runs.jsonl at ${logPath}.\n` +
      "  It is written by the server as each run finishes, and it is gitignored — a fresh\n" +
      "  clone has none until a run has been made.\n",
  );
  process.exit(1);
}

const lines = readFileSync(logPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (lines.length === 0) {
  console.error("\n  runs.jsonl is empty — no finished run has been logged yet.\n");
  process.exit(1);
}

const [indexArg, fileArg] = process.argv.slice(2);
const index = indexArg === undefined ? lines.length - 1 : Number(indexArg);

if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
  console.error(`\n  There are ${lines.length} runs in the log; asked for index ${indexArg}.\n`);
  process.exit(1);
}

const entry = JSON.parse(lines[index]) as { runId: string; record: RunRecord };
const record = entry.record;
const html = buildExportHtml(record);
const out = resolve(fileArg ?? join(repoRoot, exportFileName(record)));

writeFileSync(out, html, "utf8");

const outcome =
  record.outcome.kind === "verdict"
    ? `${record.outcome.verdict} ${record.outcome.tally.guilty}–${record.outcome.tally.notGuilty}`
    : record.outcome.kind;

console.log(`\n  run ${entry.runId.slice(0, 8)} · ${record.defendant.name} · ${outcome}`);
console.log(`  ${record.totals.calls} calls · ${record.totals.totalTokens.toLocaleString("en-US")} tokens · ${
  record.complete ? "complete" : "incomplete"
}`);
console.log(`  wrote ${out} (${(html.length / 1024).toFixed(0)} KB)\n`);
