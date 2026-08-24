/**
 * The exported record and the app it came from are the same product — checked, not trusted.
 *
 * specs.md Part 3 asks a reader to check the app's panels *against* the exported file, and
 * a record that looks like a different product invites exactly the doubt the file exists to
 * remove. Holding that means the export carries a copy of the app's palette, because it has
 * to open from disk with nothing to link to — and two copies of a palette is a drift waiting
 * to happen. This is the test that makes the second copy safe: change a colour in
 * `tokens.css` and the export's copy goes red, naming the token.
 *
 * The rest of the file guards the other half of the same decision (logged 2026-08-23): the
 * *display* face travels inside the document, the reading face does not, and neither of them
 * is fetched — because a record that needs the network is not a record.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { aggregate, type RunRecord } from "../aggregate.js";
import { buildExportHtml } from "../export.js";
import { EXPORT_TOKENS } from "../export-theme.js";
import { FONT_FAMILY, FONT_WOFF2_BASE64 } from "../export-font.js";
import { resolveRunModels } from "../config.js";
import { loadData } from "../data.js";
import { runJudging } from "../judging.js";
import { preflight } from "../preflight.js";
import { runStatements, toDeliveredStatements } from "../statements.js";
import { scriptedCaller } from "./fake-caller.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(
  resolve(join(here, "..", "..", "..", "web", "src", "styles", "tokens.css")),
  "utf8",
);

/** Every `--name: value;` the browser's stylesheet declares, as a map. */
function declaredTokens(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    found.set(match[1], match[2].trim());
  }
  return found;
}

const data = loadData();

async function part4Record(): Promise<RunRecord> {
  const check = preflight(
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
    data,
  );
  if (!check.ok) throw new Error("Part 4's case must pass pre-flight");
  const run = check.run;
  const models = resolveRunModels("per-role");

  const script: Record<string, readonly string[]> = {};
  run.advocates.forEach((advocate) => {
    script[`advocate:${advocate.character.id}`] = ["The realm was already burning."];
  });
  data.judges.forEach((judge) => {
    script[`judge:${judge.id}`] = [
      '{"verdict": "guilty", "reasoning": "He swore an oath. He broke it himself."}',
    ];
  });

  const caller = scriptedCaller(script);
  const statements = await runStatements({
    run,
    data,
    mode: "per-role",
    models: models.advocates,
    call: caller.call,
  });
  const judging = await runJudging({
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

describe("the record wears the app's palette, and the two cannot drift apart", () => {
  const browser = declaredTokens(tokensCss);

  it.each(Object.entries(EXPORT_TOKENS))(
    "--%s is the same colour in the export as in tokens.css",
    (name, value) => {
      // A token the export names and the browser no longer declares is the same failure as
      // one whose value changed: the two stopped being one palette.
      const inBrowser = browser.get(name);
      expect(
        inBrowser,
        inBrowser === undefined
          ? `--${name} is no longer declared in web/src/styles/tokens.css`
          : `--${name} has drifted: tokens.css says ${inBrowser}, the export says ${value}`,
      ).toBe(value);
    },
  );

  it("writes every one of them into the document it renders", async () => {
    const html = buildExportHtml(await part4Record());
    for (const [name, value] of Object.entries(EXPORT_TOKENS)) {
      expect(html).toContain(`--${name}: ${value};`);
    }
  });

  it("uses the two verdict colours the app uses, and no others for a verdict", async () => {
    const html = buildExportHtml(await part4Record());
    expect(html).toContain(".guilty { color: var(--guilty); }");
    expect(html).toContain(".acquitted { color: var(--acquitted); }");
  });
});

describe("the display face travels inside the file", () => {
  it("embeds the subsetted face rather than linking it", async () => {
    const html = buildExportHtml(await part4Record());
    expect(html).toContain(`font-family: "${FONT_FAMILY}"`);
    expect(html).toContain("src: url(data:font/woff2;base64,");
    expect(html).toContain(FONT_WOFF2_BASE64);
  });

  it("is a real WOFF2, and small enough to carry on every export", () => {
    const bytes = Buffer.from(FONT_WOFF2_BASE64, "base64");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
    // The decision that embedded it also fixed its price: a subset, not the whole family.
    expect(bytes.length).toBeLessThan(40 * 1024);
  });

  it("lets the reading text fall back, so only one face is paid for", async () => {
    const html = buildExportHtml(await part4Record());
    // EB Garamond is the app's reading face and is deliberately not embedded.
    expect(html).not.toContain("EB Garamond");
    expect(html).toContain('--font-text: "Iowan Old Style"');
  });

  it("carries the licence the font travels under", async () => {
    const html = buildExportHtml(await part4Record());
    expect(html).toMatch(/SIL Open Font License/);
  });

  it("still fetches nothing at view time, font included", async () => {
    const html = buildExportHtml(await part4Record());
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/<script/i);
    // The embedded face is the document's only `url(...)`, and it points at itself.
    const targets = [...html.matchAll(/url\(([^)]*)\)/g)].map(([, target]) => target);
    expect(targets).toHaveLength(1);
    expect(targets[0].startsWith("data:font/woff2;base64,")).toBe(true);
  });

  it("survives a raw response that contains a link, without following it", async () => {
    /**
     * A real failure from a free model carries advice with a URL in it. That text is the
     * audit trail Part 3 requires, so it is kept exactly as it came — escaped, inside a
     * `<pre>`, and unreachable. What must stay true is that the *document* still has
     * nothing to fetch.
     */
    const base = await part4Record();
    const withLink: RunRecord = {
      ...base,
      attempts: base.attempts.map((attempt, index) =>
        index === 0
          ? { ...attempt, raw: { error: "Rate limited. Add a key: https://openrouter.ai/keys" } }
          : attempt,
      ),
    };
    const html = buildExportHtml(withLink);

    expect(html).toContain("https://openrouter.ai/keys");
    expect(html).not.toMatch(/<a\s/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/\ssrc=/i);
    const [document] = html.split("<h2>Raw responses</h2>");
    expect(document).not.toMatch(/https?:\/\//i);
  });
});
