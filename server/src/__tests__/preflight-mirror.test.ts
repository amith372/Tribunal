/**
 * The browser's copy of the pre-flight rules, held against this server's.
 *
 * **Why this test exists.** `web/src/preflight-mirror.ts` re-implements the pre-flight's
 * checks so the setup screens can answer them while the user types — which matters here
 * more than it usually would, because the daily allowance is rationed in *requests*, and a
 * refusal caught before the button costs nothing while one caught after it costs a run.
 * The mirror reads the *values* from `/api/health` so there is no second copy of the word
 * bounds, the searched names or the charge cues. What it necessarily does duplicate is the
 * three functions that apply them, regex included.
 *
 * Duplicated logic drifts. When it does, the failure is quiet and one-directional in the
 * worst way: the screen goes on saying a charge sheet is fine while the server refuses it,
 * and **a screen that lies encouragingly is worse than one that says nothing** — the user
 * presses a button they were told was safe and pays seven requests to be told otherwise.
 *
 * So this runs the whole `PREFLIGHT_CASES` catalogue through both, and asserts they reach
 * the same answer. It lives in the server suite rather than the web one for the reason that
 * matters: the server is the authority, so the comparison belongs where the authority is —
 * and the web workspace has no test runner.
 *
 * **What it does not claim.** The mirror is a preview and never a decision. Nothing here
 * relaxes the rule that `POST /api/run` re-runs the real pre-flight on every run and
 * refuses an invalid one before a single model call; specs.md Part 5's invalid-split
 * pitfall is still provable by posting straight to the API with no browser involved.
 */

import { describe, expect, it } from "vitest";

import { loadData } from "../data.js";
import {
  CHARGE_CUES,
  MAX_CHARGE_SHEET_WORDS,
  MIN_CHARGE_SHEET_WORDS,
  preflight,
  SEARCHED_NAMES,
  type PreflightInput,
} from "../preflight.js";
import { PREFLIGHT_CASES } from "./preflight-cases.js";

// The browser's half. Reached across the workspace boundary on purpose: importing a copy
// would defeat the entire point of the test.
import type { Character, PreflightRules, Side } from "../../../web/src/api.js";
import {
  castableCharacters,
  castingIsReady,
  chargeIsReady,
  countWords,
  type SetupDraft,
} from "../../../web/src/preflight-mirror.js";

const data = loadData();

/**
 * Exactly the object `/api/health` serves. Built from the server's own constants, so a
 * rule changed in `preflight.ts` arrives here the same way it arrives in the browser.
 */
const RULES: PreflightRules = {
  minChargeSheetWords: MIN_CHARGE_SHEET_WORDS,
  maxChargeSheetWords: MAX_CHARGE_SHEET_WORDS,
  searchedNames: SEARCHED_NAMES,
  chargeCues: CHARGE_CUES,
};

/** Exactly the roster `/api/health` serves. */
const CHARACTERS: readonly Character[] = data.characters.map((character) => ({
  id: character.id,
  name: character.name,
  description: character.description,
}));

/**
 * A case as the setup screens would hold it, or `null` for one no screen could produce.
 *
 * The catalogue's inputs are all `unknown`, because the endpoint trusts nothing — but two
 * of the cases are deliberately malformed payloads that exist to prove the *server* does
 * not crash on them. There is no draft a screen could be in that corresponds to those, so
 * they are checked on the server side only rather than compared against a fiction.
 */
function asDraft(input: PreflightInput): SetupDraft | null {
  if (typeof input.chargeSheet !== "string") return null;
  if (input.defendant !== undefined && typeof input.defendant !== "string") return null;

  const sides: Record<string, Side | null> = {};
  if (input.advocates !== undefined) {
    if (!Array.isArray(input.advocates)) return null;
    for (const entry of input.advocates) {
      if (entry === null || typeof entry !== "object") return null;
      const row = entry as { id?: unknown; side?: unknown };
      if (typeof row.id !== "string") return null;
      // A side the screen could not express becomes "still in the middle", which is what
      // an unplaced card is — the track has no third state to put an invalid one in.
      sides[row.id] = row.side === "for" || row.side === "against" ? row.side : null;
    }
  }

  return {
    chargeSheet: input.chargeSheet,
    defendantId: typeof input.defendant === "string" ? input.defendant : null,
    sides,
  };
}

/** Whether the screens would let this draft reach a Run button that is not disabled. */
function screenAccepts(draft: SetupDraft): boolean {
  const castable = castableCharacters(CHARACTERS);
  // Both halves, because the two setup screens each own one: Setup answers the charge
  // sheet and the defendant, Side Select answers the split — which now includes whether
  // the accused ended up on the side that accuses them.
  return (
    chargeIsReady(draft, RULES, CHARACTERS) &&
    castingIsReady(draft, castable, draft.defendantId)
  );
}

describe("the browser's pre-flight mirror agrees with the server's pre-flight", () => {
  for (const testCase of PREFLIGHT_CASES) {
    const draft = asDraft(testCase.input);

    if (draft === null) {
      it(`${testCase.id}: malformed payload — server-only, no draft to compare`, () => {
        // It still has to be refused. It just cannot be refused by a screen, because no
        // screen can produce it: reaching this endpoint took a hand-written request.
        expect(preflight(testCase.input, data).ok).toBe(false);
      });
      continue;
    }

    it(`${testCase.id}: ${testCase.title}`, () => {
      const server = preflight(testCase.input, data);
      const screen = screenAccepts(draft);

      // The two directions fail differently and both matter.
      //
      //   · server passes, screen blocks  → the app refuses work the tribunal would take,
      //     and the user has no way to find out why.
      //   · server fails, screen accepts  → the app encourages a case that will be refused,
      //     and the user pays a request to learn it. This is the expensive one.
      expect(screen).toBe(server.ok);
    });
  }

  /**
   * The word counters, compared directly rather than through a verdict.
   *
   * `chargeSheetWords` is the number the server puts in the run record and the export, and
   * the counter under the textarea is what the user watched while writing. Those two
   * disagreeing by one word at exactly 200 is the whole failure this guards.
   */
  it("counts the same words the server counts, on every valid case", () => {
    for (const testCase of PREFLIGHT_CASES) {
      const result = preflight(testCase.input, data);
      if (!result.ok) continue;
      expect(countWords(result.run.chargeSheet)).toBe(result.run.chargeSheetWords);
    }
  });
});
