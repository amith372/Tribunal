/**
 * prompts.ts — pure prompt builders. No network, no key, no state.
 *
 * Every one of the seven calls in a run gets its text from here, which makes the
 * grounding rule a single edit rather than seven, and makes the exact bytes sent to a
 * model readable without running anything (`npm run prompts:print`).
 *
 * Three properties this module holds to:
 *
 *   1. **The grounding rule outranks the persona, explicitly.** specs.md Part 1: the
 *      personas set voice and values, never facts. But `characters.md` tells Cersei she
 *      "twists facts to win" and Tyrion that he "finds the weak point and presses it" —
 *      read literally, that is an instruction to distort. The resolution is stated in
 *      the prompt rather than hoped for: **spin the given facts, invent none.** An
 *      advocate may read a motive the worst way and emphasise selectively; it may not
 *      manufacture a fact that is not in the charge sheet or the data files.
 *
 *   2. **The charge sheet is delimited as evidence.** It is up to 300 words of user
 *      text landing in seven prompts. It is fenced and introduced as the case being
 *      argued, never as instructions to the model.
 *
 *   3. **Judges see the statements labelled by side, not by name** — "for the defense",
 *      "for the prosecution" — so judging weighs the argument rather than the speaker's
 *      reputation. Advocates write in character and in first person, so a statement may
 *      still name its own speaker; that is accepted, not patched. Forcing characters
 *      not to name themselves would damage the voice, which is the point of the run.
 *      The *label* is anonymous; the writing need not be.
 *
 * Word limits are prompt-enforced, with `max_tokens` set above them as headroom
 * (specs.md Part 5: a token ceiling set at the word count truncates mid-sentence rather
 * than inducing brevity).
 */

import type { ChatMessage } from "./openrouter.js";
import type { Character, Judge, TribunalData } from "./data.js";
import type { CastAdvocate, Side, ValidRun } from "./preflight.js";
import { chargeSheetBlock, statementEntry } from "./fence.js";

/**
 * specs.md Part 1: each advocate statement is at most 150 words.
 *
 * Was 120, chosen before anything had been run. Measured across five live trials on
 * 2026-08-21, statements came back at 70, 80, 85, 85, 89, 103, 108, 112, 112, 123,
 * 124, 133 and 141 words — roughly half of them over the old cap. A limit that half
 * the run walks through is not a limit; 150 clears every statement observed, so a
 * breach becomes a real outlier worth flagging rather than the ordinary case.
 */
export const ADVOCATE_WORD_CAP = 150;

/**
 * The word cap restated as sentences, because **a model cannot count its own words and can
 * count sentences.** Measured 2026-08-22 at the 150 cap: 232 words and 164 words in one
 * run, and 175 in the run before — the overrun ratio held almost exactly steady across the
 * raise from 120 (+18%) to 150 (+17%), which is the sign that the number was never the
 * lever. So the number stays and the *instruction* changes: the limit is stated as a hard
 * one rather than hedged, given a shape the model can actually hold itself to, and repeated
 * in the user turn — the last thing read before generation, where a mid-system-prompt
 * bullet has the least pull.
 */
export const ADVOCATE_SENTENCES = "8 to 10";
/**
 * Headroom above the cap — sized for the model's *thinking plus* its answer, not for
 * the answer alone (specs.md Part 5). A reasoning model that is cut off mid-thought
 * has no finished answer to separate, so `reasoning.exclude` has nothing to strip and
 * the partial deliberation is what lands in the content.
 *
 * Measured 2026-08-21 on `nemotron-3-nano-30b-a3b:free`: at 220 tokens the call spent
 * 214 thinking and returned deliberation about word counts as the statement; at 1200 it
 * finished inside 939 (523 thinking) and returned a clean 103-word statement.
 *
 * Raised from 1200 to 3000 after later trials the same day measured a single advocate
 * call spending **1,334 tokens thinking** — more than the whole ceiling then allowed,
 * before a word of the statement was written. 3000 is roughly twice the worst thinking
 * observed plus the answer. Headroom is free: tokens are counted only if generated, and
 * `reasoning.effort` already caps the thinking. This is a ceiling, not a target — the
 * word cap is held by the prompt, which models mostly respect.
 */
export const ADVOCATE_MAX_TOKENS = 3000;

/**
 * specs.md Part 1: each judge's verdict-and-reasoning is at most 120 words.
 *
 * Was 100, on the same untested basis as the advocate cap. Measured reasoning came
 * back at 31, 53, 62, 65, 104 and 113 words, so two of six breached it. 120 clears
 * them all.
 */
