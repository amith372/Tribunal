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
 *
 * **The browser applies these same three predicates, imported rather than copied.**
 * `countWords`, `mentions` and `looksLikeACharge` are exported for `web/src/setup-checks.ts`,
 * which shows the checks answering as the user types — worth doing here because the daily
 * allowance is rationed in *requests*, so a refusal caught before the button costs nothing
 * and one caught after it costs a run. That file used to re-implement all three, held
 * against this one by a test; there is one implementation now, reached across the `@record`
 * alias exactly as `summary.ts` is.
 *
 * **None of which moves the authority.** `POST /api/run` runs this on every run and refuses
 * an invalid one before a single model call, whatever any screen believed. What the browser
 * gets is a preview, and specs.md Part 5's invalid-split pitfall is still provable by
 * posting straight to the API with no browser involved.
 */

import type { Character, TribunalData } from "./data.js";
import { forgedMarkerIn } from "./fence.js";

/** Which side an advocate was cast on. `for` defends, `against` prosecutes. */
export type Side = "for" | "against";

export type PreflightFailureCode =
  | "charge_sheet_missing"
  | "charge_sheet_too_short"
  | "charge_sheet_too_long"
  | "charge_sheet_no_charge"
  | "charge_sheet_forges_marker"
  | "defendant_missing"
  | "defendant_unknown"
  | "defendant_not_named"
  | "advocates_missing"
  | "advocates_wrong_count"
  | "advocate_unknown"
  | "advocate_duplicated"
  | "defendant_prosecuting"
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
 * Charge-sheet length. The 300-word ceiling is specs.md Part 1.
 *
 * **Raised from 200 to 300** when the default case became the canonical charge sheet —
 * an act alleged, an agreed factual record, and the question put to the tribunal. That
 * shape does not fit in 200 words, and the alternative was a default case that arrived
 * already abridged, which would have made the app's own worked example the one charge
 * sheet no advocate could argue in full.
 *
 * The 10-word floor exists because the ceiling and the name check between them do not
 * stop a one-word run: a charge sheet reading only "Jon" names the defendant and is
 * under the ceiling, and would reach seven model calls with nothing for the advocates to
 * argue from but their own invention — which Part 1's grounding rule forbids and Part 5
 * names as a pitfall.
 */
export const MIN_CHARGE_SHEET_WORDS = 10;
export const MAX_CHARGE_SHEET_WORDS = 300;

/**
 * The bench of advocates: four seats, two a side.
 *
 * Four is a fixed number of seats rather than "everyone who is not the defendant"
 * (specs.md Part 1). The accused may take a defence seat, so the four are drawn from all
 * five characters and one character sits out — which is why this is a constant and not
 * `characters.length - 1`.
 */
export const ADVOCATE_SEATS = 4;
export const SEATS_PER_SIDE = 2;

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
 *
 * It is exported because `/api/health` serves it to the browser: the Setup screen shows
 * this check passing or failing as the user types, and a second copy of the list kept in
 * the client would eventually disagree with this one — telling the user a sheet is fine
 * that the server then refuses. The screen reads the rule rather than remembering it, and
 * since it also imports `looksLikeACharge` itself, it no longer remembers how to apply it
 * either.
 */
export const CHARGE_CUES: readonly string[] = [
  "accus", "alleg", "answerable", "arson", "assassinat", "betray", "breach", "bribe",
  "charg", "conspir", "convict", "crime", "criminal", "culpab", "defraud", "desert",
  "fraud", "guilt", "indict", "kidnap", "kill", "liable", "murder", "mutin", "oath",
  "offence", "offense", "perjur", "prosecut", "regicide", "responsib", "slaught",
  "steal", "stole", "theft", "thief", "traitor", "treason", "trial", "unlawful",
  "violat", "wrongdoing",
];

const SIDES: readonly string[] = ["for", "against"];
const SIDE_LABEL: Record<Side, string> = { for: "defending", against: "prosecuting" };

/**
 * The one word-counting rule — the number that becomes `chargeSheetWords` in the run
 * record and the export, and the number under the browser's textarea.
 *
 * **Exported because the setup screen counts with it too.** `web/src/setup-checks.ts`
 * imports this across the `@record` alias rather than keeping a copy, so the counter the
 * user watches while writing and the counter that decides the run cannot disagree at
 * exactly 300. `prompts.ts` imports it as well, so the caps, the over-cap flag and this
 * check are all one rule rather than three that happen to match.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word and case-insensitive. Without the boundaries "Jon" would match "Jonquil".
 *
 * Exported for the setup screen, which asks the same question about the same sheet while
 * the user types. The regex is the check — a second copy of it in the browser was the
 * expensive kind of duplication, because the two drifting apart would show the user a
 * green tick on a sheet the server then refuses.
 */
