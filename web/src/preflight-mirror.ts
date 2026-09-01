/**
 * The client's mirror of `server/src/preflight.ts`.
 *
 * **It exists for the feedback, not for the check.** The server runs the real pre-flight
 * on every run and refuses an invalid one before a single model call (specs.md Parts 1
 * and 4); that is unchanged and untouchable, and Part 5's invalid-split pitfall is still
 * provable by posting straight to the API. What this adds is that a user finds out while
 * typing rather than after pressing Run — which matters here more than usual, because the
 * cheapest thing this app can waste is one of ~50 rationed free requests a day.
 *
 * **It mirrors by reading the rules, not by remembering them.** The word bounds, the
 * names each defendant is searched for, and the stems that read as an accusation all
 * arrive from `/api/health`, so there is no second copy of the rules here to drift out of
 * step with the server's. What is duplicated is only the three test functions below, and
 * each is written to match its counterpart exactly — the regex included.
 *
 * Where the two ever disagree, the server wins and the user sees its message.
 */

import type { Character, PreflightRules, Side } from "./api.js";

/** Same as the server's: whitespace-separated, empties dropped. */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word and case-insensitive, exactly as the server matches. */
export function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}([^\\p{L}]|$)`, "iu").test(text);
}

/** A question mark passes on its own; otherwise a whole word must start with a cue. */
export function looksLikeACharge(text: string, cues: readonly string[]): boolean {
  if (text.includes("?")) return true;
  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return tokens.some((token) => cues.some((cue) => token.startsWith(cue)));
}

/**
 * A line in the pre-flight panel. `pending` is a third state and not a soft failure: a
 * check that cannot be answered yet — no defendant chosen, no sheet written — should not
 * be shown as something the user got wrong.
 */
export type CheckStatus = "pass" | "fail" | "pending";

export interface Check {
  readonly id: string;
  readonly status: CheckStatus;
  readonly text: string;
}

export interface SetupDraft {
  readonly chargeSheet: string;
  readonly defendantId: string | null;
  /** Per character id, the side it has been pushed to. `null` is still unassigned. */
  readonly sides: Readonly<Record<string, Side | null>>;
}

/** The names the charge sheet will be searched for, per the server's own list. */
export function searchedNamesFor(
  character: Character | undefined,
  rules: PreflightRules,
): readonly string[] {
  if (!character) return [];
  return rules.searchedNames[character.id] ?? [character.name];
}

function quote(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(", ");
}

/**
 * The charge sheet's length, as the counter and the meter under it need it.
 *
 * The floor is as real as the ceiling — a one-word sheet can name the defendant and pass
 * every other check while leaving the advocates nothing to argue from but invention.
 */
export function lengthState(
  chargeSheet: string,
  rules: PreflightRules,
): { words: number; status: CheckStatus; message: string | null } {
  const words = countWords(chargeSheet);
  if (words === 0) {
    return { words, status: "pending", message: null };
  }
  if (words < rules.minChargeSheetWords) {
    return {
      words,
      status: "fail",
      message:
        `${rules.minChargeSheetWords - words} more ${
          rules.minChargeSheetWords - words === 1 ? "word" : "words"
        } at least — four advocates and three judges argue from this text alone.`,
    };
  }
  if (words > rules.maxChargeSheetWords) {
    return {
      words,
      status: "fail",
      message: `${words - rules.maxChargeSheetWords} over the ${
        rules.maxChargeSheetWords
      }-word limit. Cut them and the tribunal can open.`,
    };
  }
  return { words, status: "pass", message: null };
}

/**
 * The server's fence, mirrored. `server/src/fence.ts` owns the markers that separate the
 * charge sheet from the instructions around it, and a line that reads as one would close
 * the fence early — so the server refuses it (`charge_sheet_forges_marker`).
 *
 * Duplicated here for the same reason the three checks above are, and held against the
 * server by the same test: a screen that says a sheet is fine while the server refuses it
 * costs the user a press of a button they were told was safe.
 *
 * Line-anchored, exactly as the server is: a marker only means anything on a line of its
 * own, and matching mid-line would fail a sheet that merely mentions the end of a document.
 */
export function forgedMarkerLine(text: string): { line: number; text: string } | null {
  // Split on the newline alone and trim: a trailing carriage return is whitespace, so trim
  // takes it, and the server reaches the same lines either way.
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (
      trimmed.startsWith(">>>") ||
      trimmed.startsWith("<<<") ||
      /^-{2,}\s*STATEMENT\b/i.test(trimmed)
    ) {
      return { line: index + 1, text: trimmed };
    }
  }
  return null;
}

/**
 * The four lines of the pre-flight panel, in the order the canvas draws them.
 *
 * The split is the fourth, and on this screen it is always pending: it is what the next
 * screen is for. Saying so is better than omitting it, because the user should know
 * before pressing anything that casting is still owed.
 */
export function setupChecks(
  draft: SetupDraft,
  rules: PreflightRules,
  characters: readonly Character[],
): readonly Check[] {
  const defendant = characters.find((character) => character.id === draft.defendantId);
  const sheet = draft.chargeSheet.trim();
  const words = countWords(sheet);
  const searched = searchedNamesFor(defendant, rules);

  const roster: Check = defendant
    ? {
        id: "roster",
        status: "pass",
        text: `${defendant.name} is one of the five characters in this story.`,
      }
    : {
        id: "roster",
        status: "pending",
        text: "The defendant is one of the five characters in this story — choose one.",
      };

  const named: Check =
    !defendant || words === 0
      ? {
          id: "named",
          status: "pending",
          text: "The sheet names the defendant.",
        }
      : searched.some((name) => mentions(sheet, name))
        ? {
            id: "named",
            status: "pass",
            text: `The sheet names the defendant — searched ${quote(searched)}.`,
          }
        : {
            id: "named",
            status: "fail",
            text:
              `The sheet never names ${defendant.name}. Searched ${quote(searched)} — given ` +
              `names only, because shared surnames would match the wrong character.`,
          };

  const charge: Check =
    words < rules.minChargeSheetWords
      ? {
          id: "charge",
          status: "pending",
          text: "The sheet states a charge, or asks the tribunal a question.",
        }
      : looksLikeACharge(sheet, rules.chargeCues)
        ? {
            id: "charge",
            status: "pass",
            text: "The sheet states a charge and asks the tribunal a question.",
          }
        : {
            id: "charge",
            status: "fail",
            text:
              "The sheet doesn't say what the defendant is accused of. Name the act and the " +
              "charge, or write the question the tribunal has to answer — the advocates are " +
              "not allowed to invent it.",
          };

  const split: Check = {
    id: "split",
    status: "pending",
    text: "Two for and two against, four of the five — set on the next screen.",
  };

  /**
   * Appended only when it fails. Every other check is a standing criterion worth showing
   * as it is answered; this one is an exceptional fault nobody trips on an ordinary case,
   * and a permanent row reading "no line reads as a marker" would be noise on every run.
   */
  const forged = words > 0 ? forgedMarkerLine(sheet) : null;
  const marker: Check | null = forged
    ? {
        id: "marker",
        status: "fail",
        text:
          `Line ${forged.line} reads as one of the tribunal's own markers: "${forged.text}". ` +
          "That is how each model is told where your text stops and its instructions begin, " +
          "so it would be read as an instruction rather than as evidence. Reword it.",
      }
    : null;

  return marker ? [roster, named, charge, marker, split] : [roster, named, charge, split];
}

