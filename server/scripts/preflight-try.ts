/**
 * Type your own setup and see what the pre-flight makes of it — the same module the
 * app calls, so whatever this prints is what the real run would do.
 *
 *   npm run preflight:try                      (asks for everything, step by step)
 *   npm run preflight:try -- --charge "..." --defendant jon-snow \
 *                            --for tyrion,cersei --against daenerys,grey-worm
 *
 * No API key, no network, no model calls — a refused setup and an accepted one cost
 * exactly the same here: nothing.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadData } from "../src/data.js";
import { MAX_CHARGE_SHEET_WORDS, MIN_CHARGE_SHEET_WORDS, preflight } from "../src/preflight.js";
import { PART_4_CHARGE_SHEET } from "../src/__tests__/preflight-cases.js";

const data = loadData();

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const OFF = "\u001b[0m";

function wrap(text: string, width: number, indent: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
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

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function idList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Prints the verdict the way the app would have to show it. */
function report(chargeSheet: string, defendant: string, forIds: string[], againstIds: string[]): void {
  const advocates = [
    ...forIds.map((id) => ({ id, side: "for" })),
    ...againstIds.map((id) => ({ id, side: "against" })),
  ];
  const result = preflight({ chargeSheet, defendant, advocates }, data);
  const wordCount = chargeSheet.trim() ? chargeSheet.trim().split(/\s+/).length : 0;

  console.log(`\n${DIM}${"─".repeat(88)}${OFF}`);
  console.log(
    `${DIM}charge sheet${OFF} ${wordCount} words ${DIM}(${MIN_CHARGE_SHEET_WORDS}–${MAX_CHARGE_SHEET_WORDS})${OFF}   ` +
      `${DIM}defendant${OFF} ${defendant || "—"}   ${DIM}defending${OFF} ${forIds.join(", ") || "—"}   ` +
      `${DIM}prosecuting${OFF} ${againstIds.join(", ") || "—"}`,
  );
  console.log(`${DIM}${"─".repeat(88)}${OFF}\n`);

  if (result.ok && result.run) {
    console.log(`${GREEN}${BOLD}  ACCEPTED${OFF} — this setup would go on to make seven model calls.\n`);
    console.log(`  ${DIM}on trial${OFF}     ${result.run.defendant.name}`);
    for (const side of ["for", "against"] as const) {
      const names = result.run.advocates
        .filter((advocate) => advocate.side === side)
        .map((advocate) => advocate.character.name)
        .join(" and ");
      console.log(`  ${DIM}${side === "for" ? "defending" : "prosecuting"}${OFF}${side === "for" ? "    " : "  "}${names}`);
    }
    console.log(`  ${DIM}charge sheet${OFF} ${result.run.chargeSheetWords} words\n`);
  } else {
    const count = result.failures.length;
    console.log(`${RED}${BOLD}  REFUSED${OFF} — ${count} ${count === 1 ? "reason" : "reasons"}, and zero model calls spent.\n`);
    for (const failure of result.failures) {
      console.log(`  ${RED}✗${OFF} ${BOLD}${failure.code}${OFF} ${DIM}(${failure.field})${OFF}`);
      console.log(`    ${wrap(failure.message, 82, "    ")}\n`);
    }
  }
  console.log(`${DIM}  model calls made: 0${OFF}\n`);
}

async function ask(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(`\n${BOLD}The Tribunal — try a setup against the pre-flight${OFF}`);
  console.log(`${DIM}Nothing here calls a model. Ctrl-C to leave.${OFF}\n`);
  console.log(`${DIM}The five characters:${OFF}`);
  for (const character of data.characters) {
    console.log(`  ${character.id.padEnd(12)} ${character.name}`);
  }

  for (;;) {
    console.log(
      `\n${BOLD}Charge sheet${OFF} ${DIM}— paste it, then an empty line. Empty straight away uses Part 4's Jon Snow case.${OFF}`,
    );
    const lines: string[] = [];
    for (;;) {
      const line = await rl.question("> ");
      if (line.trim() === "") break;
      lines.push(line);
    }
    const chargeSheet = lines.length > 0 ? lines.join(" ") : PART_4_CHARGE_SHEET;
    if (lines.length === 0) console.log(`${DIM}  using: ${PART_4_CHARGE_SHEET.slice(0, 70)}…${OFF}`);

    const defendant = (
      await rl.question(
        `\n${BOLD}Defendant${OFF} ${DIM}(an id above — or something like "gandalf" to see it refused) ${OFF}> `,
      )
    ).trim();

    const forIds = idList(
      await rl.question(`${BOLD}Defending${OFF} ${DIM}(two ids, comma separated) ${OFF}> `),
    );
    const againstIds = idList(
      await rl.question(`${BOLD}Prosecuting${OFF} ${DIM}(two ids, comma separated) ${OFF}> `),
    );

    report(chargeSheet, defendant, forIds, againstIds);

    const again = (await rl.question(`${DIM}Another? [Y/n] ${OFF}`)).trim().toLowerCase();
    if (again === "n" || again === "no") break;
  }

  rl.close();
}

const chargeFlag = flag("charge");
const defendantFlag = flag("defendant");

if (chargeFlag !== undefined || defendantFlag !== undefined) {
  report(chargeFlag ?? "", defendantFlag ?? "", idList(flag("for")), idList(flag("against")));
} else {
  await ask();
}
