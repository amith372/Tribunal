/**
 * Panel navigation — the browser's own, and the only part of the old results model that
 * did not belong to the record.
 */

import { describe, expect, it } from "vitest";

import { stepPanel } from "./panel-nav.js";

describe("stepping between the five panels", () => {
  it("clamps rather than wrapping, so neither end runs round to the other", () => {
    expect(stepPanel(0, -1)).toBe(0);
    expect(stepPanel(0, 1)).toBe(1);
    expect(stepPanel(4, 1)).toBe(4);
    expect(stepPanel(2, -1)).toBe(1);
  });
});