export const JUDGE_WORD_CAP = 120;

/** The judge's cap as sentences — see `ADVOCATE_SENTENCES` for why both forms are given. */
export const JUDGE_SENTENCES = "6 to 8";
/**
 * Headroom above the cap, above the JSON wrapper the reply carries, and — as with the
 * advocates — above the model's thinking (specs.md Part 5).
 *
 * This is the ceiling that matters most: a truncated judge returns partial
 * deliberation, which is exactly the two-live-readings shape `judge-parser.ts` refuses
 * to resolve, so a ceiling set too low buys a retry and a second request against a free
 * tier that rations requests rather than tokens.
 *
 * Raised from 1000 to 2500 after a live trial on 2026-08-21 caught exactly that: Barak,
 * on `nemotron-3-ultra-550b-a55b:free`, spent **1,231 tokens thinking against a 1,000
 * ceiling** and his reasoning ended mid-sentence — the failure this comment already
 * described, with the ceiling still set below what the model spends before answering.
 * `judging.ts` now also reads `finish_reason: "length"` as truncation, so exceeding
 * even this ceiling is detected rather than parsed as if it were an answer.
 */
export const JUDGE_MAX_TOKENS = 2500;

/** How a side is named to the model. The UI uses the same two words. */
export const SIDE_NAME: Record<Side, string> = { for: "the defense", against: "the prosecution" };
const SIDE_VERB: Record<Side, string> = { for: "defending", against: "prosecuting" };

export interface BuiltPrompt {
  /** Matches the openrouter attempt label, e.g. `advocate:tyrion`, `judge:barak`. */
  readonly label: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  /** The cap stated in the prompt, so the caller can measure against the same number. */
  readonly wordCap: number;
}

/**
 * The one word-counting rule, shared by the builders, the caps and the over-cap flag.
 *
 * Re-exported rather than defined here: it now lives in `preflight.ts`, because the count
 * it produces is a pre-flight fact first — it is what becomes `chargeSheetWords` in the
 * record — and this module already imports that one. Re-exported rather than merely moved
 * so the call sites that think of it as a prompt-building concern still read naturally.
 */
export { countWords } from "./preflight.js";


/**
 * The grounding rule, in the advocate's wording. specs.md Part 1: "Personas set voice
 * and values, never facts, and no outside knowledge of the characters may enter. A
 * needed-but-missing fact is labelled an assumption, never asserted as true."
 *
 * The third bullet is the one that resolves the collision with an adversarial persona.
 * Without it, "twists facts to win" reads as licence to hallucinate.
 */
const ADVOCATE_GROUNDING = [
  "THE GROUNDING RULE. It outranks everything else here, including your own character:",
  "",
  "  1. The only facts in existence are those in the charge sheet and in the descriptions",
  "     above. You have no other knowledge of these people, this world, or what happened.",
  "     Anything you were never told is not available to you and may not be asserted.",
  "  2. A name is a fact. Do not name any place, house, region, title, army, weapon,",
  "     battle or event unless that name appears in the text you were given. This is the",
  "     easiest way to break the rule above without noticing, because a name feels like",
  "     scenery rather than a claim — but a name you were not given is knowledge from",
  "     outside this tribunal. Where you need to point at something the text leaves",
  '     unnamed, describe it — "the realm", "the throne", "her city" — instead of',
  "     reaching for the name you happen to know.",
  "  3. Your description sets how you speak and what you value. It is not a source of",
  "     facts and it is never permission to invent one.",
  "  4. You may spin what you were given — read a motive the worst way, press what helps",
  "     you, make little of what does not. You may not manufacture what you were not",
  "     given. Spin the facts; invent none. However adversarial your description makes",
  "     you, and however hard you press: twist the reading, never the record.",
  "  5. If your argument needs a fact you do not have, say openly that you are assuming",
  '     it — "I assume", "if it is true that" — and argue from it as an assumption.',
  "     Never state it as established.",
].join("\n");

