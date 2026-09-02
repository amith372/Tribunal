/**
 * What a finished run says about itself — the sentences the panels and the exported file
 * are both rendered from.
 *
 * This was `web/src/results-model.test.ts`, testing the browser's mirror of `summary.ts`,
 * with `summary-mirror.test.ts` beside it proving the mirror had not drifted. There is one
 * copy now, so there is nothing left to hold against anything: these assertions run against
 * the module the export and the panels both read, and agreement is structural rather than
 * checked.
 *
 * These are not rendering tests. The five panels are mostly a re-arrangement of a record
 * the server already computed, and the part that can be *wrong* is the arrangement: which
 * side reads left, whether a run with three statements is called incomplete, whether a
 * bench that split is described as split, whether a judge who dissented is named. Those
 * are sentences, and a screenshot would not notice any of them changing.
 *
 * The record fixtures are built by hand rather than by running the pipeline, because the
 * point here is the *shape* a panel has to survive — a hung bench, a silent judge, an
 * abandoned trial — and those are cheaper to state than to provoke.
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE } from "./record-cases.js";

import type { RunOutcome } from "../aggregate.js";
import type { Verdict } from "../judge-parser.js";
import type { Side } from "../preflight.js";
import type {
  AttemptView as Attempt,
  JudgeOutcomeView as JudgeView,
  RunRecordView,
  StatementOutcomeView as StatementView,
} from "../record-view.js";
import {
  bySide,
  closingLines,
  headline,
  judgeNoAnswer,
  PANELS,
  rolesAnswered,
  runSubtitle,
  stages,
  summaryRows,
  usageOf,
} from "../summary.js";

/* ---- fixtures --------------------------------------------------------------------------- */

/**
 * Stand-in identifiers, and deliberately not `:free` ones.
 *
 * The pre-commit gate refuses any commit that writes a model identifier under `web/src` —
 * specs.md Part 1: the identifiers live server-side and the browser never holds one. A
 * fixture is not the browser bundle, but the rule is worth more than the exemption would
 * be, and nothing in these tests turns on what a model is called. They only have to look
 * like the strings the panels print.
 */
const ADVOCATE_MODEL = "a-maker/an-advocate-model";
const JUDGE_MODEL = "a-maker/a-judge-model";

function attempt(label: string, over: Partial<Attempt> = {}): Attempt {
  return {
    label,
    attempt: 1,
    isRetry: false,
    requestedModel: ADVOCATE_MODEL,
    respondedModel: ADVOCATE_MODEL,
    ok: true,
    errorKind: null,
    errorMessage: null,
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      reasoningTokens: 10,
      totalTokens: 160,
      costUsd: 0,
    },
    elapsedMs: 2000,
    ...over,
  };
}

function statement(id: string, name: string, side: Side, ok = true): StatementView {
  return {
    advocateId: id,
    name,
    side,
    ok,
    text: ok ? `${name} says something.` : null,
    words: ok ? 4 : null,
    wordCap: 150,
    overCap: false,
    requestedModel: ADVOCATE_MODEL,
    model: ok ? ADVOCATE_MODEL : null,
    error: ok ? null : "The call failed.",
    errorKind: ok ? null : "server_error",
    // Absent from the browser's hand-written copy of this type, which is precisely the
    // drift a hand-copied shape invites: it compiled for months while the server had it.
    problem: null,
    rescreened: false,
    attempts: [attempt(`advocate:${id}`, ok ? {} : { ok: false, errorKind: "server_error" })],
  };
}

function judge(id: string, name: string, verdict: Verdict | null): JudgeView {
  return {
    judgeId: id,
    name,
    verdict,
    reasoning: verdict === null ? "" : "Two reasons, given plainly.",
    reasoningWords: verdict === null ? 0 : 5,
    wordCap: 100,
    overCap: false,
    reasonCount: verdict === null ? 0 : 2,
    thinReasoning: verdict === null,
    requestedModel: JUDGE_MODEL,
    model: verdict === null ? null : JUDGE_MODEL,
    ok: verdict !== null,
    error: verdict === null ? "Nothing readable came back." : null,
    errorKind: verdict === null ? "bad_response" : null,
    // The call itself failed here, so there is no parse to have a problem with. The seat
    // whose calls succeeded and whose replies were unreadable is the other case, and
    // `judgeNoAnswer` is tested against both below.
    problem: null,
    attempts: [attempt(`judge:${id}`, verdict === null ? { ok: false } : {})],
  };
}

