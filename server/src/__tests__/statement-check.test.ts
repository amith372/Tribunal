/**
 * The screen an advocate's reply passes before it becomes a statement.
 *
 * The risk this module carries is not that it misses something — it is that it refuses
 * a *real* statement, which costs a genuine argument and a call out of a rationed
 * daily allowance. So the negative controls come first and are weighted heaviest, and
 * one of them is the actual reply a free model produced on 2026-08-21.
 */

import { describe, expect, it } from "vitest";
import { checkStatement } from "../statement-check.js";

/** The real thing, from `nemotron-3-nano-30b-a3b:free` at a 1200-token ceiling. */
const REAL_STATEMENT =
  "Your Grace, the Crown, esteemed judges—I stand before you not to boast but to " +
  "clarify. I, Tyrion Lannister, counsel for Jon Snow, submit that the accused acted " +
  "not out of malice but out of duty. Daenerys, consumed by unchecked ambition, " +
  "threatened the very realm we cherish. Jon's choice to end her life was a desperate " +
  "act to preserve countless innocent lives. To condemn him for stopping a tyrant " +
  "would set a perilous precedent: that those who wield power may never be questioned. " +
  "I ask you to see the larger truth—justice demands mercy, not execution, for a man " +
  "who sacrificed himself to save Westeros.";

/** The real failure, from the same model at a 220-token ceiling. */
const REAL_META =
  "The user wants a character statement for defense as Tyrion Lannister, first " +
  "person, at most 120 words. Must argue defense: Jon Snow assassinated Daenerys " +
  "Targrangle for regicide?? Actually she was tyrannical. Provide defense arguments.";

describe("statements it must not refuse", () => {
  it("accepts the statement a free model actually produced", () => {
    expect(checkStatement(REAL_STATEMENT, "stop").usable).toBe(true);
  });

  it("accepts a statement that speaks in the first person about itself", () => {
    // "I", "let me be plain", "my lord" are how these characters talk. The screen has
    // no business touching voice.
    const text =
      "Let me be plain, my lords. I am Cersei Lannister, and I tell you the man acted " +
      "for the realm. I would say the same of no one else living.";
    expect(checkStatement(text, "stop").usable).toBe(true);
  });

  it("accepts a blunt one-sentence statement", () => {
    expect(checkStatement("He was sworn to her, and he killed her.", "stop").usable).toBe(true);
  });

  it("accepts a statement well over its word cap", () => {
    // Over-length is measured elsewhere and is not this module's business.
    const long = "He was sworn to her. ".repeat(40);
    expect(checkStatement(long, "stop").usable).toBe(true);
  });

  it("accepts a statement that names a number of years or people", () => {
    // Guards the word-limit pattern against matching ordinary numbers in prose.
    const text = "For 300 years the Targaryens held the throne, and 40 000 died for it.";
    expect(checkStatement(text, "stop").usable).toBe(true);
  });
});

describe("replies it must refuse", () => {
  it("refuses the meta-commentary a free model actually produced", () => {
    const check = checkStatement(REAL_META, "length");
    expect(check.usable).toBe(false);
    expect(check.problem).toBe("meta_commentary");
    expect(check.detail).toMatch(/user/i);
  });

  it("refuses an empty reply", () => {
    expect(checkStatement("   ", "stop")).toMatchObject({ usable: false, problem: "empty" });
  });

  it("refuses a reply that was cut off", () => {
    const check = checkStatement("I stand before you to say that the accused", "length");
    expect(check).toMatchObject({ usable: false, problem: "truncated" });
  });

  it("refuses reasoning tags and drafting narration", () => {
    expect(checkStatement("<think>what should I say</think> He is innocent.", "stop").problem).toBe(
      "meta_commentary",
    );
    expect(checkStatement("Let me draft about 100 words for this.", "stop").problem).toBe(
      "meta_commentary",
    );
  });

  it("reports meta-commentary ahead of truncation, as the more useful diagnosis", () => {
    // A reply full of the model's working that also ran out of budget is both. Saying
    // "it was cut off" would send someone to fix the ceiling, which is not the fault.
    expect(checkStatement(REAL_META, "length").problem).toBe("meta_commentary");
  });
});

describe("what it never does", () => {
  it("never returns edited text — it judges, it does not rewrite", () => {
    const check = checkStatement(REAL_META, "length");
    // The shape carries no text at all: trimming the working off the front and keeping
    // the rest would be the app writing part of the statement.
    expect(check).not.toHaveProperty("text");
    expect(Object.keys(check).sort()).toEqual(["detail", "problem", "usable"]);
  });
});