/** The same rule from the bench: a judge weighs, and never supplies what is missing. */
const JUDGE_GROUNDING = [
  "THE GROUNDING RULE. It outranks everything else here, including your temperament:",
  "",
  "  1. The only facts in existence are those in the charge sheet and in the statements",
  "     below. You have no other knowledge of this case, these people, or this world.",
  "  2. A name is a fact, and the same limit binds you. Do not name any place, house,",
  "     region, title, army, weapon, battle or event unless that name appears in the",
  "     charge sheet or in a statement. Where you must point at something unnamed,",
  "     describe it instead of reaching for the name you happen to know.",
  "  3. Your temperament sets how you weigh what you are given. It is not a source of",
  "     facts and it never supplies one that is absent.",
  "  4. Where the advocates contradict each other, or where something you need was never",
  "     put before you, say so and rule on what you actually have. Do not fill the gap",
  "     yourself. Thin evidence is a finding you may state, not a reason to invent.",
].join("\n");

/**
 * One advocate's prompt: the charge sheet, its own description, the defendant's
 * description, its standing relationship to the defendant, and its assigned side.
 *
 * The relation comes from `relations.md`, which describes standing relationships only —
 * the charge sheet supplies what happened (specs.md Part 1). Keeping those apart is what
 * stops a data file from deciding the trial before it runs: a relations file that stated
 * the alleged act as fact would settle the charge before an advocate ever argued it.
 *
 * **The speaker may be the accused.** Part 1 lets the defendant hold a defence seat, and
 * the two blocks that describe "the defendant" and "your standing with the defendant"
 * both become nonsense when the speaker *is* them — a prompt that told Jon who Jon is,
 * and then that nothing between Jon and Jon is on record, would read as a bug to the
 * model and would spend a call proving it. So that case is written rather than patched:
 * the description is not repeated, the standing block says the speaker is the one being
 * accused, and the brief asks them to answer the charge instead of to defend someone.
 */
export function buildAdvocatePrompt(
  run: ValidRun,
  advocate: CastAdvocate,
  data: TribunalData,
): BuiltPrompt {
  const speaker: Character = advocate.character;
  const defendant = run.defendant;
  const isAccused = speaker.id === defendant.id;
  const relation = isAccused ? undefined : data.getRelation(speaker.id, defendant.id);
  const ally = run.advocates.find(
    (other) => other.side === advocate.side && other.character.id !== speaker.id,
  );

  const system = [
    isAccused
      ? `You are ${speaker.name}, called before the Tribunal to answer the charge against you.`
      : `You are ${speaker.name}, called before the Tribunal to argue one side of a case.`,
    "",
    "WHO YOU ARE — this is your voice and your values, and nothing beyond that:",
    speaker.description,
    "",
    ...(isAccused
      ? [
          "YOUR POSITION IN THIS CASE:",
          "You are the accused. The charge sheet below is the case against you, and you are speaking in your own defence.",
        ]
      : [
          `THE DEFENDANT, ${defendant.name}:`,
          defendant.description,
          "",
          `YOUR STANDING WITH ${defendant.name.toUpperCase()} — how things are between you, not what happened in this case:`,
          relation ? relation.text : `Nothing between you and ${defendant.name} is on record.`,
        ]),
    "",
    "YOUR BRIEF:",
    isAccused
      ? "You are answering the charge yourself. You argue for your own acquittal in your own voice, whatever you privately make of what you did."
      : `You are ${SIDE_VERB[advocate.side]} ${defendant.name}. You argue that side whether or not you would have chosen it, and you argue it in your own voice.`,
    ally
      ? `${ally.character.name} argues your side as well; the other two argue against you.`
      : "The other advocates argue the other side.",
    "You will not hear what any of them say, and none of them will hear this. Say your",
    "piece as if it has to stand on its own, because it does.",
    "",
    ADVOCATE_GROUNDING,
    "",
    "HOW TO ANSWER:",
    "",
    "  · One statement to the tribunal, first person, in your own voice.",
    "  · Prose only. No headings, no bullet points, no stage directions, no labels, and",
    "    no quotation marks around the whole thing.",
    `  · **Hard limit: ${ADVOCATE_WORD_CAP} words.** Around ${ADVOCATE_SENTENCES} sentences. Going over is a failure of`,
    "    the brief, not a fuller argument — the tribunal hears every advocate at the same",
    "    length or it is not hearing them evenly. Fewer is perfectly good: if your way is",
    "    to be spare, be spare and stop. There is no minimum.",
    "  · Speak only for yourself. Do not write another advocate's part, do not invent",
    "    their argument, and do not address the other side as if they were present.",
    "  · Give the statement and nothing else — no preamble, no sign-off, no commentary",
    "    on the task.",
  ].join("\n");

  const user = [
    chargeSheetBlock(run.chargeSheet),
    "",
    isAccused
      ? `${speaker.name}, make your statement in answer to the charge.`
      : `${speaker.name}, make your statement ${SIDE_VERB[advocate.side]} ${defendant.name}.`,
    `Remember: ${ADVOCATE_WORD_CAP} words at the very most, about ${ADVOCATE_SENTENCES} sentences. Stop when you have said it.`,
  ].join("\n");

  return {
    label: `advocate:${speaker.id}`,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: ADVOCATE_MAX_TOKENS,
    wordCap: ADVOCATE_WORD_CAP,
  };
}