const CAST = [
  { id: "tyrion", name: "Tyrion Lannister", side: "for" as Side },
  { id: "daenerys", name: "Daenerys Targaryen", side: "against" as Side },
  { id: "cersei", name: "Cersei Lannister", side: "for" as Side },
  { id: "grey-worm", name: "Grey Worm", side: "against" as Side },
];

function record(over: Partial<RunRecordView> = {}): RunRecordView {
  const statements = [
    statement("tyrion", "Tyrion Lannister", "for"),
    statement("daenerys", "Daenerys Targaryen", "against"),
    statement("cersei", "Cersei Lannister", "for"),
    statement("grey-worm", "Grey Worm", "against"),
  ];
  const judges = [
    judge("barak", "Aharon Barak", "guilty"),
    judge("elon", "Menachem Elon", "not_guilty"),
    judge("shamgar", "Meir Shamgar", "guilty"),
  ];
  const outcome: RunOutcome = {
    kind: "verdict",
    verdict: "guilty",
    tally: { guilty: 2, notGuilty: 1, failed: 0 },
  };

  const base: RunRecordView = {
    chargeSheet: "Jon Snow is charged with regicide and treason.",
    chargeSheetWords: 8,
    defendant: { id: "jon-snow", name: "Jon Snow" },
    casting: CAST,
    mode: "per-role",
    statements,
    judges,
    outcome,
    tally: { guilty: 2, notGuilty: 1, failed: 0 },
    attempts: [...statements.flatMap((s) => s.attempts), ...judges.flatMap((j) => j.attempts)],
    totals: {
      calls: 7,
      promptTokens: 700,
      completionTokens: 350,
      reasoningTokens: 70,
      totalTokens: 1120,
      costUsd: 0,
      elapsedMs: 14000,
      usageMissing: false,
    },
    complete: true,
    collisions: [],
    benchLineage: [],
    startedAt: "2026-08-21T10:00:00.000Z",
    finishedAt: "2026-08-21T10:00:14.000Z",
  };
  return { ...base, ...over };
}

/* ---- paging ------------------------------------------------------------------------------- */

describe("the five panels", () => {
  it("are the five specs.md names, in order", () => {
    expect(PANELS.map((panel) => panel.id)).toEqual([
      "verdict",
      "bench",
      "advocates",
      "spend",
      "closing",
    ]);
  });
});

/* ---- the finding ---------------------------------------------------------------------------- */

describe("the finding is read from the outcome's shape, never inferred", () => {
  it("prints the verdict and the tally for a run that reached one", () => {
    const head = headline(record());
    expect(head.title).toBe("Guilty");
    expect(head.detail).toContain("2 – 1");
    expect(head.tone).toBe("guilty");
  });

  it("prints no verdict for a hung bench", () => {
    const head = headline(
      record({ outcome: { kind: "hung", tally: { guilty: 1, notGuilty: 1, failed: 1 } } }),
    );
    expect(head.title).toBe("Hung");
    expect(head.tone).toBe("unresolved");
    expect(head.title).not.toMatch(/guilty/i);
  });

  it("prints no verdict for an inconclusive one, and gives the record's reason", () => {
    const head = headline(
      record({
        outcome: {
          kind: "inconclusive",
          tally: { guilty: 1, notGuilty: 0, failed: 2 },
          why: "One judge is not a bench.",
        },
      }),
    );
    expect(head.title).toBe("Inconclusive");
    expect(head.detail).toBe("One judge is not a bench.");
  });

  it("says an abandoned trial was abandoned, in the record's own words", () => {
    const head = headline(
      record({
        outcome: { kind: "aborted", reason: "daily_limit", message: "The allowance is spent." },
      }),
    );
    expect(head.title).toBe("Trial abandoned");
    expect(head.detail).toBe("The allowance is spent.");
  });
});

