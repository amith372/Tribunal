/**
 * The setup screens accept exactly the drafts this server accepts.
 *
 * **What this used to be, and why it shrank.** `web/src/setup-checks.ts` was
 * `preflight-mirror.ts`: it re-implemented the pre-flight's three predicates, and this file
 * ran the whole `PREFLIGHT_CASES` catalogue through both copies to prove they still agreed.
 * They are imported now, so that half of the comparison is a tautology and is gone — along
 * with the word-counter assertion, which compared `countWords` against itself the moment
 * the two became one function.
 *
 * **What is left is not a tautology, and that is why the file survives.** The screen still
 * assembles its own answer out of those predicates — pass, fail and the *pending* third
 * state — and it still re-expresses the casting rules independently: four seats, two a
 * side, and the accused never on the side that accuses them. None of that is shared code,
 * so the screen can still drift into accepting a draft the server refuses.
 *
 * That failure is quiet and one-directional in the worst way: **a screen that lies
 * encouragingly is worse than one that says nothing** — the user presses a button they were
 * told was safe and pays seven requests to be told otherwise. The catalogue is the cheapest
 * way to keep proving it cannot.
 *
 * It stays in the server's suite because the server is the authority and the comparison
 * belongs where the authority is. (The web workspace does have a runner now — it holds what
 * is genuinely the browser's — but a test living beside only one of the two halves cannot
 * check that they agree.)
 *
 * **What it does not claim.** The screen is a preview and never a decision. Nothing here
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
  type SetupDraft,
} from "../../../web/src/setup-checks.js";

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

describe("the setup screens accept exactly what the server's pre-flight accepts", () => {
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

});
