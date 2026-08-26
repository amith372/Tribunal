/**
 * Prints all seven prompts of a run, verbatim, exactly as they would be sent.
 *
 * It is the other half of the Stage 3 gate. With no API key there is no model output to
 * read, but the prompts *are* the thing under review: the grounding rule, the persona
 * wording, the side assignment and the charge-sheet fencing can all be checked by eye
 * here, and none of them need a call to check.
 *
 * The case is specs.md Part 4's: Jon Snow charged with regicide and treason, Tyrion and
 * Cersei defending, Daenerys and Grey Worm prosecuting. It is built through the real
 * pre-flight, so what is printed is built from a `ValidRun` like the pipeline's.
 *
 * Run it with:  npm run prompts:print
 *
 * No API key, no network, no model calls.
 */

import { loadData } from "../src/data.js";
import { preflight } from "../src/preflight.js";
import { buildAdvocatePrompt, buildJudgePrompt, type DeliveredStatement } from "../src/prompts.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "../src/__tests__/preflight-cases.js";

const data = loadData();

const result = preflight(
  { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
  data,
);
if (!result.ok) {
  console.error("Part 4's case did not pass pre-flight:", result.failures);
  process.exit(1);
}
const run = result.run;

/**
 * **These four statements are hand-written placeholders, not model output.** No model
 * was called to produce them and none could be — Stage 3 runs without an API key. They
 * are here only so the judges' prompts can be printed with something in the statements
 * block; what is under review on this page is the *prompt*, not the statements.
 */
const PLACEHOLDER_STATEMENTS: readonly DeliveredStatement[] = [
  {
    side: "for",
    text: "I have defended worse men for worse reasons. The difference is that this time the accused gained nothing — no throne, no title, no safety. A man who kills for none of those things kills for the only reason left.",
  },
  {
    side: "for",
    text: "Spare me the grief. He did what every one of you wanted done and lacked the stomach for, and now you would hang him for the courage of it.",
  },
  {
    side: "against",
    text: "He came to me as a lover and left as a killer. Whatever he tells you about the realm, he swore himself to me first, and an oath sworn and broken is the whole of this case.",
  },
  { side: "against", text: "He killed our queen. He was sworn. This is not justice. This is murder." },
];

const RULE = "═".repeat(92);
const THIN = "─".repeat(92);

function show(
  index: number,
  role: string,
  prompt: { label: string; maxTokens: number; wordCap: number; messages: readonly { role: string; content: string }[] },
): void {
  console.log(`\n${RULE}`);
  console.log(`PROMPT ${index} OF 7 — ${role}`);
  console.log(
    `label: ${prompt.label}   ·   word cap stated in the prompt: ${prompt.wordCap}   ·   ` +
      `max_tokens: ${prompt.maxTokens}`,
  );
  console.log(RULE);
  for (const message of prompt.messages) {
    console.log(`\n${THIN}`);
    console.log(`[${message.role.toUpperCase()} MESSAGE]`);
    console.log(THIN);
    console.log(message.content);
  }
  console.log();
}

console.log("\nThe Tribunal — the seven prompts of a run, verbatim");
console.log(
  "specs.md Part 4's case T-001: Jon Snow on trial. Jon himself and Tyrion defending,",
);
console.log("Daenerys and Grey Worm prosecuting. Built through the real pre-flight.\n");
console.log("What to read for:");
console.log("  · the grounding rule — persona is voice, never a fact source; a missing fact is");
console.log("    labelled an assumption (specs.md Part 1)");
console.log('  · the line that outranks an adversarial persona — "Spin the facts; invent none."');
console.log("  · the charge sheet fenced as evidence, not as instructions");
console.log("  · each advocate on the side the user cast, with its own relation to the defendant");
console.log("  · judges: persona only, no relations, statements labelled by side and not by name");
console.log("\nNOTE: the four statements inside the judges' prompts are hand-written placeholders.");
console.log("No model was called to produce them. Only the prompts are under review here.\n");

run.advocates.forEach((advocate, index) => {
  // The accused defending themselves reads as "DEFENDING Jon Snow, Jon Snow" otherwise.
  const isAccused = advocate.character.id === run.defendant.id;
  const side = advocate.side === "for" ? "DEFENDING" : "PROSECUTING";
  show(
    index + 1,
    isAccused
      ? `ADVOCATE: ${advocate.character.name}, THE ACCUSED, ANSWERING THE CHARGE`
      : `ADVOCATE: ${advocate.character.name}, ${side} ${run.defendant.name}`,
    buildAdvocatePrompt(run, advocate, data),
  );
});

data.judges.forEach((judge, index) => {
  show(
    run.advocates.length + index + 1,
    `JUDGE: ${judge.name}`,
    buildJudgePrompt(run, judge, PLACEHOLDER_STATEMENTS),
  );
});

console.log(RULE);
console.log("7 prompts built — 4 advocates, 3 judges. Model calls made: 0.");
console.log(RULE);
console.log();
