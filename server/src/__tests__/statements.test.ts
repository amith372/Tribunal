/**
 * The advocate wave. Zero model calls: the caller is a scripted fake.
 *
 * What matters here is not that a call works — that is `openrouter.ts`'s job — but what
 * happens when one does not. A gap is survivable and a silenced side is not, and the
 * difference between those two is the whole reason this module has a return type
 * instead of just an array of strings.
 */

import { describe, expect, it, vi } from "vitest";

import { getModelRegistry } from "../config.js";
import { loadData } from "../data.js";
import { preflight, type ValidRun } from "../preflight.js";
import { runStatements, toDeliveredStatements } from "../statements.js";
import { ADVOCATE_WORD_CAP } from "../prompts.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";
import { fakeResult, scriptedCaller } from "./fake-caller.js";
import type { CallOptions, CallResult } from "../openrouter.js";

const data = loadData();
const models = getModelRegistry().advocatePool;

function part4Run(): ValidRun {
  const result = preflight(
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
    data,
  );
  if (!result.ok) throw new Error("Part 4's case must pass pre-flight");
  return result.run;
}

const run = part4Run();

/** Part 4's casting: jon-snow (the accused) + tyrion defending, daenerys + grey-worm
 *  prosecuting. Cersei sits this case out. */
const ALL_FOUR = {
  "advocate:tyrion": ["The realm was already burning when he acted."],
  "advocate:jon-snow": ["I did it. I would tell you why, and then you may call it what you like."],
  "advocate:daenerys": ["He was sworn to me, and he came to me as a lover."],
  "advocate:grey-worm": ["He killed our queen. This is murder."],
};

const wave = (script: Record<string, readonly string[]>, extra = {}) => {
  const { call, calls } = scriptedCaller(script);
  return { calls, result: runStatements({ run, data, mode: "per-role", models, call, ...extra }) };
};

describe("a wave where all four advocates answer", () => {
  it("returns four statements, complete and unaborted", async () => {
    const { result } = wave(ALL_FOUR);
    const statements = await result;

    expect(statements.statements).toHaveLength(4);
    expect(statements.delivered).toHaveLength(4);
    expect(statements.complete).toBe(true);
    expect(statements.abort).toBeNull();
    expect(statements.statements.every((statement) => statement.ok)).toBe(true);
  });

  it("keeps casting order regardless of which model answered first", async () => {
    // Order is part of the run record; it should not depend on which free model was quick.
    const slowFirst = async (options: CallOptions): Promise<CallResult> => {
      const delay = options.label === "advocate:tyrion" ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fakeResult(options, `statement from ${options.label}`);
    };

    const statements = await runStatements({ run, data, mode: "per-role", models, call: slowFirst });
    expect(statements.statements.map((statement) => statement.advocateId)).toEqual([
      "jon-snow",
      "tyrion",
      "daenerys",
      "grey-worm",
    ]);
  });

  it("makes the four calls in parallel, not one after another", async () => {
    let inFlight = 0;
    let peak = 0;
    const call = async (options: CallOptions): Promise<CallResult> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return fakeResult(options, "a statement");
    };

    await runStatements({ run, data, mode: "per-role", models, call, staggerMs: 0,});
    expect(peak).toBe(4);
  });

  it("sends each advocate its own prompt and no one else's statement", async () => {
    const { calls, result } = wave(ALL_FOUR);
    await result;

    expect(calls).toHaveLength(4);
    for (const { options } of calls) {
      const body = options.messages.map((message) => message.content).join("\n");
      for (const statement of Object.values(ALL_FOUR).flat()) {
        expect(body).not.toContain(statement);
      }
    }
  });

  it("reports each statement as it lands, for the stream", async () => {
    const onStatement = vi.fn();
    const { call } = scriptedCaller(ALL_FOUR);
    await runStatements({ run, data, mode: "per-role", models, call, onStatement });
    expect(onStatement).toHaveBeenCalledTimes(4);
  });

  it("hands the judges the side and the text, and never the speaker", async () => {
    const { result } = wave(ALL_FOUR);
    const delivered = toDeliveredStatements(await result);

    expect(delivered.map((statement) => statement.side)).toEqual(["for", "for", "against", "against"]);
    for (const statement of delivered) {
      expect(Object.keys(statement).sort()).toEqual(["side", "text"]);
    }
  });

  it("keeps every attempt for the token table", async () => {
    const { result } = wave(ALL_FOUR);
    const statements = await result;
    expect(statements.attempts).toHaveLength(4);
    expect(statements.attempts.every((attempt) => attempt.usage.totalTokens === 510)).toBe(true);
  });
});

