/**
 * One whole run, assembled. Zero model calls: the caller is a scripted fake.
 *
 * The waves themselves are already covered by `statements.test.ts` and `judging.test.ts`.
 * What is only visible here is what a *run* adds to them: the order the events go out in,
 * the whole-run deadline, the daily cap that outranks the wave's own conclusion, and the
 * rule that nothing may be emitted behind the closing record.
 */

import { describe, expect, it } from "vitest";

import { getModelRegistry, type RunModels } from "../config.js";
import { loadData } from "../data.js";
import { preflight, type ValidRun } from "../preflight.js";
import { executeRun } from "../run.js";
import type { RunEventName } from "../run-buffer.js";
import type { CallOptions, CallResult } from "../openrouter.js";
import { fakeResult, scriptedCaller } from "./fake-caller.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";

const data = loadData();
const registry = getModelRegistry();

const MODELS: RunModels = {
  mode: "per-role",
  advocates: registry.advocatePool.slice(0, 4),
  judges: registry.judgePool.slice(0, 3),
};

function part4Run(): ValidRun {
  const result = preflight(
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
    data,
  );
  if (!result.ok) throw new Error("Part 4's case must pass pre-flight");
  return result.run;
}

const run = part4Run();

const SPOKEN = {
  "advocate:tyrion": ["The realm was already burning when he acted."],
  "advocate:jon-snow": ["I did it. I would tell you why, and then you may call it what you like."],
  "advocate:daenerys": ["He was sworn to me, and he came to me as a lover."],
  "advocate:grey-worm": ["He killed our queen. This is murder."],
  "judge:barak": ["Verdict: guilty. He killed her. He was sworn to her."],
  "judge:elon": ["Verdict: guilty. The powerful stay accountable. She was unarmed."],
  "judge:shamgar": ["Verdict: not guilty. The city was at stake. The law bends to necessity."],
};

interface Emitted {
  readonly event: RunEventName;
  readonly data: unknown;
}

function recorder() {
  const events: Emitted[] = [];
  return { events, emit: (event: RunEventName, payload: unknown) => events.push({ event, data: payload }) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A caller that answers after a delay, so the deadline has something to overtake. */
function slowCaller(delays: Record<string, number>, text = "A statement about the case.") {
  const calls: CallOptions[] = [];
  const call = async (options: CallOptions): Promise<CallResult> => {
    calls.push(options);
    await sleep(delays[options.label] ?? 0);
    return fakeResult(options, text);
  };
  return { call, calls };
}

describe("a run where every seat answers", () => {
  it("emits four statements, then three verdicts, then the record", async () => {
    const { call } = scriptedCaller(SPOKEN);
    const { events, emit } = recorder();

    await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call });

    expect(events.map((event) => event.event)).toEqual([
      // The casting, before a single model has been asked anything.
      "preflight",
      "statement", "statement", "statement", "statement",
      "judge", "judge", "judge",
      "done",
    ]);
  });

  /**
   * **The seating plan, asserted without an HTTP server.**
   *
   * This frame used to be built inside the `POST /api/run` callback, which meant the only
   * way to check which model each seat had been asked for was to stand up an app and read
   * SSE frames out of a 500-line HTTP suite. It is the run's own first event now, so the
   * question can be asked of a function.
   */
  it("opens by naming every seat and the model it was asked for", async () => {
    const { call } = scriptedCaller(SPOKEN);
    const { events, emit } = recorder();

    await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call, runId: "r-1" });

    const opening = events[0];
    expect(opening?.event).toBe("preflight");
    const frame = opening?.data as {
      runId: string;
      mode: string;
      casting: { id: string; side: string; requestedModel: string }[];
      bench: { id: string; requestedModel: string }[];
    };

    expect(frame.runId).toBe("r-1");
    expect(frame.mode).toBe(MODELS.mode);

    // Four advocates and three judges, each carrying the model actually asked for — in
    // casting order, which is what pairs a seat with its model.
    expect(frame.casting.map((seat) => seat.requestedModel)).toEqual(MODELS.advocates);
    expect(frame.bench.map((seat) => seat.requestedModel)).toEqual(MODELS.judges);
    expect(frame.casting.map((seat) => seat.id)).toEqual(
      run.advocates.map((advocate) => advocate.character.id),
    );
    expect(frame.bench.map((seat) => seat.id)).toEqual(data.judges.map((judge) => judge.id));
  });

  it("returns the same record it emitted — one record, three renderings", async () => {
    const { call } = scriptedCaller(SPOKEN);
    const { events, emit } = recorder();

    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call });
    const done = events.at(-1);

    expect(done?.event).toBe("done");
    expect(done?.data).toBe(record);
  });

  it("makes seven logical calls and folds every attempt into the totals", async () => {
    const { call, calls } = scriptedCaller(SPOKEN);
    const { emit } = recorder();

    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call });

    expect(calls).toHaveLength(7);
    expect(record.totals.calls).toBe(7);
    const summed = record.attempts.reduce((sum, a) => sum + (a.usage.totalTokens ?? 0), 0);
    expect(record.totals.totalTokens).toBe(summed);
    expect(record.outcome.kind).toBe("verdict");
    expect(record.complete).toBe(true);
  });

  it("never asks the bench before every advocate has settled", async () => {
    // The judges hear all four statements, so the second wave cannot start early — a
    // judge called mid-wave would be ruling on a case it had only half heard.
    const order: string[] = [];
    const call = async (options: CallOptions): Promise<CallResult> => {
      order.push(options.label);
      await sleep(options.label.startsWith("advocate") ? 20 : 0);
      return fakeResult(options, "Verdict: guilty. A reason. Another reason.");
    };

    await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit: recorder().emit, call });

    const lastAdvocate = order.findLastIndex((label) => label.startsWith("advocate:"));
    const firstJudge = order.findIndex((label) => label.startsWith("judge:"));
    expect(firstJudge).toBeGreaterThan(lastAdvocate);
  });
});

