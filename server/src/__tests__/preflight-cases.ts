/**
 * The pre-flight case catalogue — one list, read by two things:
 *   - `preflight.test.ts`, which asserts each case comes out as stated;
 *   - `server/scripts/preflight-table.ts`, which prints the same cases as a table with
 *     the refusal messages, so the rules can be read without reading the code.
 *
 * Keeping them on one list means the printed table can never drift from what is tested.
 * The first four cases are specs.md Part 4's own cases: the valid Jon Snow trial and the
 * three deliberately invalid ones.
 */

import type { PreflightFailureCode, PreflightInput } from "../preflight.js";

export interface PreflightCase {
  readonly id: string;
  /** The rule the case exists to demonstrate. */
  readonly title: string;
  readonly input: PreflightInput;
  /** `"pass"`, or every failure code expected — exactly, in order. */
  readonly expect: "pass" | readonly PreflightFailureCode[];
}

/** specs.md Part 4: Jon on trial, Tyrion and Cersei defending, Daenerys and Grey Worm prosecuting. */
export const PART_4_CHARGE_SHEET =
  "Jon Snow is charged with regicide and treason: that he killed Queen Daenerys Targaryen " +
  "in the throne room at King's Landing, by his own hand, after swearing her his loyalty. " +
  "The tribunal must decide whether that killing was murder or the prevention of a greater " +
  "slaughter.";

export const PART_4_CAST = [
  { id: "tyrion", side: "for" },
  { id: "cersei", side: "for" },
  { id: "daenerys", side: "against" },
  { id: "grey-worm", side: "against" },
] as const;

/** Exactly ten words, and the shortest charge sheet the pre-flight accepts. */
const TEN_WORDS = "Jon Snow is charged with the murder of his queen.";

/** `TEN_WORDS` padded out to an exact word count, for the two length boundaries. */
function chargeSheetOf(wordCount: number): string {
  const filler = Array.from({ length: wordCount - 10 }, () => "sworn").join(" ");
  return filler ? `${TEN_WORDS} ${filler}` : TEN_WORDS;
}