describe("a wave where an advocate fails", () => {
  it("leaves a gap and carries on, rather than throwing the run away", async () => {
    const { result } = wave({ ...ALL_FOUR, "advocate:jon-snow": ["server_error"] });
    const statements = await result;

    expect(statements.complete).toBe(false);
    expect(statements.abort).toBeNull();
    expect(statements.delivered).toHaveLength(3);

    const jon = statements.statements.find((statement) => statement.advocateId === "jon-snow")!;
    expect(jon.ok).toBe(false);
    expect(jon.text).toBeNull();
    expect(jon.errorKind).toBe("server_error");
    expect(jon.error).toContain("failed");
    // The failed attempt still cost tokens, so it still belongs in the table.
    expect(jon.attempts).toHaveLength(1);
  });

  it("still gives the surviving side both its advocates", async () => {
    const { result } = wave({ ...ALL_FOUR, "advocate:jon-snow": ["timeout"] });
    const delivered = toDeliveredStatements(await result);
    expect(delivered.filter((statement) => statement.side === "for")).toHaveLength(1);
    expect(delivered.filter((statement) => statement.side === "against")).toHaveLength(2);
  });
});

describe("a wave where a whole side is lost", () => {
  it("aborts when both advocates for one side failed", async () => {
    const { result } = wave({
      ...ALL_FOUR,
      "advocate:tyrion": ["timeout"],
      "advocate:jon-snow": ["server_error"],
    });
    const statements = await result;

    // Judges hearing only the prosecution would return a verdict that looks legitimate
    // and is structurally rigged.
    expect(statements.abort?.reason).toBe("side_silenced");
    expect(statements.abort?.message).toContain("defense");
    expect(statements.abort?.message).toContain("only one side");
    expect(statements.delivered).toHaveLength(2);
  });

  it("names the prosecution when it is the prosecution that was lost", async () => {
    const { result } = wave({
      ...ALL_FOUR,
      "advocate:daenerys": ["timeout"],
      "advocate:grey-worm": ["timeout"],
    });
    expect((await result).abort?.message).toContain("prosecution");
  });

  it("aborts when nothing at all arrived", async () => {
    const { result } = wave({
      "advocate:tyrion": ["timeout"],
      "advocate:jon-snow": ["timeout"],
      "advocate:daenerys": ["timeout"],
      "advocate:grey-worm": ["timeout"],
    });
    const statements = await result;
    expect(statements.abort?.reason).toBe("no_statements");
    expect(statements.delivered).toHaveLength(0);
  });
});

describe("over-length, which is measured and not yet acted on", () => {
  it("flags a statement over the cap without changing a word of it", async () => {
    // Derived from the cap, never hardcoded — the caps were raised on live evidence
    // on 2026-08-21 and a literal here would have to be chased every time.
    const over = ADVOCATE_WORD_CAP + 30;
    const long = Array.from({ length: over }, () => "word").join(" ");
    const { result } = wave({ ...ALL_FOUR, "advocate:tyrion": [long] });
    // Found by id rather than by position: the accused holds the first defence seat in
    // Part 4's casting, so index 0 is Jon and not Tyrion.
    const tyrion = (await result).statements.find(
      (statement) => statement.advocateId === "tyrion",
    )!;

    expect(tyrion.words).toBe(over);
    expect(tyrion.wordCap).toBe(ADVOCATE_WORD_CAP);
    expect(tyrion.overCap).toBe(true);
    expect(tyrion.text).toBe(long);
    expect(tyrion.ok).toBe(true);
  });

  it("accepts a short statement without complaint", async () => {
    // Grey Worm is "sparing with words, with no taste for rhetoric" — a 7-word statement
    // is the persona working, not a failed call. The cap is a maximum only.
    const { result } = wave({ ...ALL_FOUR, "advocate:grey-worm": ["He killed our queen. That is all."] });
    const greyWorm = (await result).statements[3];

    expect(greyWorm.ok).toBe(true);
    expect(greyWorm.overCap).toBe(false);
    expect(greyWorm.words).toBe(7);
  });
});

