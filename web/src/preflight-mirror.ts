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
    text: "Two for and two against — set on the next screen.",
  };

  return [roster, named, charge, split];
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

/** The four advocates: everyone who is not the defendant. */
export function advocatesOf(
  characters: readonly Character[],
  defendantId: string | null,
): readonly Character[] {
  return characters.filter((character) => character.id !== defendantId);
}

export function countSide(draft: SetupDraft, side: Side): number {
  return Object.values(draft.sides).filter((value) => value === side).length;
}

/**
 * Whether the casting is complete: exactly two defending and two prosecuting, and nobody
 * left in the middle. The server checks this again and independently.
 */
export function castingIsReady(draft: SetupDraft, advocates: readonly Character[]): boolean {
  if (advocates.length !== 4) return false;
  if (advocates.some((advocate) => !draft.sides[advocate.id])) return false;
  return countSide(draft, "for") === 2 && countSide(draft, "against") === 2;
}
