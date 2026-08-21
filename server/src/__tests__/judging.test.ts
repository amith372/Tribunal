/**
 * The judging ladder. Zero model calls: the caller is a scripted fake.
 *
 * specs.md Part 5 sets three steps and no fourth — read the verdict from the text,
 * retry once, then mark it an error, and never invent one. These tests exist mostly to
 * pin down the two places a fourth step could sneak in: a retry that quietly changes a
 * verdict, and a failed judge that quietly becomes a verdict anyway.
 */

import { describe, expect, it, vi } from "vitest";

import { getModelRegistry } from "../config.js";
import { loadData } from "../data.js";
import { runJudging } from "../judging.js";
import { preflight, type ValidRun } from "../preflight.js";
import type { DeliveredStatement } from "../prompts.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";
import { scriptedCaller } from "./fake-caller.js";
import type { ErrorKind } from "../openrouter.js";

const data = loadData();
const models = getModelRegistry().judgePool;

function part4Run(): ValidRun {
  const result = preflight(
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
    data,
  );
  if (!result.ok) throw new Error("Part 4's case must pass pre-flight");
  return result.run;
}

const run = part4Run();

const statements: readonly DeliveredStatement[] = [
  { side: "for", text: "The realm was already burning." },
  { side: "for", text: "He did the one useful thing anyone did that day." },
  { side: "against", text: "He was sworn to her." },
  { side: "against", text: "He killed our queen." },
];

const GUILTY = '{"verdict": "guilty", "reasoning": "He swore an oath. He broke it himself."}';
const NOT_GUILTY =
  '{"verdict": "not_guilty", "reasoning": "Necessity was made out. No lawful means remained."}';

const bench = (script: Record<string, readonly (string | ErrorKind)[]>, extra = {}) => {
  const { call, calls } = scriptedCaller(script);
  return {
    calls,
    result: runJudging({ run, data, mode: "per-role", models, statements, call, ...extra }),
  };
};

const ALL_THREE = {
  "judge:barak": [NOT_GUILTY],
  "judge:beinisch": [GUILTY],
  "judge:shamgar": [NOT_GUILTY],
};