describe("a reply that is about the task rather than the case", () => {
  /** `wave` hands back the pending run; these tests only need the settled result. */
  const settled = (script: Record<string, readonly string[]>) => wave(script).result;

  const META =
    "The user wants a statement as Tyrion Lannister, first person, at most 120 words.";
  const GOOD = "I say the realm was already burning when he acted.";

  it("buys one more call, and the second reply stands if it is a statement", async () => {
    const result = await settled({ ...ALL_FOUR, "advocate:tyrion": [META, GOOD] });
    const tyrion = result.statements.find((s) => s.advocateId === "tyrion");

    expect(tyrion?.ok).toBe(true);
    expect(tyrion?.text).toBe(GOOD);
    expect(tyrion?.rescreened).toBe(true);
    expect(tyrion?.problem).toBeNull();
    // Both calls belong in the token table — the refused one really happened.
    expect(tyrion?.attempts.length).toBe(2);
    expect(result.complete).toBe(true);
  });

  it("asks a different model, not the one that just talked about the task", async () => {
    // A reply about the task is a tendency, not a formatting slip — measured live on
    // 2026-08-21, one model produced meta-commentary on both attempts of one call and
    // again in the next run. Re-asking it spends a rationed request to be told the
    // same thing.
    const chains: (readonly string[])[] = [];
    const call = async (options: CallOptions): Promise<CallResult> => {
      if (options.label !== "advocate:tyrion") return fakeResult(options, "a statement");
      chains.push(options.models);
      return fakeResult(options, chains.length === 1 ? META : GOOD);
    };

    const result = await runStatements({ run, data, mode: "per-role", models, call });
    expect(result.statements[0]?.ok).toBe(true);

    const [first, second] = chains;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The model that produced the refused reply is gone from the retry's chain.
    expect(second).not.toContain(first?.[0]);
    expect(second?.length).toBe((first?.length ?? 0) - 1);
  });

  it("marks the advocate failed when the second reply is no better", async () => {
    const result = await settled({ ...ALL_FOUR, "advocate:tyrion": [META, META] });
    const tyrion = result.statements.find((s) => s.advocateId === "tyrion");

    expect(tyrion?.ok).toBe(false);
    expect(tyrion?.problem).toBe("meta_commentary");
    // Never patched, never trimmed: no statement at all rather than a made-up one.
    expect(tyrion?.text).toBeNull();
    expect(tyrion?.error).toMatch(/user/i);
  });

  it("leaves the run incomplete but judgeable when only one advocate is refused", async () => {
    const result = await settled({ ...ALL_FOUR, "advocate:tyrion": [META, META] });

    expect(result.complete).toBe(false);
    expect(result.abort).toBeNull();
    expect(result.delivered).toHaveLength(3);
  });

  it("aborts when both advocates on one side are refused", async () => {
    const result = await settled({
      ...ALL_FOUR,
      "advocate:tyrion": [META, META],
      "advocate:jon-snow": [META, META],
    });

    expect(result.abort?.reason).toBe("side_silenced");
  });

  it("does not screen a statement merely for being in character", async () => {
    const inCharacter = "Let me be plain, my lords. I am Tyrion, and I say he acted for the realm.";
    const result = await settled({ ...ALL_FOUR, "advocate:tyrion": [inCharacter] });
    const tyrion = result.statements.find((s) => s.advocateId === "tyrion");

    expect(tyrion?.ok).toBe(true);
    expect(tyrion?.rescreened).toBe(false);
    expect(tyrion?.attempts.length).toBe(1);
  });
});