describe("the whole-run deadline", () => {
  it("stops a run whose advocates never come back, and never asks the bench", async () => {
    const { call, calls } = slowCaller({
      "advocate:tyrion": 500,
      "advocate:jon-snow": 500,
      "advocate:daenerys": 500,
      "advocate:grey-worm": 500,
    });
    const { events, emit } = recorder();

    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call, timeoutMs: 40 });

    expect(record.outcome.kind).toBe("aborted");
    if (record.outcome.kind === "aborted") expect(record.outcome.reason).toBe("run_timeout");
    expect(calls.filter((options) => options.label.startsWith("judge:"))).toHaveLength(0);
    // The room is still drawn before the deadline stops the run: the casting was real,
    // and the record says the trial was abandoned rather than that it never happened.
    expect(events.map((event) => event.event)).toEqual(["preflight", "done"]);
  });

  it("keeps the advocates who did answer, and marks the ones who did not as failed", async () => {
    const call = async (options: CallOptions): Promise<CallResult> => {
      await sleep(options.label === "advocate:tyrion" ? 0 : 500);
      return fakeResult(options, "The realm was already burning when he acted.");
    };
    const { emit } = recorder();

    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call, timeoutMs: 60 });

    // Casting order, all four present — a gap is written in, never left out.
    expect(record.statements).toHaveLength(4);
    expect(record.statements.map((s) => s.advocateId)).toEqual([
      "jon-snow", "tyrion", "daenerys", "grey-worm",
    ]);
    expect(record.statements.find((s) => s.advocateId === "tyrion")?.ok).toBe(true);
    expect(record.statements.filter((s) => !s.ok)).toHaveLength(3);
    expect(record.complete).toBe(false);
  });

  it("keeps the verdicts already in hand when the bench runs out of time", async () => {
    const call = async (options: CallOptions): Promise<CallResult> => {
      if (options.label === "judge:shamgar") await sleep(500);
      return fakeResult(options, "Verdict: guilty. He was sworn to her. She was unarmed.");
    };
    const { emit } = recorder();

    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call, timeoutMs: 120 });

    expect(record.judges).toHaveLength(3);
    expect(record.tally.guilty).toBe(2);
    expect(record.tally.failed).toBe(1);
    // Two agreeing judges are a majority of the bench even where the third never ruled.
    expect(record.outcome.kind).toBe("verdict");
    expect(record.complete).toBe(false);
  });

  it("emits nothing behind the record, however late a call lands", async () => {
    const { events, emit } = recorder();
    const call = async (options: CallOptions): Promise<CallResult> => {
      await sleep(options.label === "advocate:jon-snow" ? 120 : 0);
      return fakeResult(options, "A statement about the case that was made.");
    };

    await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call, timeoutMs: 40 });
    const afterDone = events.length;
    await sleep(200);

    expect(events).toHaveLength(afterDone);
    expect(events.at(-1)?.event).toBe("done");
  });
});