/** One statement as the judges receive it: the side it argued, and the text. */
export interface DeliveredStatement {
  readonly side: Side;
  readonly text: string;
}

/**
 * The statements block. Labelled by side and numbered, never by speaker.
 *
 * When fewer than four arrived the shortfall is stated rather than hidden — a judge
 * that silently saw three statements would weigh a failed call as a side with nothing
 * to say. An honestly incomplete trial is the run record we want.
 */
function statementsBlock(statements: readonly DeliveredStatement[], expected: number): string {
  const lines = [
    "THE STATEMENTS. Each is labelled by the side it argues and not by who delivered it,",
    "so that you weigh the argument and not the name behind it. A speaker may name",
    "themselves inside their own statement; that is theirs to do, and it changes nothing.",
  ];

  if (statements.length < expected) {
    const missing = expected - statements.length;
    lines.push(
      "",
      `Note: ${missing} of the ${expected} advocates did not deliver a statement. Rule on what was actually said. Do not speculate about what the missing statement would have argued.`,
    );
  }

  statements.forEach((statement, index) => {
    // Through the fence, never by hand: the heading is a delimiter, and the text beside it
    // is model output that could forge one (specs.md Part 5).
    lines.push("", statementEntry(index + 1, statements.length, SIDE_NAME[statement.side], statement.text));
  });

  return lines.join("\n");
}

/**
 * One judge's prompt: the charge sheet, all delivered statements, and the judge's own
 * persona. No relations and no character descriptions: specs.md Part 1 has the bench
 * hear the four statements labelled by side, not by name, so a verdict turns on the
 * argument rather than on who made it or what the data files say about them — handing a
 * judge the relations behind a closed door would let a fact never argued into the room
 * anyway. The defendant is named because a verdict has to be about someone, and the
 * charge sheet names them in any case, which the pre-flight guarantees.
 *
 * The reply is asked for as a single JSON object. `judging.ts` does not depend on
 * getting one — it salvages a verdict from prose too — but asking for the strict form
 * is what makes the strict path the common one.
 */
export function buildJudgePrompt(
  run: ValidRun,
  judge: Judge,
  statements: readonly DeliveredStatement[],
): BuiltPrompt {
  const system = [
    `You are ${judge.name}, sitting in judgment on the Tribunal.`,
    "",
    "YOUR JUDICIAL TEMPERAMENT — this is how you reason and what you weigh, and nothing",
    "beyond that:",
    judge.persona,
    "",
    `THE DEFENDANT before you is ${run.defendant.name}. Four advocates were briefed, two defending and two prosecuting; you have their statements below, and nothing else.`,
    "",
    JUDGE_GROUNDING,
    "",
    "HOW TO ANSWER. Return one JSON object and nothing else — no code fence, no preamble,",
    "no commentary before it or after it:",
    "",
    '  {"verdict": "guilty", "reasoning": "..."}',
    "",
    '  · "verdict" is exactly one of the two strings "guilty" or "not_guilty". No other',
    "    value, no third option, no hedge. You must decide.",
    `  · "reasoning" is your own reasoning, at most ${JUDGE_WORD_CAP} words, giving at least two`,
    "    distinct reasons for the verdict you reached — in your voice as a judge, not a",
    "    summary of what the advocates said.",
    "  · Put both fields on one line, with the quotation marks and braces exactly as",
    "    shown. Do not add fields.",
  ].join("\n");

  const user = [
    chargeSheetBlock(run.chargeSheet),
    "",
    statementsBlock(statements, run.advocates.length),
    "",
    `${judge.name}, give your verdict on ${run.defendant.name} and your reasoning, as the single JSON object described.`,
    `Remember: the reasoning is ${JUDGE_WORD_CAP} words at the very most, about ${JUDGE_SENTENCES} sentences.`,
  ].join("\n");

  return {
    label: `judge:${judge.id}`,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: JUDGE_MAX_TOKENS,
    wordCap: JUDGE_WORD_CAP,
  };
}