/* ---- sides ------------------------------------------------------------------------------------ */

describe("defense reads left, prosecution right", () => {
  it("splits the casting into two columns, defense first", () => {
    const { defense, prosecution } = bySide(record().casting);
    expect(defense.map((row) => row.id)).toEqual(["tyrion", "cersei"]);
    expect(prosecution.map((row) => row.id)).toEqual(["daenerys", "grey-worm"]);
  });

  it("keeps casting order inside a side rather than re-sorting it", () => {
    const flipped = [...CAST].reverse();
    const { defense } = bySide(flipped);
    expect(defense.map((row) => row.id)).toEqual(["cersei", "tyrion"]);
  });
});

/* ---- the numbers ------------------------------------------------------------------------------- */

describe("nothing is counted here that the record did not already carry", () => {
  it("sums an attempt set, retries included", () => {
    const usage = usageOf([attempt("a"), attempt("a", { isRetry: true })]);
    expect(usage.tokens).toBe(320);
    expect(usage.elapsedMs).toBe(4000);
  });

  it("reports no tokens rather than zero where the API said nothing", () => {
    const silent = attempt("a", {
      usage: {
        promptTokens: null,
        completionTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        costUsd: null,
      },
    });
    // Zero would read as "this was free", which is a different claim from "unknown".
    expect(usageOf([silent]).tokens).toBeNull();
  });

  it("groups the calls into the run's two waves, by the label the table prints", () => {
    const waves = stages(record());
    expect(waves.map((wave) => wave.stage)).toEqual(["advocate", "judge"]);
    expect(waves[0].attempts).toHaveLength(4);
    expect(waves[1].attempts).toHaveLength(3);
  });

  it("has the two waves' tokens add up to the run's own total", () => {
    const run = record();
    const waves = stages(run);
    const summed = waves.reduce((total, wave) => total + wave.totalTokens, 0);
    const fromAttempts = run.attempts.reduce((n, a) => n + (a.usage.totalTokens ?? 0), 0);
    expect(summed).toBe(fromAttempts);
  });

  it("drops a wave that never happened rather than showing an empty one", () => {
    const run = record({
      judges: [],
      attempts: record().attempts.filter((a) => a.label.startsWith("advocate:")),
    });
    expect(stages(run).map((wave) => wave.stage)).toEqual(["advocate"]);
  });
});

/* ---- the summary slide --------------------------------------------------------------------------- */

