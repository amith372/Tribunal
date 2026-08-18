/**
 * preflight.ts — the structural check that runs before a single model call.
 *
 * specs.md Part 1: "Before any model call, the app confirms the run is valid ... and
 * refuses an invalid run before spending a single call. This is a cheap structural
 * check (a roster lookup and a name match), not a model call."
 *
 * Three properties this module holds to:
 *   1. **It never throws.** Its input comes off the network, so every field is treated
 *      as `unknown` and every problem comes back as a listed failure. A pre-flight that
 *      threw would turn a bad charge sheet into a 500 and lose the reasons.
 *   2. **It reports every failure it can see**, not the first — a user who set the split
 *      wrong *and* forgot to name the defendant should fix both in one pass. Checks that
 *      would cascade into noise are gated (see the `gate` comments below).
 *   3. **Every message is written to be read on screen**, naming what is wrong and what
 *      to do about it. specs.md Part 2 requires this explicitly for the name check: the
 *      refusal "states which names were searched for, so the user can see why it failed
 *      rather than guess".
 *
 * It is a pure function of `(input, data)`, so it is unit-testable with no server and
 * no API key — this stage makes zero model calls by design.
 */

import type { Character, TribunalData } from "./data.js";

/** Which side an advocate was cast on. `for` defends, `against` prosecutes. */
export type Side = "for" | "against";

export type PreflightFailureCode =
  | "charge_sheet_missing"
  | "charge_sheet_too_short"
  | "charge_sheet_too_long"
  | "charge_sheet_no_charge"
  | "defendant_missing"
  | "defendant_unknown"
  | "defendant_not_named"
  | "advocates_missing"
  | "advocates_wrong_count"
  | "advocate_unknown"
  | "advocate_duplicated"
  | "advocate_is_defendant"
  | "advocates_not_the_others"
  | "advocate_side_invalid"
  | "split_not_two_two";

export interface PreflightFailure {
  readonly code: PreflightFailureCode;
  /** Which setup field to send the user back to. */
  readonly field: "chargeSheet" | "defendant" | "advocates";
  /** Shown to the user as written. */
  readonly message: string;
}

/** The shape the browser posts. Every field is `unknown`: none of it is trusted. */
export interface PreflightInput {
  readonly chargeSheet?: unknown;
  readonly defendant?: unknown;
  readonly advocates?: unknown;
}

export interface CastAdvocate {
  readonly character: Character;
  readonly side: Side;
}

/** What a passing pre-flight hands the pipeline: normalised, typed, already checked. */
export interface ValidRun {
  readonly chargeSheet: string;
  readonly chargeSheetWords: number;
  readonly defendant: Character;
  readonly advocates: readonly CastAdvocate[];
}

export type PreflightResult =
  | { readonly ok: true; readonly failures: readonly PreflightFailure[]; readonly run: ValidRun }
  | { readonly ok: false; readonly failures: readonly PreflightFailure[]; readonly run: null };

/**
 * Charge-sheet length. The 200-word ceiling is specs.md Part 1.
 *
 * The 10-word floor exists because the ceiling and the name check between them do not
 * stop a one-word run: a charge sheet reading only "Jon" names the defendant and is
 * under 200 words, and would reach seven model calls with nothing for the advocates to
 * argue from but their own invention — which Part 1's grounding rule forbids and Part 5
 * names as a pitfall.
 */
export const MIN_CHARGE_SHEET_WORDS = 10;
export const MAX_CHARGE_SHEET_WORDS = 200;

/**
 * The names searched for in the charge sheet, per character.
 *
 * **Given and used names only — deliberately no surnames.** "Lannister" is ambiguous
 * between Tyrion and Cersei, and "Targaryen" is worse than ambiguous here: Jon is a
 * hidden Targaryen, so a charge sheet about Daenerys naming only her house would match
 * the wrong defendant. A name that cannot identify one character is not evidence that
 * the charge sheet is about them.
 *
 * These strings are shown to the user verbatim when the check fails (Part 2), so they
 * are stored in display case.
 */
export const SEARCHED_NAMES: Record<string, readonly string[]> = {
  "jon-snow": ["Jon Snow", "Jon"],
  daenerys: ["Daenerys", "Dany"],
  tyrion: ["Tyrion"],
  "grey-worm": ["Grey Worm", "Greyworm"],
  cersei: ["Cersei"],
};

/**
 * Word stems that read as an accusation. This check exists because of specs.md Part 5 —
 * "A charge sheet may lack its actual question — the advocates must not invent the
 * charge; the pre-flight and the prompts should surface a missing question rather than
 * guess around it."
 *
 * Matched as prefixes of whole words, so "charg" covers charge/charged/charges. The list
 * is deliberately broad, and a question mark passes on its own: a valid charge sheet
 * wrongly refused costs the user a real run, while a vague one that slips through only
 * produces a weak trial. Leniency is the cheaper error here.
 */