export const PREFLIGHT_CASES: readonly PreflightCase[] = [
  {
    id: "part4-valid",
    title: "Part 4's case: Jon Snow, regicide and treason, 2 defending / 2 prosecuting",
    input: { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
    expect: "pass",
  },
  {
    id: "part4-defendant-not-in-story",
    title: "Part 4 invalid 1: a defendant who is not in the story",
    input: {
      chargeSheet: PART_4_CHARGE_SHEET,
      defendant: "gandalf",
      advocates: PART_4_CAST,
    },
    expect: ["defendant_unknown"],
  },
  {
    id: "part4-three-one-split",
    title: "Part 4 invalid 2: a three-to-one split",
    input: {
      chargeSheet: PART_4_CHARGE_SHEET,
      defendant: "jon-snow",
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "cersei", side: "for" },
        { id: "daenerys", side: "for" },
        { id: "grey-worm", side: "against" },
      ],
    },
    expect: ["split_not_two_two"],
  },
  {
    id: "part4-defendant-not-named",
    title: "Part 4 invalid 3: a charge sheet that never names the chosen defendant",
    input: {
      chargeSheet:
        "Cersei Lannister is charged with mass murder for the wildfire that destroyed the " +
        "Great Sept of Baelor and every soul inside it, and with usurping a throne that was " +
        "never hers to take.",
      defendant: "jon-snow",
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "cersei", side: "for" },
        { id: "daenerys", side: "against" },
        { id: "grey-worm", side: "against" },
      ],
    },
    expect: ["defendant_not_named"],
  },
  {
    id: "surname-is-not-a-mention",
    title: "A shared surname does not name the defendant: \"Lannister\" is Tyrion or Cersei",
    input: {
      chargeSheet:
        "The Lannister who served as Hand of the Queen is charged with treason for freeing " +
        "a condemned prisoner and conspiring against the crown he had sworn to serve.",
      defendant: "tyrion",
      advocates: [
        { id: "jon-snow", side: "for" },
        { id: "cersei", side: "for" },
        { id: "daenerys", side: "against" },
        { id: "grey-worm", side: "against" },
      ],
    },
    expect: ["defendant_not_named"],
  },
  {
    id: "name-inside-a-longer-word",
    title: "A name only counts as a whole word: \"Jonquil\" is not \"Jon\"",
    input: {
      chargeSheet:
        "The singer Jonquil is accused of treason against the crown, having conspired with " +
        "the enemy through two long winters.",
      defendant: "jon-snow",
      advocates: PART_4_CAST,
    },
    expect: ["defendant_not_named"],
  },
  {
    id: "nickname-counts",
    title: "A used name counts: \"Dany\" names Daenerys",
    input: {
      chargeSheet:
        "Dany is charged with the mass murder of the citizens of King's Landing, burned alive " +
        "after the city had already surrendered and its bells had rung.",
      defendant: "daenerys",
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "jon-snow", side: "for" },
        { id: "cersei", side: "against" },
        { id: "grey-worm", side: "against" },
      ],
    },
    expect: "pass",
  },
  {
    id: "name-match-ignores-case-and-punctuation",
    title: "The name match ignores case and surrounding punctuation",
    input: {
      chargeSheet:
        "Did JON SNOW, sworn brother of the Night's Watch, commit treason when he abandoned " +
        "his post at Castle Black, or was he released from that oath by his own death?",
      defendant: "jon-snow",
      advocates: PART_4_CAST,
    },
    expect: "pass",
  },
  {
    id: "charge-sheet-empty",
    title: "An empty charge sheet is refused",
    input: { chargeSheet: "   ", defendant: "jon-snow", advocates: PART_4_CAST },
    expect: ["charge_sheet_missing"],
  },
  {
    id: "charge-sheet-one-word",
    title: "\"Jon\" alone names the defendant and is under 200 words — the floor stops it",
    input: { chargeSheet: "Jon", defendant: "jon-snow", advocates: PART_4_CAST },
    expect: ["charge_sheet_too_short"],
  },
  {
    id: "charge-sheet-exactly-10-words",
    title: "Ten words is the floor, and passes",
    input: { chargeSheet: chargeSheetOf(10), defendant: "jon-snow", advocates: PART_4_CAST },
    expect: "pass",
  },
  {
    id: "charge-sheet-exactly-200-words",
    title: "Two hundred words is the ceiling, and passes",
    input: { chargeSheet: chargeSheetOf(200), defendant: "jon-snow", advocates: PART_4_CAST },
    expect: "pass",
  },
  {
    id: "charge-sheet-201-words",
    title: "Two hundred and one words is refused",
    input: { chargeSheet: chargeSheetOf(201), defendant: "jon-snow", advocates: PART_4_CAST },
    expect: ["charge_sheet_too_long"],
  },
  {
    id: "charge-sheet-with-no-charge",
    title: "Part 5: text that names the defendant but accuses him of nothing",
    input: {
      chargeSheet:
        "Jon Snow was at Winterfell that winter, and the snow fell on the godswood for many " +
        "days without stopping.",
      defendant: "jon-snow",
      advocates: PART_4_CAST,
    },
    expect: ["charge_sheet_no_charge"],
  },
  {
    id: "charge-as-a-question",
    title: "A charge put as a question is accepted — the question is what the tribunal answers",
    input: {
      chargeSheet:
        "Jon Snow put a blade in the queen he had bent the knee to. Was that the act of a " +
        "traitor, or the only thing left to a man who had run out of other choices?",
      defendant: "jon-snow",
      advocates: PART_4_CAST,
    },
    expect: "pass",
  },
  {
    id: "defendant-also-an-advocate",
    title: "The defendant can never also argue the case",
    input: {
      chargeSheet: PART_4_CHARGE_SHEET,
      defendant: "jon-snow",
      advocates: [
        { id: "jon-snow", side: "for" },
        { id: "cersei", side: "for" },
        { id: "daenerys", side: "against" },
        { id: "grey-worm", side: "against" },
      ],
    },
    expect: ["advocate_is_defendant"],
  },
  {
    id: "advocate-cast-twice",
    title: "Each advocate is a different character",
    input: {
      chargeSheet: PART_4_CHARGE_SHEET,
      defendant: "jon-snow",
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "tyrion", side: "for" },
        { id: "daenerys", side: "against" },
        { id: "grey-worm", side: "against" },
      ],
    },
    expect: ["advocate_duplicated"],
  },
  {
    id: "three-advocates",
    title: "All four non-defendant characters must be cast",
    input: {
      chargeSheet: PART_4_CHARGE_SHEET,
      defendant: "jon-snow",
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "cersei", side: "for" },
        { id: "daenerys", side: "against" },
      ],
    },
    expect: ["advocates_wrong_count"],
  },
  {
    id: "advocate-with-no-side",
    title: "Every advocate is assigned a side",
    input: {
      chargeSheet: PART_4_CHARGE_SHEET,
      defendant: "jon-snow",
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "cersei", side: "" },
        { id: "daenerys", side: "against" },
        { id: "grey-worm", side: "against" },
      ],
    },
    expect: ["advocate_side_invalid"],
  },
  {
    id: "several-mistakes-at-once",
    title: "Every failure is reported together, not just the first",
    input: {
      chargeSheet: "",
      defendant: "gandalf",
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "cersei", side: "for" },
        { id: "daenerys", side: "for" },
        { id: "grey-worm", side: "against" },
      ],
    },
    expect: ["charge_sheet_missing", "defendant_unknown", "split_not_two_two"],
  },
  {
    id: "junk-payload",
    title: "A payload of the wrong types is refused, not crashed on",
    input: { chargeSheet: 42, defendant: null, advocates: "tyrion" },
    expect: ["charge_sheet_missing", "defendant_missing", "advocates_missing"],
  },
];