describe("the closing slide", () => {
  it("lists the eight facts, with the finding carrying the only colour", () => {
    const rows = summaryRows(record());
    expect(rows.map((row) => row.label)).toEqual([
      "Defendant",
      "Charge sheet",
      "Defense",
      "Prosecution",
      "Finding",
      "Bench",
      "Calls",
      "Price",
    ]);
    expect(rows.filter((row) => row.tone !== undefined)).toHaveLength(1);
    expect(rows.find((row) => row.label === "Finding")?.value).toBe("Guilty, 2 – 1");
    expect(rows.find((row) => row.label === "Price")?.value).toBe("$0");
  });

  it("names the sides in the same left-to-right order as the panels", () => {
    const rows = summaryRows(record());
    expect(rows.find((row) => row.label === "Defense")?.value).toBe(
      "Tyrion Lannister · Cersei Lannister",
    );
    expect(rows.find((row) => row.label === "Prosecution")?.value).toBe(
      "Daenerys Targaryen · Grey Worm",
    );
  });

  it("marks a total as a floor when a call reported no usage", () => {
    const run = record({ totals: { ...record().totals, usageMissing: true } });
    expect(summaryRows(run).find((row) => row.label === "Calls")?.value).toContain("a floor");
  });

  it("names the judge who stood alone, and does not paraphrase them", () => {
    const closing = closingLines(record());
    expect(closing.lead).toContain("Four advocates each spoke once");
    expect(closing.lead).toContain("two of them found guilty");
    expect(closing.note).toContain("Menachem Elon stood alone");
    expect(closing.note).toContain("not guilty");
    // The reasoning belongs to the judge and stays on the bench panel, in their words.
    expect(closing.note).toContain("in their own words");
  });

  it("calls a unanimous bench unanimous", () => {
    const run = record({
      judges: [
        judge("barak", "Aharon Barak", "guilty"),
        judge("elon", "Menachem Elon", "guilty"),
        judge("shamgar", "Meir Shamgar", "guilty"),
      ],
      outcome: { kind: "verdict", verdict: "guilty", tally: { guilty: 3, notGuilty: 0, failed: 0 } },
    });
    expect(closingLines(run).note).toContain("unanimous");
  });

  it("says a majority was a majority of the seats that ruled, where one was silent", () => {
    const run = record({
      judges: [
        judge("barak", "Aharon Barak", "guilty"),
        judge("elon", "Menachem Elon", "guilty"),
        judge("shamgar", "Meir Shamgar", null),
      ],
      outcome: { kind: "verdict", verdict: "guilty", tally: { guilty: 2, notGuilty: 0, failed: 1 } },
      complete: false,
    });
    const closing = closingLines(run);
    expect(closing.lead).toContain("Two of the three judges returned a readable verdict");
    expect(closing.note).toContain("Meir Shamgar returned nothing");
    expect(closing.note).toContain("majority of the seats that ruled");
  });

  it("calls an incomplete trial incomplete, and says so before the finding", () => {
    const run = record({
      statements: [
        statement("tyrion", "Tyrion Lannister", "for"),
        statement("daenerys", "Daenerys Targaryen", "against"),
        statement("cersei", "Cersei Lannister", "for", false),
        statement("grey-worm", "Grey Worm", "against"),
      ],
      complete: false,
    });
    expect(closingLines(run).lead).toContain("recorded as incomplete");
    expect(rolesAnswered(run)).toEqual({ answered: 6, of: 7 });
  });

  it("invents no verdict for a hung bench", () => {
    const run = record({
      judges: [
        judge("barak", "Aharon Barak", "guilty"),
        judge("elon", "Menachem Elon", "not_guilty"),
        judge("shamgar", "Meir Shamgar", null),
      ],
      outcome: { kind: "hung", tally: { guilty: 1, notGuilty: 1, failed: 1 } },
      complete: false,
    });
    const closing = closingLines(run);
    expect(closing.note).toContain("No verdict was invented");
    expect(closing.lead).not.toMatch(/found (guilty|not guilty)/);
  });

  it("says the bench was never asked when the run was abandoned first", () => {
    const run = record({
      judges: [],
      outcome: {
        kind: "aborted",
        reason: "daily_limit",
        message: "The daily free allowance is spent.",
      },
      complete: false,
    });
    expect(closingLines(run).lead).toContain("the bench was never asked");
    expect(closingLines(run).note).toContain("allowance is spent");
  });

  it("discloses two judges on one maker, where the record recorded it", () => {
    const run = record({ benchLineage: [{ maker: "nvidia", judges: ["barak", "shamgar"] }] });
    expect(closingLines(run).note).toContain("one maker");
  });
});

/* ---- the masthead ------------------------------------------------------------------------------------ */

/*
 * A seat that returned no verdict says what happened to it, on the bench panel and in the
 * exported file both. The point of these assertions is that the account is *read* — from
 * the attempts the call table already lists and from the parser's own record of what it
 * refused — and never composed out of a guess about what a model meant to say.
 */
