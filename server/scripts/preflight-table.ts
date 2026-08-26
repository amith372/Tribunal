/**
 * Prints every pre-flight case as a table, with the refusal messages the user would
 * actually see. It is the stage-gate check for Stage 2: the rules should be readable
 * without reading the code.
 *
 * It walks the same catalogue `preflight.test.ts` asserts against, so the table cannot
 * claim a rule the tests do not hold to. Run it with:  npm run preflight:table
 *
 * No API key, no network, no model calls.
 */

import { loadData } from "../src/data.js";
import {
  MAX_CHARGE_SHEET_WORDS,
  MIN_CHARGE_SHEET_WORDS,
  SEARCHED_NAMES,
  preflight,
} from "../src/preflight.js";
import { PREFLIGHT_CASES } from "../src/__tests__/preflight-cases.js";

const data = loadData();

const pad = (text: string, width: number) =>
  (text.length > width ? `${text.slice(0, width - 1)}…` : text).padEnd(width);

/** Wraps a message to the given width and indents continuation lines. */
function wrap(text: string, width: number, indent: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join(`\n${indent}`);
}

console.log("\nThe Tribunal — pre-flight, case by case");
console.log("specs.md Part 1: no model call is made until every one of these passes.\n");

console.log("The rules being applied:");
console.log(`  · charge sheet present, ${MIN_CHARGE_SHEET_WORDS}–${MAX_CHARGE_SHEET_WORDS} words`);
console.log("  · charge sheet reads as an accusation or a question, not just a description");
console.log("  · defendant is one of the five characters in data/characters.md");
console.log("  · defendant is named in the charge sheet (whole word, any case)");
console.log("  · four advocates, each a different one of the five characters — one sits out");
console.log("  · the accused may hold a defence seat, and may never prosecute themselves");
console.log("  · the split is exactly two defending and two prosecuting\n");

console.log("Names searched for in the charge sheet — given names only, never a shared surname:");
for (const character of data.characters) {
  const names = SEARCHED_NAMES[character.id] ?? [character.name];
  console.log(`  ${pad(character.name, 22)}${names.map((name) => `"${name}"`).join(", ")}`);
}
console.log();

const NUM = 3;
const TITLE = 68;
const RESULT = 8;

console.log(`${pad("#", NUM)} ${pad("Case", TITLE)} ${pad("Result", RESULT)} As specified`);
console.log(`${"─".repeat(NUM)} ${"─".repeat(TITLE)} ${"─".repeat(RESULT)} ────────────`);

const refusals: { number: number; title: string; messages: string[] }[] = [];
let mismatches = 0;

PREFLIGHT_CASES.forEach((testCase, index) => {
  const number = index + 1;
  const result = preflight(testCase.input, data);
  const actual = result.failures.map((failure) => failure.code);
  const expected = testCase.expect === "pass" ? [] : [...testCase.expect];
  const asSpecified = JSON.stringify(actual) === JSON.stringify(expected);
  if (!asSpecified) mismatches++;

  console.log(
    `${pad(String(number), NUM)} ${pad(testCase.title, TITLE)} ` +
      `${pad(result.ok ? "PASS" : "REFUSED", RESULT)} ${asSpecified ? "yes" : "NO — got " + (actual.join(", ") || "pass")}`,
  );

  if (result.failures.length > 0) {
    refusals.push({
      number,
      title: testCase.title,
      messages: result.failures.map((failure) => `${failure.code} — ${failure.message}`),
    });
  }
});

console.log("\n\nThe refusal messages, exactly as the app would show them:\n");
for (const refusal of refusals) {
  console.log(`  ${refusal.number}. ${refusal.title}`);
  for (const message of refusal.messages) {
    console.log(`     ${wrap(message, 84, "     ")}`);
  }
  console.log();
}

const passes = PREFLIGHT_CASES.filter((testCase) => testCase.expect === "pass").length;
console.log(
  `${PREFLIGHT_CASES.length} cases — ${passes} accepted, ${PREFLIGHT_CASES.length - passes} refused, ` +
    `${mismatches === 0 ? "all as specified" : `${mismatches} NOT as specified`}. Model calls made: 0.\n`,
);

process.exit(mismatches === 0 ? 0 : 1);
