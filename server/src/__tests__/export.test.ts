/**
 * The exported file — the portable copy of a run, and the only one that leaves here.
 *
 * These tests build a record by running the real pipeline against scripted callers,
 * then assert against the rendered file. What they are really protecting is three
 * claims specs.md Part 2 makes and a reader cannot verify by eye: that the file needs
 * no network, that its numbers equal the app's, and that nothing a model wrote can
 * escape as markup.
 */

import { describe, expect, it } from "vitest";

import { aggregate, type RunRecord } from "../aggregate.js";
import { buildExportHtml, escapeHtml } from "../export.js";
import { NO_ANSWER } from "../summary.js";
import { resolveRunModels } from "../config.js";
import { loadData } from "../data.js";
import { runJudging } from "../judging.js";
import { runStatements, toDeliveredStatements } from "../statements.js";
import { preflight, type ValidRun } from "../preflight.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";
import { scriptedCaller } from "./fake-caller.js";
import type { ErrorKind } from "../openrouter.js";

const data = loadData();

function part4Run(chargeSheet = PART_4_CHARGE_SHEET): ValidRun {
  const result = preflight(
    { chargeSheet, defendant: "jon-snow", advocates: PART_4_CAST },
    data,
  );
  if (!result.ok) throw new Error("Part 4's case must pass pre-flight");
  return result.run;
}

const GUILTY = '{"verdict": "guilty", "reasoning": "He swore an oath to her. He broke it himself."}';
const NOT_GUILTY =
  '{"verdict": "not_guilty", "reasoning": "Necessity was made out. No lawful means remained."}';

type Reply = string | ErrorKind;

async function record(options: {
  advocates?: Reply[];
  judges: readonly [Reply, Reply, Reply];
  run?: ValidRun;
}): Promise<RunRecord> {
  const run = options.run ?? part4Run();
  const models = resolveRunModels("per-role");
  const replies = options.advocates ?? [
    "The realm was already burning when he acted.",
    "He removed my rival. I will not pretend that troubles me.",
    "He was sworn to me.",
    "He killed our queen. This is murder.",
  ];

  const script: Record<string, readonly Reply[]> = {};
  run.advocates.forEach((advocate, i) => {
    script[`advocate:${advocate.character.id}`] = [replies[i]];
  });
  data.judges.forEach((judge, i) => {
    script[`judge:${judge.id}`] = [options.judges[i]];
  });

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
    startedAt: new Date("2026-08-21T10:00:00.000Z"),
    finishedAt: new Date("2026-08-21T10:00:14.000Z"),
  });
}

describe("it opens from disk with no server and no network", () => {
  it("fetches nothing at view time", async () => {
    const html = buildExportHtml(await record({ judges: [GUILTY, GUILTY, NOT_GUILTY] }));

    // Any of these would make the file depend on something that is not the file.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\ssrc=/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/@import/i);

    // The only `url(...)` in the document is the embedded font, and it points at itself.
    for (const [, target] of html.matchAll(/url\(([^)]*)\)/g)) {
      expect(target.startsWith("data:")).toBe(true);
    }
  });

  it("names no remote address anywhere a reader is meant to read", async () => {
    const html = buildExportHtml(await record({ judges: [GUILTY, GUILTY, NOT_GUILTY] }));

    /**
     * Everything above "Raw responses" is the document; below it is quoted API output.
     *
     * The split matters because the raw section is *evidence* — Part 3 requires the record
     * to carry the responses as they came — and free models' own error bodies routinely
     * contain links ("add your own key at …"). Stripping those would be editing the
     * evidence to satisfy a test. They are escaped text inside a `<pre>` and nothing
     * fetches them, which is what the assertions above establish for the file as a whole.
     */
    const [document] = html.split("<h2>Raw responses</h2>");
    expect(document).not.toMatch(/https?:\/\//i);
  });

  it("is a whole document, not a fragment", async () => {
    const html = buildExportHtml(await record({ judges: [GUILTY, GUILTY, GUILTY] }));
    expect(html.trimStart()).toMatch(/^<!doctype html>/i);
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
  });
});