const CHARGE_CUES: readonly string[] = [
  "accus", "alleg", "answerable", "arson", "assassinat", "betray", "breach", "bribe",
  "charg", "conspir", "convict", "crime", "criminal", "culpab", "defraud", "desert",
  "fraud", "guilt", "indict", "kidnap", "kill", "liable", "murder", "mutin", "oath",
  "offence", "offense", "perjur", "prosecut", "regicide", "responsib", "slaught",
  "steal", "stole", "theft", "thief", "traitor", "treason", "trial", "unlawful",
  "violat", "wrongdoing",
];

const SIDES: readonly string[] = ["for", "against"];
const SIDE_LABEL: Record<Side, string> = { for: "defending", against: "prosecuting" };

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter((word) => word.length > 0);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word and case-insensitive. Without the boundaries "Jon" would match "Jonquil". */
function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}([^\\p{L}]|$)`, "iu").test(text);
}

function namesFor(character: Character): readonly string[] {
  // Falls back to the display name so a sixth character added to characters.md still
  // gets a usable check rather than an unmatchable empty list. A test asserts that all
  // five are listed explicitly, which is where that omission would actually be caught.
  return SEARCHED_NAMES[character.id] ?? [character.name];
}

function looksLikeACharge(text: string): boolean {
  if (text.includes("?")) return true;
  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return tokens.some((token) => CHARGE_CUES.some((cue) => token.startsWith(cue)));
}

function quoteList(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(", ");
}

function asSide(value: unknown): Side | null {
  if (typeof value !== "string") return null;
  const side = value.trim().toLowerCase();
  return SIDES.includes(side) ? (side as Side) : null;
}

/**
 * Runs every structural check. Returns the failures it found, and the normalised run
 * only when it found none. Never throws.
 */
export function preflight(input: PreflightInput, data: TribunalData): PreflightResult {
  const failures: PreflightFailure[] = [];
  const fail = (code: PreflightFailureCode, field: PreflightFailure["field"], message: string) => {
    failures.push({ code, field, message });
  };

  const roster = data.characters.map((character) => character.name).join(", ");

  // ---- charge sheet -------------------------------------------------------------
  const rawChargeSheet = typeof input.chargeSheet === "string" ? input.chargeSheet : "";
  const chargeSheet = rawChargeSheet.trim();
  const chargeSheetWords = words(chargeSheet).length;

  if (chargeSheetWords === 0) {
    fail(
      "charge_sheet_missing",
      "chargeSheet",
      "The charge sheet is empty. Write the accusation you want the tribunal to try.",
    );
  } else if (chargeSheetWords < MIN_CHARGE_SHEET_WORDS) {
    fail(
      "charge_sheet_too_short",
      "chargeSheet",
      `The charge sheet is ${chargeSheetWords} ${chargeSheetWords === 1 ? "word" : "words"} long; ` +
        `it needs at least ${MIN_CHARGE_SHEET_WORDS}. Four advocates and three judges argue from ` +
        "this text alone, so anything shorter leaves them inventing the case.",
    );
  } else if (chargeSheetWords > MAX_CHARGE_SHEET_WORDS) {
    fail(
      "charge_sheet_too_long",
      "chargeSheet",
      `The charge sheet is ${chargeSheetWords} words long; the limit is ${MAX_CHARGE_SHEET_WORDS}. ` +
        `Cut ${chargeSheetWords - MAX_CHARGE_SHEET_WORDS} and submit again.`,
    );
  }

  // gate: only meaningful once there is enough text to hold a charge at all.
  if (chargeSheetWords >= MIN_CHARGE_SHEET_WORDS && !looksLikeACharge(chargeSheet)) {
    fail(
      "charge_sheet_no_charge",
      "chargeSheet",
      "The charge sheet doesn't say what the defendant is accused of. Name the act and the " +
        'charge — words like "accused of", "charged with", "murder", "treason" — or write the ' +
        "question the tribunal has to answer. The advocates are not allowed to invent the charge.",
    );
  }

  // ---- defendant ----------------------------------------------------------------
  const defendantId = typeof input.defendant === "string" ? input.defendant.trim() : "";
  const defendant = defendantId ? data.getCharacter(defendantId) : undefined;

  if (!defendantId) {
    fail("defendant_missing", "defendant", `No defendant was chosen. Pick one of: ${roster}.`);
  } else if (!defendant) {
    // specs.md Part 4's first invalid case: a defendant who is not in the story.
    fail(
      "defendant_unknown",
      "defendant",
      `"${defendantId}" is not one of the five characters in this story, so they cannot be put ` +
        `on trial. Choose one of: ${roster}.`,
    );
  }

  // gate: the names to search for come from the defendant, so an unknown or missing
  // defendant leaves this check unanswerable rather than failed.
  if (defendant && chargeSheetWords > 0) {
    const searched = namesFor(defendant);
    if (!searched.some((name) => mentions(chargeSheet, name))) {
      // specs.md Part 4's third invalid case, and the one Part 2 requires a reason for.
      fail(
        "defendant_not_named",
        "chargeSheet",
        `The charge sheet never names the defendant, ${defendant.name}. Searched for ` +
          `${quoteList(searched)} — given names only, because surnames like "Lannister" and ` +
          '"Targaryen" are shared and would match the wrong character. Name the accused in the ' +
          "charge sheet so the advocates argue the case you wrote rather than one they invent.",
      );
    }
  }

  // ---- advocates ----------------------------------------------------------------
  const rawAdvocates = Array.isArray(input.advocates) ? input.advocates : null;
  const cast: CastAdvocate[] = [];
  let castIsClean = rawAdvocates !== null;

  if (rawAdvocates === null) {
    fail(
      "advocates_missing",
      "advocates",
      "No advocates were cast. The four characters who are not the defendant each argue one " +
        "side — two defending, two prosecuting.",
    );
  } else {
    const expected = data.characters.length - 1;
    if (rawAdvocates.length !== expected) {
      castIsClean = false;
      fail(
        "advocates_wrong_count",
        "advocates",
        `The tribunal needs exactly ${expected} advocates — every character who is not the ` +
          `defendant. ${rawAdvocates.length} ${rawAdvocates.length === 1 ? "was" : "were"} cast.`,
      );
    }

    const seen = new Set<string>();
    for (const [index, entry] of rawAdvocates.entries()) {
      const position = index + 1;
      const record = (entry ?? {}) as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const character = id ? data.getCharacter(id) : undefined;
      const side = asSide(record.side);

      if (!character) {
        castIsClean = false;
        fail(
          "advocate_unknown",
          "advocates",
          id
            ? `Advocate ${position}, "${id}", is not one of the five characters. Cast from: ${roster}.`
            : `Advocate ${position} has no character. Cast from: ${roster}.`,
        );
      } else if (seen.has(character.id)) {
        castIsClean = false;
        fail(
          "advocate_duplicated",
          "advocates",
          `${character.name} is cast twice. Each of the four advocates is a different character.`,
        );
      } else if (defendant && character.id === defendant.id) {
        castIsClean = false;
        // Part 1 non-negotiable: the defendant is never also an advocate.
        fail(
          "advocate_is_defendant",
          "advocates",
          `${character.name} is on trial and cannot also argue the case. Cast the other four.`,
        );
      }

      if (character) seen.add(character.id);

      if (side === null) {
        castIsClean = false;
        fail(
          "advocate_side_invalid",
          "advocates",
          `${character ? character.name : `Advocate ${position}`} has no side. Each advocate is ` +
            "assigned either to defend or to prosecute.",
        );
      }

      if (character && side) cast.push({ character, side });
    }

    // gate: on a broken cast the split arithmetic would report a second, derived failure
    // for the same mistake, so it is only checked once the roster itself is sound.
    if (castIsClean) {
      const forCount = cast.filter((advocate) => advocate.side === "for").length;
      const againstCount = cast.length - forCount;
      if (forCount !== 2 || againstCount !== 2) {
        // specs.md Part 4's second invalid case: a three-to-one split.
        fail(
          "split_not_two_two",
          "advocates",
          "The split must be exactly two defending and two prosecuting. This casting is " +
            `${forCount} ${SIDE_LABEL.for} and ${againstCount} ${SIDE_LABEL.against}.`,
        );
      }

      // Belt and braces: with five characters, four unique non-defendant advocates can
      // only be the other four, so this cannot fire today. It is what would catch a sixth
      // character being added to characters.md without casting being revisited.
      if (defendant) {
        const missing = data.characters.filter(
          (character) => character.id !== defendant.id && !seen.has(character.id),
        );
        if (missing.length > 0) {
          fail(
            "advocates_not_the_others",
            "advocates",
            "The advocates must be the four characters who are not the defendant. Not cast: " +
              `${missing.map((character) => character.name).join(", ")}.`,
          );
        }
      }
    }
  }

  if (failures.length > 0 || !defendant) {
    // The `!defendant` arm is unreachable while the checks above stand; it is here so the
    // success branch can never hand the pipeline a run without a defendant.
    return { ok: false, failures, run: null };
  }

  return {
    ok: true,
    failures: [],
    run: { chargeSheet, chargeSheetWords, defendant, advocates: cast },
  };
}