describe("a bench where every judge answers in the form asked for", () => {
  it("returns three verdicts in judge order, with no retries", async () => {
    const { calls, result } = bench(ALL_THREE);
    const judging = await result;

    expect(judging.judges.map((judge) => judge.judgeId)).toEqual(["barak", "beinisch", "shamgar"]);
    expect(judging.judges.map((judge) => judge.verdict)).toEqual([
      "not_guilty",
      "guilty",
      "not_guilty",
    ]);
    expect(judging.judges.every((judge) => judge.ok)).toBe(true);
    expect(judging.judges.every((judge) => judge.retryReason === null)).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("keeps the reasoning, the raw reply and every attempt", async () => {
    const judging = await bench(ALL_THREE).result;
    const barak = judging.judges[0]!;

    expect(barak.reasoning).toContain("Necessity was made out");
    expect(barak.rawText).toBe(NOT_GUILTY);
    expect(barak.route).toBe("json");
    expect(judging.attempts).toHaveLength(3);
  });

  it("runs the three judges in parallel", async () => {
    let inFlight = 0;
    let peak = 0;
    const { call } = scriptedCaller(ALL_THREE);
    const counting = async (options: Parameters<typeof call>[0]) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const result = await call(options);
      inFlight--;
      return result;
    };

    await runJudging({ run, data, mode: "per-role", models, statements, call: counting });
    expect(peak).toBe(3);
  });

  it("reports each verdict as it lands, for the stream", async () => {
    const onVerdict = vi.fn();
    const { call } = scriptedCaller(ALL_THREE);
    await runJudging({ run, data, mode: "per-role", models, statements, call, onVerdict });
    expect(onVerdict).toHaveBeenCalledTimes(3);
  });
});

describe("a reply that could not be read", () => {
  it("asks once more at temperature 0 and keeps the second answer", async () => {
    const { calls, result } = bench({
      ...ALL_THREE,
      "judge:barak": ["Both sides argued well and the record is thin.", GUILTY],
    });
    const barak = (await result).judges[0]!;

    expect(barak.verdict).toBe("guilty");
    expect(barak.ok).toBe(true);
    expect(barak.retryReason).toBe("unreadable_reply");

    const baraksCalls = calls.filter((call) => call.options.label === "judge:barak");
    expect(baraksCalls).toHaveLength(2);
    expect(baraksCalls[0]!.options.temperature).toBeUndefined();
    expect(baraksCalls[1]!.options.temperature).toBe(0);
  });

  it("retries the same model rather than walking the fallback chain again", async () => {
    const { calls, result } = bench({
      ...ALL_THREE,
      "judge:barak": ["No verdict here at all.", GUILTY],
    });
    await result;

    const baraksCalls = calls.filter((call) => call.options.label === "judge:barak");
    expect(baraksCalls[0]!.options.models.length).toBeGreaterThan(1);
    expect(baraksCalls[1]!.options.models).toEqual([models[0]]);
    expect(baraksCalls[1]!.options.maxAttempts).toBe(1);
  });

  it("marks the judge an error after the second reply is unreadable too", async () => {
    const { result } = bench({
      ...ALL_THREE,
      "judge:barak": ["The record is thin.", "It remains thin."],
    });
    const barak = (await result).judges[0]!;

    expect(barak.verdict).toBeNull();
    expect(barak.ok).toBe(false);
    expect(barak.problem).toBe("no_verdict");
    expect(barak.error).toContain("No verdict was inferred");
  });

  it("never resolves a contradictory reply by picking one of the two", async () => {
    const { result } = bench({
      ...ALL_THREE,
      "judge:barak": [
        "Verdict: guilty.\nFinal verdict: not guilty.",
        "Verdict: guilty.\nFinal verdict: not guilty.",
      ],
    });
    const barak = (await result).judges[0]!;

    expect(barak.verdict).toBeNull();
    expect(barak.problem).toBe("contradictory");
  });
});

describe("a verdict that arrived with no reasoning", () => {
  it("asks once more and takes the reasoning the second reply supplied", async () => {
    const { calls, result } = bench({
      ...ALL_THREE,
      "judge:barak": ['{"verdict": "guilty"}', GUILTY],
    });
    const barak = (await result).judges[0]!;

    expect(barak.verdict).toBe("guilty");
    expect(barak.reasoning).toContain("He swore an oath");
    expect(barak.retryReason).toBe("empty_reasoning");
    expect(calls.filter((call) => call.options.label === "judge:barak")).toHaveLength(2);
  });

  it("lets the first verdict stand when the retry rules the other way", async () => {
    // The retry was about prose, not about the ruling. Reasoning for a verdict it did
    // not accompany would be a fabrication with a citation attached.
    const { result } = bench({
      ...ALL_THREE,
      "judge:barak": ['{"verdict": "guilty"}', NOT_GUILTY],
    });
    const barak = (await result).judges[0]!;

    expect(barak.verdict).toBe("guilty");
    expect(barak.reasoning).toBe("");
    expect(barak.ok).toBe(true);
  });

  it("keeps the verdict when the retry itself fails", async () => {
    const { result } = bench({
      ...ALL_THREE,
      "judge:barak": ['{"verdict": "not_guilty"}', "timeout"],
    });
    const barak = (await result).judges[0]!;

    expect(barak.verdict).toBe("not_guilty");
    expect(barak.ok).toBe(true);
    expect(barak.reasoning).toBe("");
    // The failed retry still spent tokens.
    expect(barak.attempts).toHaveLength(2);
  });

  it("does not retry a verdict that came with thin reasoning", async () => {
    // One reason is accepted as-is and counts toward the majority. Part 2's "at least
    // two distinct reasons" is measured and flagged, never enforced.
    const { calls, result } = bench({
      ...ALL_THREE,
      "judge:barak": ['{"verdict": "guilty", "reasoning": "The oath was broken."}'],
    });
    const barak = (await result).judges[0]!;

    expect(barak.ok).toBe(true);
    expect(barak.thinReasoning).toBe(true);
    expect(barak.reasonCount).toBe(1);
    expect(calls.filter((call) => call.options.label === "judge:barak")).toHaveLength(1);
  });
});

describe("a judge whose call failed outright", () => {
  it("records the failure and invents nothing", async () => {
    const { result } = bench({ ...ALL_THREE, "judge:barak": ["timeout"] });
    const judging = await result;
    const barak = judging.judges[0]!;

    expect(barak.ok).toBe(false);
    expect(barak.verdict).toBeNull();
    expect(barak.errorKind).toBe("timeout");
    expect(barak.attempts).toHaveLength(1);

    // The other two still ruled — a failed judge is a 1–1 or Inconclusive downstream,
    // not a dead run.
    expect(judging.judges.filter((judge) => judge.ok)).toHaveLength(2);
  });

  it("does not retry a transport failure — the chain was already walked", async () => {
    const { calls, result } = bench({ ...ALL_THREE, "judge:barak": ["server_error", GUILTY] });
    await result;
    expect(calls.filter((call) => call.options.label === "judge:barak")).toHaveLength(1);
  });
});

describe("over-length, which is measured and not yet acted on", () => {
  it("flags reasoning over the cap without changing a word of it", async () => {
    const long = Array.from({ length: 130 }, () => "word").join(" ");
    const { result } = bench({
      ...ALL_THREE,
      "judge:barak": [JSON.stringify({ verdict: "guilty", reasoning: long })],
    });
    const barak = (await result).judges[0]!;

    expect(barak.reasoningWords).toBe(130);
    expect(barak.wordCap).toBe(100);
    expect(barak.overCap).toBe(true);
    expect(barak.reasoning).toBe(long);
    expect(barak.ok).toBe(true);
  });
});