describe("its numbers match the record the app rendered", () => {
  it("prints the same totals, and the price reads $0", async () => {
    const run = await record({ judges: [GUILTY, NOT_GUILTY, GUILTY] });
    const html = buildExportHtml(run);

    expect(html).toContain(run.totals.totalTokens.toLocaleString("en-US"));
    expect(html).toContain(run.totals.reasoningTokens.toLocaleString("en-US"));
    expect(html).toContain("$0");
    // The footer total must be the rows summed, not a separate calculation.
    const summed = run.attempts.reduce((n, a) => n + (a.usage.totalTokens ?? 0), 0);
    expect(run.totals.totalTokens).toBe(summed);
  });

  it("carries a row for every call, including failed ones", async () => {
    const run = await record({ judges: [GUILTY, GUILTY, "server_error"] });
    const html = buildExportHtml(run);

    for (const attempt of run.attempts) {
      expect(html).toContain(escapeHtml(attempt.label));
    }
    // The section headings are the results panels' own, because the file is those panels.
    expect(html).toContain("Every Call This Run Made");
    expect(html).toContain("Raw responses");
  });

  it("shows the verdict and the tally that the record holds", async () => {
    const run = await record({ judges: [GUILTY, GUILTY, NOT_GUILTY] });
    const html = buildExportHtml(run);

    expect(run.outcome).toMatchObject({ kind: "verdict", verdict: "guilty" });
    expect(html).toContain("Guilty");
    // Spaced exactly as the verdict panel spaces it — the two are read against each other.
    expect(html).toContain("2 – 1 on a bench of three");
  });
});

describe("nothing a model or a user wrote can escape as markup", () => {
  const NASTY = `<script>alert('x')</script> Jon Snow is "accused" of regicide & treason against the realm, is he not?`;

  it("escapes the charge sheet", async () => {
    const run = await record({ run: part4Run(NASTY), judges: [GUILTY, GUILTY, GUILTY] });
    const html = buildExportHtml(run);

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("escapes a statement", async () => {
    const run = await record({
      advocates: [`<img onerror="x"> He acted for the realm.`, "Two.", "Three.", "Four."],
      judges: [GUILTY, GUILTY, GUILTY],
    });
    const html = buildExportHtml(run);

    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;img");
  });

  it("escapes ampersands before angle brackets, so nothing double-escapes", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});

describe("an incomplete run is recorded as incomplete", () => {
  it("names the advocate who delivered nothing", async () => {
    const run = await record({
      advocates: ["One.", "Two.", "server_error", "Four."],
      judges: [GUILTY, GUILTY, GUILTY],
    });
    const html = buildExportHtml(run);

    expect(run.complete).toBe(false);
    expect(html).toContain("incomplete trial");

    // The card says the one sentence (specs.md Part 5) rather than the provider's own
    // words for its failure.
    expect(html).toContain(NO_ANSWER);

    // **And the detail is still in the document.** Moving where a reader meets it is the
    // whole change; losing it would not be. The call table still carries the failed
    // attempt, its error kind and the model that refused.
    expect(html).toContain("server_error");
  });

  it("says the bench was short, and prints no verdict where none was reached", async () => {
    const run = await record({ judges: [GUILTY, NOT_GUILTY, "server_error"] });
    const html = buildExportHtml(run);

    expect(run.outcome.kind).toBe("hung");
    expect(html).toContain("Hung");
    expect(html).toContain("No verdict");
  });

  it("records an abandoned trial as abandoned", async () => {
    const run = await record({
      advocates: ["One.", "Two.", "server_error", "server_error"],
      judges: [GUILTY, GUILTY, GUILTY],
    });
    const html = buildExportHtml(run);

    expect(html).toContain("Trial abandoned");
    expect(html).toContain("The bench never heard this case.");
  });
});

describe("the file says what it is", () => {
  it("states that the judges are fictional simulations of real named people", async () => {
    const html = buildExportHtml(await record({ judges: [GUILTY, GUILTY, GUILTY] }));

    // The file circulates on its own, so this cannot live only in the app.
    expect(html).toMatch(/fictional simulations/i);
    expect(html).toMatch(/Supreme Court of Israel/i);
    expect(html).toMatch(/never happened/i);
  });

  it("is the same bytes for the same record", async () => {
    const run = await record({ judges: [GUILTY, GUILTY, NOT_GUILTY] });
    expect(buildExportHtml(run)).toBe(buildExportHtml(run));
  });
});
