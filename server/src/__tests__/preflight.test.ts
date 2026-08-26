/**
 * The pre-flight is what stands between a bad setup and seven model calls (specs.md
 * Part 1, and Part 2: "an invalid setup is refused with a message and zero calls
 * spent"). These tests are therefore as much about the *messages* as the verdicts —
 * a refusal the user cannot act on is a failed refusal.
 *
 * No API key and no network: this stage makes no model calls at all.
 */

import { describe, expect, it } from "vitest";
import { loadData } from "../data.js";
import {
  MAX_CHARGE_SHEET_WORDS,
  MIN_CHARGE_SHEET_WORDS,
  SEARCHED_NAMES,
  preflight,
  type PreflightInput,
} from "../preflight.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET, PREFLIGHT_CASES } from "./preflight-cases.js";

const data = loadData();
const check = (input: PreflightInput) => preflight(input, data);

describe("the case catalogue", () => {
  // The same list the printed table walks, so the table can never claim a rule the
  // tests do not hold to.
  for (const testCase of PREFLIGHT_CASES) {
    it(`${testCase.id}: ${testCase.title}`, () => {
      const result = check(testCase.input);
      if (testCase.expect === "pass") {
        expect(result.failures.map((failure) => failure.message)).toEqual([]);
        expect(result.ok).toBe(true);
      } else {
        expect(result.failures.map((failure) => failure.code)).toEqual(testCase.expect);
        expect(result.ok).toBe(false);
        expect(result.run).toBeNull();
      }
    });
  }

  it("covers all three of Part 4's invalid cases and its valid one", () => {
    const ids = PREFLIGHT_CASES.map((testCase) => testCase.id);
    expect(ids).toContain("part4-valid");
    expect(ids).toContain("part4-defendant-not-in-story");
    expect(ids).toContain("part4-three-one-split");
    expect(ids).toContain("part4-defendant-not-named");
  });
});

describe("a passing run", () => {
  const result = check({
    chargeSheet: `\n  ${PART_4_CHARGE_SHEET}  \n`,
    defendant: "jon-snow",
    advocates: PART_4_CAST,
  });

  it("hands back the run, normalised", () => {
    expect(result.ok).toBe(true);
    expect(result.run?.chargeSheet).toBe(PART_4_CHARGE_SHEET);
    expect(result.run?.defendant.name).toBe("Jon Snow");
    expect(result.run?.chargeSheetWords).toBe(PART_4_CHARGE_SHEET.split(/\s+/).length);
  });

  it("carries the cast as two defending and two prosecuting", () => {
    const forSide = result.run?.advocates.filter((advocate) => advocate.side === "for") ?? [];
    const againstSide = result.run?.advocates.filter((advocate) => advocate.side === "against") ?? [];
    expect(forSide.map((advocate) => advocate.character.id)).toEqual(["jon-snow", "tyrion"]);
    expect(againstSide.map((advocate) => advocate.character.id)).toEqual(["daenerys", "grey-worm"]);
  });

  it("seats four of the five, leaving one character out of the case", () => {
    // Four seats drawn from five, so a passing run always has exactly one character
    // uncast. Cersei is the one who sits out Part 4's canonical casting.
    const ids = result.run?.advocates.map((advocate) => advocate.character.id) ?? [];
    expect(ids).toHaveLength(4);
    const uncast = data.characters.filter((character) => !ids.includes(character.id));
    expect(uncast.map((character) => character.id)).toEqual(["cersei"]);
  });

  it("lets the accused hold a defence seat and never a prosecution one", () => {
    // Part 1, restated as an assertion on the output rather than the input: the accused
    // answering the charge is the canonical casting, so the check is not "absent" but
    // "never on the side that accuses them".
    const defendantId = result.run?.defendant.id;
    const asAdvocate = result.run?.advocates.find(
      (advocate) => advocate.character.id === defendantId,
    );
    expect(asAdvocate?.side).toBe("for");

    const prosecuting = check({
      chargeSheet: PART_4_CHARGE_SHEET,
      defendant: "jon-snow",
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "cersei", side: "for" },
        { id: "jon-snow", side: "against" },
        { id: "grey-worm", side: "against" },
      ],
    });
    expect(prosecuting.failures.map((failure) => failure.code)).toEqual(["defendant_prosecuting"]);
    expect(prosecuting.run).toBeNull();
  });
});