/** Everything the Setup screen can answer. The casting is the next screen's business. */
export function chargeIsReady(
  draft: SetupDraft,
  rules: PreflightRules,
  characters: readonly Character[],
): boolean {
  const length = lengthState(draft.chargeSheet, rules);
  if (length.status !== "pass") return false;
  return setupChecks(draft, rules, characters)
    .filter((check) => check.id !== "split")
    .every((check) => check.status === "pass");
}

/** Four seats, two a side — the server's `ADVOCATE_SEATS` and `SEATS_PER_SIDE`. */
export const ADVOCATE_SEATS = 4;
export const SEATS_PER_SIDE = 2;

/**
 * Everyone the user may cast: all five, the accused included.
 *
 * The accused is castable because specs.md Part 1 lets them answer the charge from a
 * defence seat. Four of the five are then cast and one sits the case out, which is why
 * this returns the whole roster rather than "everyone else".
 */
export function castableCharacters(characters: readonly Character[]): readonly Character[] {
  return characters;
}

/** Whether this character may be pushed to this side at all. */
export function sideIsOpenTo(
  characterId: string,
  side: Side,
  defendantId: string | null,
): boolean {
  // Nobody prosecutes themselves. The screen makes it unreachable; the server checks it
  // anyway, and its `defendant_prosecuting` refusal is the one that decides.
  return !(side === "against" && characterId === defendantId);
}

export function countSide(draft: SetupDraft, side: Side): number {
  return Object.values(draft.sides).filter((value) => value === side).length;
}

/**
 * Whether the casting is complete: exactly two defending and two prosecuting, drawn from
 * the roster, with the accused nowhere near the prosecution. One character is left in the
 * middle by construction, so "nobody uncast" is no longer the test — "every seat filled"
 * is. The server checks all of it again and independently.
 */
export function castingIsReady(
  draft: SetupDraft,
  castable: readonly Character[],
  defendantId: string | null,
): boolean {
  if (castable.length < ADVOCATE_SEATS) return false;
  for (const character of castable) {
    const side = draft.sides[character.id];
    if (side && !sideIsOpenTo(character.id, side, defendantId)) return false;
  }
  return (
    countSide(draft, "for") === SEATS_PER_SIDE && countSide(draft, "against") === SEATS_PER_SIDE
  );
}
