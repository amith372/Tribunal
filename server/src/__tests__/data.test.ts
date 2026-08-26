/**
 * The data files are the only source of character facts (specs.md Part 1) and are
 * hand-edited, so these tests are as much a guard on the files as on the parser.
 */

import { describe, expect, it } from "vitest";
import { DataError, loadData } from "../data.js";

const data = loadData();

describe("characters", () => {
  it("are exactly five", () => {
    // The two-for/two-against split assumes five; a sixth would break casting silently.
    expect(data.characters).toHaveLength(5);
  });

  it("carry the ids the rest of the app looks up", () => {
    expect(data.characters.map((c) => c.id).sort()).toEqual([
      "cersei",
      "daenerys",
      "grey-worm",
      "jon-snow",
      "tyrion",
    ]);
  });

  it("each have a name and a non-empty description", () => {
    for (const character of data.characters) {
      expect(character.name.length).toBeGreaterThan(0);
      expect(character.description.length).toBeGreaterThan(20);
    }
  });
});

describe("judges", () => {
  it("are exactly three", () => {
    expect(data.judges).toHaveLength(3);
  });

  it("are the three named justices, each with a persona", () => {
    expect(data.judges.map((j) => j.id).sort()).toEqual(["barak", "elon", "shamgar"]);
    for (const judge of data.judges) expect(judge.persona.length).toBeGreaterThan(20);
  });
});

describe("relations", () => {
  it("cover every pair of characters exactly once", () => {
    // Five characters make ten unordered pairs; every advocate prompt needs the one
    // linking that advocate to the defendant.
    expect(data.relations).toHaveLength(10);
  });

  it("are found whichever way round they are queried", () => {
    // Entries are `a ↔ b`: mutual, so lookup must be order-independent.
    const forward = data.getRelation("jon-snow", "cersei");
    const backward = data.getRelation("cersei", "jon-snow");
    expect(forward).toBeDefined();
    expect(backward).toEqual(forward);
  });

  it("return nothing for a pair that does not exist", () => {
    expect(data.getRelation("jon-snow", "barak")).toBeUndefined();
  });

  it("describe standing relationships, not the charge", () => {
    // specs.md Part 1: these files describe standing relationships, the charge sheet
    // supplies what happened. A relation that narrates the alleged act would decide
    // the trial before it runs.
    const jonAndDany = data.getRelation("jon-snow", "daenerys");
    expect(jonAndDany?.text).not.toMatch(/killing her|assassinat|murder/i);
  });
});

describe("lookups", () => {
  it("find a character and a judge by id", () => {
    expect(data.getCharacter("tyrion")?.name).toBe("Tyrion Lannister");
    expect(data.getJudge("barak")?.name).toBe("Aharon Barak");
  });

  it("return nothing for an id that is not in the story", () => {
    // The pre-flight leans on this in Stage 2: a defendant who is not a character.
    expect(data.getCharacter("gandalf")).toBeUndefined();
  });
});

describe("avatar asset keys", () => {
  it("map the two ids whose art is named differently", () => {
    expect(data.assetKey("jon-snow")).toBe("jon");
    expect(data.assetKey("grey-worm")).toBe("worm");
  });

  it("pass the other three through unchanged", () => {
    expect(data.assetKey("daenerys")).toBe("daenerys");
    expect(data.assetKey("tyrion")).toBe("tyrion");
    expect(data.assetKey("cersei")).toBe("cersei");
  });

  it("throw rather than guess a filename", () => {
    expect(() => data.assetKey("gandalf")).toThrow(DataError);
  });
});

describe("failing loudly", () => {
  it("names the directory it could not read", () => {
    expect(() => loadData("D:/no/such/place")).toThrow(DataError);
    expect(() => loadData("D:/no/such/place")).toThrow(/characters\.md/);
  });
});