describe("a bench seat that never ruled gives its account", () => {
  it("says how many times it was asked, and what stopped the last reply", () => {
    const account = judgeNoAnswer({
      errorKind: null,
      problem: "truncated",
      attempts: [
        attempt("judge:barak", { requestedModel: JUDGE_MODEL, respondedModel: JUDGE_MODEL }),
        attempt("judge:barak", {
          attempt: 2,
          isRetry: true,
          requestedModel: JUDGE_MODEL,
          respondedModel: JUDGE_MODEL,
        }),
      ],
    });

    expect(account.lead).toContain("two attempts");
    expect(account.lead).toContain("cut off before it reached the ruling");
    expect(account.lead).toContain("No verdict was inferred");
    expect(account.attempts).toHaveLength(2);
  });

  /*
   * The confusing case, and the reason the seat says anything at all: the call table reads
   * "ok" beside a judge who answered nothing, because `ok` is the call's verdict on itself
   * — a request that succeeded and a body that came back. The seat has to say that the body
   * was the unusable part, or the two panels look like they disagree.
   */
  it("distinguishes a call that succeeded and said nothing usable from one that failed", () => {
    const account = judgeNoAnswer({
      errorKind: null,
      problem: "no_verdict",
      attempts: [
        attempt("judge:elon", { ok: true, requestedModel: JUDGE_MODEL, respondedModel: JUDGE_MODEL }),
        attempt("judge:elon", {
          attempt: 2,
          isRetry: true,
          ok: false,
          errorKind: "rate_limited",
          requestedModel: JUDGE_MODEL,
          respondedModel: null,
        }),
      ],
    });

    expect(account.attempts[0]).toContain("answered, no ruling in it");
    expect(account.attempts[0]).toContain("160 tokens");
    expect(account.attempts[1]).toContain("(retry)");
    expect(account.attempts[1]).toContain("rate-limited");
  });

  /* An error kind never reaches the reader with its underscores on (specs.md Part 5). */
  it("says a failed chain in words rather than in error kinds", () => {
    const account = judgeNoAnswer({
      errorKind: "rate_limited",
      problem: null,
      attempts: [attempt("judge:shamgar", { ok: false, errorKind: "rate_limited" })],
    });

    expect(account.lead).toContain("rate-limited");
    expect(account.lead).not.toContain("rate_limited");
    expect(account.lead).toContain("one attempt");
  });
});

describe("the masthead line", () => {
  it("names the defendant, the run's own date and how it was cast", () => {
    expect(runSubtitle(record())).toBe(
      "Jon Snow, defendant · 21 August 2026 · a different model per role",
    );
  });

  it("says so when one model served every seat", () => {
    expect(runSubtitle(record({ mode: "solo" }))).toContain("one model for all seven roles");
  });
});

/* ---- every shape a record can take ---------------------------------------------------------- */

/**
 * The eleven record shapes `record-cases.ts` collects — a split bench, a unanimous one, a
 * silent seat, a hung bench, a lone surviving verdict, an advocate who never spoke, a trial
 * abandoned before the bench sat, a solo-mode run, two judges on one maker.
 *
 * **These shapes used to be run through here by `summary-mirror.test.ts`, which asserted
 * only that the browser's copy and the server's said the same thing.** Two copies agreeing
 * is not two copies being right: the mirror would have passed just as happily on two
 * identically wrong sentences. There is one copy now, so the question that is left is the
 * one worth asking — does it produce a usable sentence for every shape a run can end in?
 */
describe.each(CATALOGUE)("the sentences hold for $name", ({ record }) => {
  it("heads the run with a finding and a reason for it", () => {
    const head = headline(record);
    expect(head.title.length).toBeGreaterThan(0);
    expect(head.detail.length).toBeGreaterThan(0);
    expect(["guilty", "acquitted", "unresolved"]).toContain(head.tone);
  });

  it("names the defendant and the date in the subtitle", () => {
    const subtitle = runSubtitle(record);
    expect(subtitle).toContain(record.defendant.name);
    expect(subtitle).toContain("defendant");
  });

  it("keeps every advocate on exactly one side", () => {
    const { defense, prosecution } = bySide(record.statements);
    expect(defense.length + prosecution.length).toBe(record.statements.length);
  });

  it("rolls every attempt into a stage, and loses none of them", () => {
    const counted = stages(record).reduce((total, stage) => total + stage.attempts.length, 0);
    expect(counted).toBe(record.attempts.length);
  });

  it("closes with prose rather than an empty section", () => {
    for (const line of Object.values(closingLines(record))) {
      if (typeof line === "string") expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("counts no more roles answered than were seated", () => {
    const { answered, of } = rolesAnswered(record);
    expect(answered).toBeLessThanOrEqual(of);
    expect(of).toBe(record.statements.length + record.judges.length);
  });
});
