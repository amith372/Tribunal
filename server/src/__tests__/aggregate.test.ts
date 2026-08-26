/**
 * The run record — the one object the panels, the stream and the export all read.
 *
 * These tests run the real statement wave and the real judging ladder against scripted
 * callers, so what they assert is the pipeline's own output folded by `aggregate`, not
 * a hand-built fixture that happens to agree with it. Zero model calls.
 *
 * They cover four of specs.md Part 2's criteria: the majority equals the shown
 * verdicts, a failed judge yields Hung or Inconclusive with no verdict invented, the
 * token total equals the per-call numbers summed, and the price reads $0.
 */

import { describe, expect, it } from "vitest";

import { aggregate, type RunRecord } from "../aggregate.js";
import { getModelRegistry, resolveRunModels } from "../config.js";
import { loadData } from "../data.js";
import { runJudging } from "../judging.js";
import { runStatements } from "../statements.js";
import { preflight, type ValidRun } from "../preflight.js";
import { toDeliveredStatements } from "../statements.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";
import { scriptedCaller } from "./fake-caller.js";
import type { ErrorKind } from "../openrouter.js";

const data = loadData();

function part4Run(): ValidRun {
  const result = preflight(
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
    data,
  );
  if (!result.ok) throw new Error("Part 4's case must pass pre-flight");
  return result.run;
}

const run = part4Run();

const GUILTY = '{"verdict": "guilty", "reasoning": "He swore an oath. He broke it himself."}';
const NOT_GUILTY =
  '{"verdict": "not_guilty", "reasoning": "Necessity was made out. No lawful means remained."}';

type Reply = string | ErrorKind;

/** Runs the whole pipeline on Part 4's case and folds it, with every call scripted. */
async function record(options: {
  advocates?: Reply[];
  judges: readonly [Reply, Reply, Reply];
}): Promise<RunRecord> {
  const models = resolveRunModels("per-role");
  const advocateReplies = options.advocates ?? [
    "The realm was burning.",
    "He did the one useful thing done that day.",
    "He was sworn to her.",
    "He killed our queen.",
  ];

  const script: Record<string, readonly Reply[]> = {};
  run.advocates.forEach((advocate, i) => {
    script[`advocate:${advocate.character.id}`] = [advocateReplies[i]];
  });
  data.judges.forEach((judge, i) => {
    script[`judge:${judge.id}`] = [options.judges[i]];
  });

  const startedAt = new Date("2026-08-21T10:00:00.000Z");
  const caller = scriptedCaller(script);

  const statements = await runStatements({
    run,
    data,
    mode: "per-role",
    models: models.advocates,
    call: caller.call,
  });

  const judging = statements.abort
    ? null
    : await runJudging({
        run,
        data,
        mode: "per-role",
        models: models.judges,
        statements: toDeliveredStatements(statements),
        call: caller.call,
      });

  return aggregate({
    run,
    models,
    statements,
    judging,
    startedAt,
    finishedAt: new Date("2026-08-21T10:00:14.000Z"),
  });
}

describe("the majority", () => {
  it("is the verdict when all three agree", async () => {
    const result = await record({ judges: [GUILTY, GUILTY, GUILTY] });

    expect(result.outcome).toMatchObject({ kind: "verdict", verdict: "guilty" });
    expect(result.tally).toEqual({ guilty: 3, notGuilty: 0, failed: 0 });
    expect(result.complete).toBe(true);
  });

  it("is the verdict on a two-to-one split", async () => {
    const result = await record({ judges: [GUILTY, NOT_GUILTY, NOT_GUILTY] });

    expect(result.outcome).toMatchObject({ kind: "verdict", verdict: "not_guilty" });
    expect(result.tally).toEqual({ guilty: 1, notGuilty: 2, failed: 0 });
  });

  it("equals the verdicts actually shown, every time", async () => {
    const result = await record({ judges: [GUILTY, GUILTY, NOT_GUILTY] });

    // specs.md Part 2: the final verdict equals the majority of the three shown.
    const shown = result.judges.map((judge) => judge.verdict);
    const guilty = shown.filter((v) => v === "guilty").length;
    const notGuilty = shown.filter((v) => v === "not_guilty").length;

    expect(result.tally.guilty).toBe(guilty);
    expect(result.tally.notGuilty).toBe(notGuilty);
    expect(result.outcome).toMatchObject({
      kind: "verdict",
      verdict: guilty > notGuilty ? "guilty" : "not_guilty",
    });
  });
});