export function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}([^\\p{L}]|$)`, "iu").test(text);
}

function namesFor(character: Character): readonly string[] {
  // Falls back to the display name so a sixth character added to characters.md still
  // gets a usable check rather than an unmatchable empty list. A test asserts that all
  // five are listed explicitly, which is where that omission would actually be caught.
  return SEARCHED_NAMES[character.id] ?? [character.name];
}

/**
 * Whether the sheet reads as an accusation. A question mark passes on its own; otherwise
 * a whole word must begin with one of the cues.
 *
 * **The cues are a parameter rather than a closed-over constant, and that is deliberate.**
 * The server passes `CHARGE_CUES` below — its own list, the authority. The setup screen
 * passes the list it was served by `/api/health`, which is the *running* server's list
 * rather than the one the browser bundle was built against. Closing over the constant here
 * would have quietly made a cached bundle judge by yesterday's rules, which is precisely
 * the drift the wire contract exists to prevent. One implementation, two sources of the
 * list, and the deployed server is always the one that decides.
 */
export function looksLikeACharge(text: string, cues: readonly string[]): boolean {
  if (text.includes("?")) return true;
  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return tokens.some((token) => cues.some((cue) => token.startsWith(cue)));
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
  const chargeSheetWords = countWords(chargeSheet);

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
  if (chargeSheetWords >= MIN_CHARGE_SHEET_WORDS && !looksLikeACharge(chargeSheet, CHARGE_CUES)) {
    fail(
      "charge_sheet_no_charge",
      "chargeSheet",
      "The charge sheet doesn't say what the defendant is accused of. Name the act and the " +
        'charge — words like "accused of", "charged with", "murder", "treason" — or write the ' +
        "question the tribunal has to answer. The advocates are not allowed to invent the charge.",
    );
  }

  /**
   * gate: only meaningful once there is text at all, and reported whatever the length,
   * because a sheet that is both too long and forges a marker has two faults to fix.
   *
   * specs.md Part 5: the markers belong to the app, not to the prose. A line that would
   * read as one closes the fence early and has everything after it taken as instruction —
   * the one way user text can address a model directly. Refused here rather than defused,
   * because a person can be sent back to their own words before a call is spent.
   */
  const forged = chargeSheetWords > 0 ? forgedMarkerIn(chargeSheet) : null;
  if (forged) {
    fail(
      "charge_sheet_forges_marker",
      "chargeSheet",
      `Line ${forged.line} of the charge sheet reads as one of the tribunal's own markers: ` +
        `"${forged.text}". Those markers are how each model is told where your text stops and ` +
        "its instructions begin, so a line like that would be read as an instruction rather " +
        "than as evidence. Reword it or take it out.",
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
      "No advocates were cast. Four of the five characters argue — two defending, two " +
        "prosecuting. The accused may take a defence seat; one character sits out.",
    );
  } else {
    if (rawAdvocates.length !== ADVOCATE_SEATS) {
      castIsClean = false;
      fail(
        "advocates_wrong_count",
        "advocates",
        `The tribunal seats exactly ${ADVOCATE_SEATS} advocates, drawn from the ` +
          `${data.characters.length} characters — one of them sits the case out. ` +
          `${rawAdvocates.length} ${rawAdvocates.length === 1 ? "was" : "were"} cast.`,
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

      // Part 1: the accused may argue their own defence, and only that. Deliberately not
      // gated behind `castIsClean` and deliberately not setting it — a defendant put on
      // the prosecution and a lopsided split are two separate mistakes, and a user who
      // made both should be told both rather than sent back twice.
      if (character && defendant && character.id === defendant.id && side === "against") {
        fail(
          "defendant_prosecuting",
          "advocates",
          `${character.name} is the accused. The accused may answer the charge from the ` +
            "defence, but nobody prosecutes themselves — move them to the defence or leave " +
            "them out of the casting.",
        );
      }

      if (character && side) cast.push({ character, side });
    }

    // gate: on a broken cast the split arithmetic would report a second, derived failure
    // for the same mistake, so it is only checked once the roster itself is sound.
    if (castIsClean) {
      const forCount = cast.filter((advocate) => advocate.side === "for").length;
      const againstCount = cast.length - forCount;
      if (forCount !== SEATS_PER_SIDE || againstCount !== SEATS_PER_SIDE) {
        // specs.md Part 4's second invalid case: a three-to-one split.
        fail(
          "split_not_two_two",
          "advocates",
          "The split must be exactly two defending and two prosecuting. This casting is " +
            `${forCount} ${SIDE_LABEL.for} and ${againstCount} ${SIDE_LABEL.against}.`,
        );
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
