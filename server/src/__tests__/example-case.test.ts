/**
 * The setup screen's example charge sheet, held against the canonical one.
 *
 * **Why this test exists.** specs.md Part 4 commits one known case — T-001, The Realm v.
 * Jon Snow — and says to check the finished build against it by hand. The way that check
 * actually gets run is the setup screen's "load the example" button, so the text behind
 * that button *is* the validation case in practice. Two copies of it exist: this suite's
 * `PART_4_CHARGE_SHEET`, which every server test builds its records from, and the
 * browser's `EXAMPLE_CASE`, which the button loads.
 *
 * Written independently, they were previously held together only by a comment claiming
 * they matched. A drifted copy would not announce itself: the app would still run, the
 * pre-flight would still pass, and the by-hand validation would quietly be checking the
 * build against a charge sheet Part 4 never named — a run that looks like the validation
 * case and is not one. That is the same class of defect as the export drifting from the
 * panels, and it is caught the same way, by a check rather than by care.
 *
 * It lives in the server suite for the reason the pre-flight mirror does: the comparison
 * belongs where the authority is, and the web workspace's runner has no reason to reach
 * for a server fixture.
 */

import { describe, expect, it } from "vitest";

import { MAX_CHARGE_SHEET_WORDS, MIN_CHARGE_SHEET_WORDS } from "../preflight.js";
import { PART_4_CHARGE_SHEET } from "./preflight-cases.js";

// The browser's half. Reached across the workspace boundary on purpose: importing a copy
// would defeat the entire point of the test.
import { EXAMPLE_CASE } from "../../../web/src/example-case.js";

describe("the setup screen's example case", () => {
  it("is Part 4's canonical charge sheet, word for word", () => {
    expect(EXAMPLE_CASE.chargeSheet).toBe(PART_4_CHARGE_SHEET);
  });

  it("names Jon Snow as the defendant, as Part 4's case does", () => {
    expect(EXAMPLE_CASE.defendantId).toBe("jon-snow");
  });

  it("fits the charge sheet's own bounds, so the button never loads a refusable case", () => {
    const words = EXAMPLE_CASE.chargeSheet.trim().split(/\s+/u).length;
    expect(words).toBeGreaterThanOrEqual(MIN_CHARGE_SHEET_WORDS);
    expect(words).toBeLessThanOrEqual(MAX_CHARGE_SHEET_WORDS);
  });
});