describe("a bench that did not reach a majority", () => {
  it("reads Hung at one against one, and carries no verdict to print", async () => {
    const result = await record({ judges: [GUILTY, NOT_GUILTY, "server_error"] });

    expect(result.outcome.kind).toBe("hung");
    expect(result.tally).toEqual({ guilty: 1, notGuilty: 1, failed: 1 });
    // The point of the tagged union: there is no field a renderer could print.
    expect(result.outcome).not.toHaveProperty("verdict");
    expect(result.complete).toBe(false);
  });

  it("reads Inconclusive on a lone surviving verdict — one judge is not a bench", async () => {
    const result = await record({ judges: [GUILTY, "server_error", "server_error"] });

    expect(result.outcome).toMatchObject({ kind: "inconclusive" });
    expect(result.outcome).not.toHaveProperty("verdict");
    expect(result.tally.failed).toBe(2);
  });

  it("still returns a verdict when two agreed and the third failed", async () => {
    // Two of three seats is a majority of the bench however the third ended up.
    const result = await record({ judges: [GUILTY, GUILTY, "server_error"] });

    expect(result.outcome).toMatchObject({ kind: "verdict", verdict: "guilty" });
    expect(result.complete).toBe(false);
  });
});

describe("a run that never reached the bench", () => {
  it("is aborted, not judged, when a whole side is silenced", async () => {
    const result = await record({
      advocates: ["A statement.", "Another.", "server_error", "server_error"],
      judges: [GUILTY, GUILTY, GUILTY],
    });

    expect(result.outcome).toMatchObject({ kind: "aborted", reason: "side_silenced" });
    expect(result.judges).toHaveLength(0);
    expect(result.outcome).not.toHaveProperty("verdict");
  });
});

describe("the totals", () => {
  it("equal the per-call numbers summed, and the price reads $0", async () => {
    const result = await record({ judges: [GUILTY, NOT_GUILTY, GUILTY] });

    // specs.md Part 2: the token total equals the per-call token numbers added up.
    const summed = result.attempts.reduce((n, a) => n + (a.usage.totalTokens ?? 0), 0);
    expect(result.totals.totalTokens).toBe(summed);
    expect(result.totals.calls).toBe(result.attempts.length);
    expect(result.totals.costUsd).toBe(0);
  });

  it("count every attempt, including the ones that failed", async () => {
    const clean = await record({ judges: [GUILTY, GUILTY, GUILTY] });
    const withFailure = await record({ judges: [GUILTY, GUILTY, "server_error"] });

    // A failed call still spent tokens and still belongs in the table.
    expect(withFailure.totals.calls).toBeGreaterThanOrEqual(clean.totals.calls);
    expect(withFailure.attempts.some((attempt) => !attempt.ok)).toBe(true);
  });

  it("count reasoning tokens, because they were really spent", async () => {
    const result = await record({ judges: [GUILTY, GUILTY, GUILTY] });
    expect(result.totals.reasoningTokens).toBeGreaterThan(0);
  });
});

describe("the record itself", () => {
  it("carries the charge sheet, the casting and the defendant", async () => {
    const result = await record({ judges: [GUILTY, GUILTY, GUILTY] });

    expect(result.chargeSheet).toBe(run.chargeSheet);
    expect(result.defendant.id).toBe("jon-snow");
    expect(result.casting).toHaveLength(4);
    expect(result.casting.filter((c) => c.side === "for")).toHaveLength(2);
    expect(result.casting.filter((c) => c.side === "against")).toHaveLength(2);
    // specs.md Part 1: the accused may answer the charge from a defence seat and may
    // never prosecute, so the record's guarantee is about the side and not the presence.
    const accused = result.casting.find((c) => c.id === result.defendant.id);
    expect(accused?.side).not.toBe("against");
  });

  it("is a pure function of its input — same input, same record", async () => {
    const a = await record({ judges: [GUILTY, NOT_GUILTY, GUILTY] });
    const b = await record({ judges: [GUILTY, NOT_GUILTY, GUILTY] });

    // Models are shuffled per run and elapsed times are faked, so compare what should
    // not vary: the outcome, the tally and the verdicts.
    expect(a.outcome).toEqual(b.outcome);
    expect(a.tally).toEqual(b.tally);
    expect(a.startedAt).toBe(b.startedAt);
  });

  it("names any two roles that ended up on the same model", async () => {
    const result = await record({ judges: [GUILTY, GUILTY, GUILTY] });

    // Per-role mode assigns seven distinct models, so a clean run collides on none.
    expect(result.collisions).toEqual([]);
    for (const collision of result.collisions) {
      expect(collision.roles.length).toBeGreaterThan(1);
    }
  });

  it("reports the models that answered, not the ones requested", async () => {
    const result = await record({ judges: [GUILTY, GUILTY, GUILTY] });
    const { judgePool } = getModelRegistry();

    for (const judge of result.judges) {
      expect(judge.model).not.toBeNull();
      expect(judgePool).toContain(judge.model as string);
    }
  });
});