describe("the messages", () => {
  it("name every searched-for name when the defendant is not in the charge sheet", () => {
    // Part 2: the refusal "states which names were searched for, so the user can see why
    // it failed rather than guess".
    const result = check({
      chargeSheet:
        "Someone burned a city to ash and answered for none of it. Was that murder or war?",
      defendant: "grey-worm",
      advocates: [
        { id: "jon-snow", side: "for" },
        { id: "tyrion", side: "for" },
        { id: "daenerys", side: "against" },
        { id: "cersei", side: "against" },
      ],
    });
    const message = result.failures[0]?.message ?? "";
    expect(result.failures.map((failure) => failure.code)).toEqual(["defendant_not_named"]);
    expect(message).toContain("Grey Worm");
    for (const name of SEARCHED_NAMES["grey-worm"] ?? []) {
      expect(message).toContain(`"${name}"`);
    }
  });

  it("list the five characters when an unknown defendant is chosen", () => {
    const message = check({ ...validSetup(), defendant: "gandalf" }).failures[0]?.message ?? "";
    for (const character of data.characters) expect(message).toContain(character.name);
  });

  it("say what the split actually was", () => {
    const message = check({
      ...validSetup(),
      advocates: [
        { id: "tyrion", side: "for" },
        { id: "cersei", side: "for" },
        { id: "daenerys", side: "for" },
        { id: "grey-worm", side: "against" },
      ],
    }).failures[0]?.message;
    expect(message).toContain("3 defending and 1 prosecuting");
  });

  it("give both limits a real number the user can act on", () => {
    const short = check({ ...validSetup(), chargeSheet: "Jon killed her." }).failures[0]?.message ?? "";
    expect(short).toContain("3 words");
    expect(short).toContain(`${MIN_CHARGE_SHEET_WORDS}`);

    const long = check({
      ...validSetup(),
      chargeSheet: `Jon Snow is charged with treason. ${"sworn ".repeat(300)}`,
    }).failures[0]?.message ?? "";
    expect(long).toContain(`${MAX_CHARGE_SHEET_WORDS}`);
    expect(long).toContain("Cut 6");
  });

  it("are never empty, and every failure names a field to return to", () => {
    for (const testCase of PREFLIGHT_CASES) {
      for (const failure of check(testCase.input).failures) {
        expect(failure.message.length).toBeGreaterThan(30);
        expect(["chargeSheet", "defendant", "advocates"]).toContain(failure.field);
      }
    }
  });
});

describe("never throwing", () => {
  // The input arrives off the network. A throw here would become a 500 and lose the
  // reasons the user needs, so every hostile shape must come back as failures.
  const hostile: unknown[] = [
    {},
    { chargeSheet: null, defendant: undefined, advocates: null },
    { chargeSheet: [], defendant: {}, advocates: [null, null, null, null] },
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: [1, 2, 3, 4] },
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: 7, advocates: [{}, {}, {}, {}] },
    { chargeSheet: "a".repeat(50_000), defendant: "jon-snow", advocates: PART_4_CAST },
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST.slice(0, 1) },
  ];

  for (const [index, input] of hostile.entries()) {
    it(`refuses hostile input ${index + 1} instead of throwing`, () => {
      const result = preflight(input as PreflightInput, data);
      expect(result.ok).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.run).toBeNull();
    });
  }

  it("treats a defendant id with regex characters as a plain string", () => {
    const result = check({ ...validSetup(), defendant: "jon-snow|.*" });
    expect(result.failures.map((failure) => failure.code)).toEqual(["defendant_unknown"]);
  });
});

describe("the searched-for names", () => {
  it("are listed explicitly for all five characters", () => {
    // Without an entry a character silently falls back to its display name, which for
    // "Grey Worm" or a nickname-only charge sheet would quietly change the rule.
    for (const character of data.characters) {
      expect(SEARCHED_NAMES[character.id]).toBeDefined();
      expect(SEARCHED_NAMES[character.id]?.length).toBeGreaterThan(0);
    }
  });

  it("contain no surname, because surnames are shared", () => {
    const surnames = ["Lannister", "Targaryen", "Snow", "Stark"];
    for (const names of Object.values(SEARCHED_NAMES)) {
      for (const name of names) {
        for (const surname of surnames) {
          if (name === "Jon Snow") continue; // the full name, not the surname alone
          expect(name).not.toBe(surname);
        }
      }
    }
  });
});

function validSetup(): PreflightInput {
  return {
    chargeSheet: PART_4_CHARGE_SHEET,
    defendant: "jon-snow",
    advocates: PART_4_CAST,
  };
}