describe("the account's daily allowance", () => {
  const capped = {
    "advocate:tyrion": ["daily_limit"],
    "advocate:jon-snow": ["daily_limit"],
    "advocate:daenerys": ["daily_limit"],
    "advocate:grey-worm": ["daily_limit"],
  } as const;

  it("stops the run at once rather than spending the bench's requests too", async () => {
    const { call, calls } = scriptedCaller(capped);
    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit: recorder().emit, call });

    expect(calls).toHaveLength(4);
    expect(record.outcome.kind).toBe("aborted");
  });

  it("says so in plain words instead of telling the user to try again in a moment", async () => {
    const { call } = scriptedCaller(capped);
    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit: recorder().emit, call });

    expect(record.outcome.kind).toBe("aborted");
    if (record.outcome.kind !== "aborted") return;
    expect(record.outcome.reason).toBe("daily_limit");
    expect(record.outcome.message).toMatch(/00:00 UTC/);
    expect(record.outcome.message).not.toMatch(/try the run again/i);
  });

  it("outranks a silenced side, because the cap is the reason the side was silenced", async () => {
    // Two advocates answered; the prosecution hit the cap. The wave would call that a
    // silenced side and advise trying again — which is wrong advice until tomorrow.
    const { call, calls } = scriptedCaller({
      "advocate:tyrion": ["The realm was already burning."],
      "advocate:jon-snow": ["I did it."],
      "advocate:daenerys": ["daily_limit"],
      "advocate:grey-worm": ["daily_limit"],
    });

    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit: recorder().emit, call });

    expect(record.outcome.kind).toBe("aborted");
    if (record.outcome.kind === "aborted") expect(record.outcome.reason).toBe("daily_limit");
    expect(calls.filter((call) => call.options.label.startsWith("judge:"))).toHaveLength(0);
  });
});

describe("a run the models spoiled", () => {
  it("aborts on a silenced side and never reaches the bench", async () => {
    const { call, calls } = scriptedCaller({
      "advocate:tyrion": ["The realm was already burning."],
      "advocate:jon-snow": ["I did it."],
      "advocate:daenerys": ["server_error"],
      "advocate:grey-worm": ["server_error"],
    });

    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit: recorder().emit, call });

    expect(record.outcome.kind).toBe("aborted");
    if (record.outcome.kind === "aborted") expect(record.outcome.reason).toBe("side_silenced");
    expect(calls.filter((call) => call.options.label.startsWith("judge:"))).toHaveLength(0);
  });

  it("survives one failed advocate and still reaches a verdict", async () => {
    const { call } = scriptedCaller({ ...SPOKEN, "advocate:jon-snow": ["server_error"] });
    const { events, emit } = recorder();

    const record = await executeRun({ run, data, mode: MODELS.mode, models: MODELS, emit, call });

    expect(record.statements.filter((s) => s.ok)).toHaveLength(3);
    expect(record.outcome.kind).toBe("verdict");
    expect(record.complete).toBe(false);
    // The gap is still streamed: Stage 7 has to be able to show the seat that failed.
    expect(events.filter((event) => event.event === "statement")).toHaveLength(4);
  });
});
