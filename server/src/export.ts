/**
 * export.ts — the run record as one self-contained HTML file.
 *
 * specs.md Part 3: "There is no database; the exported HTML file is the run record."
 * This is therefore not a report *about* a run, it is the only durable trace one leaves
 * — the thing that shows the token numbers were read from real responses and the
 * verdicts were read from models rather than invented.
 *
 * Four properties it holds to:
 *
 *   1. **Self-contained.** Inline styles, system fonts, no script, no image, no link
 *      to anywhere. It must open from disk with the server stopped and no network, so
 *      anything fetched at view time would be a broken file rather than a slow one.
 *
 *   2. **Pure, and the same source as the screen.** It takes a `RunRecord` and returns
 *      a string — no clock, no I/O. The panels render that same record, which is what
 *      makes Part 2's "its numbers match what the app showed" true by construction.
 *
 *   3. **Everything from a model is escaped.** Up to 200 words of user charge sheet and
 *      seven model replies land in this file. All of it goes through `escapeHtml`, and
 *      there is no path that writes an unescaped value.
 *
 *   4. **An incomplete run is recorded as incomplete.** A missing advocate is named as
 *      missing and a bench that reached no verdict says so. A record that quietly
 *      looked complete would be worse than no record.
 */

import type { RunRecord } from "./aggregate.js";
import type { Attempt } from "./openrouter.js";
import type { JudgeOutcome } from "./judging.js";
import type { StatementOutcome } from "./statements.js";
import { SIDE_NAME } from "./prompts.js";

/** The one way text enters this file. Ampersand first, or it double-escapes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const VERDICT_LABEL: Record<string, string> = {
  guilty: "Guilty",
  not_guilty: "Not guilty",
};

const number = (n: number): string => n.toLocaleString("en-US");

/** $0 while only free models are used — computed, never asserted (specs.md Part 2). */
const price = (usd: number): string => (usd === 0 ? "$0" : `$${usd.toFixed(6)}`);

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

function headline(record: RunRecord): { title: string; detail: string; tone: string } {
  const { outcome } = record;
  switch (outcome.kind) {
    case "verdict":
      return {
        title: VERDICT_LABEL[outcome.verdict],
        detail: `${outcome.tally.guilty}–${outcome.tally.notGuilty} on a bench of three`,
        tone: outcome.verdict === "guilty" ? "guilty" : "acquitted",
      };
    case "hung":
      return { title: "Hung", detail: "One against one; the third seat returned nothing.", tone: "unresolved" };
    case "inconclusive":
      return { title: "Inconclusive", detail: outcome.why, tone: "unresolved" };
    case "aborted":
      return { title: "Trial abandoned", detail: outcome.message, tone: "unresolved" };
  }
}

function statementBlock(statement: StatementOutcome): string {
  const side = SIDE_NAME[statement.side];
  if (!statement.ok) {
    return `<article class="card missing">
      <h3>${escapeHtml(statement.name)} <span class="side">for ${escapeHtml(side)}</span></h3>
      <p class="absent">No statement was delivered. ${escapeHtml(statement.error ?? "The call failed.")}</p>
    </article>`;
  }
  // Over-length is recorded on the statement but deliberately not surfaced: the models
  // hold the prompt cap in practice, and a warning nobody acts on is noise in a record.
  const flags: string[] = [];
  if (statement.rescreened) flags.push("first reply refused as not a statement; this is the second");
  return `<article class="card">
    <h3>${escapeHtml(statement.name)} <span class="side">for ${escapeHtml(side)}</span></h3>
    <p class="speech">${escapeHtml(statement.text ?? "")}</p>
    <p class="meta">${escapeHtml(statement.model ?? "—")} · ${statement.words ?? 0} words${
      flags.length > 0 ? ` · ${escapeHtml(flags.join(" · "))}` : ""
    }</p>
  </article>`;
}

function judgeBlock(judge: JudgeOutcome): string {
  if (judge.verdict === null) {
    return `<article class="card missing">
      <h3>${escapeHtml(judge.name)}</h3>
      <p class="absent">No verdict. ${escapeHtml(judge.error ?? "The reply could not be read.")}</p>
      <p class="meta">${escapeHtml(judge.model ?? "—")}</p>
    </article>`;
  }
  const notes: string[] = [`${judge.reasonCount} reason${judge.reasonCount === 1 ? "" : "s"}`];
  if (judge.thinReasoning) notes.push("thinner than the two asked for");
  if (judge.retryReason) notes.push(`retried once (${judge.retryReason.replace(/_/g, " ")})`);
  return `<article class="card">
    <h3>${escapeHtml(judge.name)}</h3>
    <p class="verdict ${judge.verdict === "guilty" ? "guilty" : "acquitted"}">${
      VERDICT_LABEL[judge.verdict]
    }</p>
    <p class="speech">${escapeHtml(judge.reasoning)}</p>
    <p class="meta">${escapeHtml(judge.model ?? "—")} · ${escapeHtml(notes.join(" · "))}</p>
  </article>`;
}

function attemptRow(attempt: Attempt): string {
  const usage = attempt.usage;
  return `<tr class="${attempt.ok ? "" : "failed"}">
    <td>${escapeHtml(attempt.label)}</td>
    <td>${attempt.attempt}${attempt.isRetry ? " (retry)" : ""}</td>
    <td>${escapeHtml(attempt.respondedModel ?? attempt.requestedModel)}</td>
    <td class="n">${usage.promptTokens === null ? "—" : number(usage.promptTokens)}</td>
    <td class="n">${usage.completionTokens === null ? "—" : number(usage.completionTokens)}</td>
    <td class="n">${usage.reasoningTokens === null ? "—" : number(usage.reasoningTokens)}</td>
    <td class="n">${usage.totalTokens === null ? "—" : number(usage.totalTokens)}</td>
    <td class="n">${price(usage.costUsd ?? 0)}</td>
    <td class="n">${seconds(attempt.elapsedMs)}</td>
    <td>${attempt.ok ? "ok" : escapeHtml(attempt.errorKind ?? "failed")}</td>
  </tr>`;
}

function rawBlock(attempt: Attempt, index: number): string {
  let body: string;
  try {
    body = attempt.raw === null ? "(nothing recorded)" : JSON.stringify(attempt.raw, null, 2);
  } catch {
    body = "(response could not be serialised)";
  }
  return `<details>
    <summary>${index + 1}. ${escapeHtml(attempt.label)} — ${escapeHtml(
      attempt.respondedModel ?? attempt.requestedModel,
    )}</summary>
    <pre>${escapeHtml(body)}</pre>
  </details>`;
}

const STYLES = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2.5rem 1.25rem 4rem;
  background: #f4efe6; color: #2e2620;
  font: 16px/1.65 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
}
.sheet { max-width: 60rem; margin: 0 auto; }
header { border-bottom: 2px solid #8c7355; padding-bottom: 1.5rem; margin-bottom: 2rem; }
h1 { font-size: 2.5rem; margin: 0 0 .25rem; letter-spacing: .01em; }
h2 { font-size: 1.35rem; margin: 2.5rem 0 1rem; border-bottom: 1px solid #d8ccb8; padding-bottom: .4rem; }
h3 { font-size: 1.05rem; margin: 0 0 .5rem; }
.sub { color: #6b5c4a; margin: 0; }
.outcome { margin: 1.75rem 0; padding: 1.5rem; border: 2px solid #8c7355; background: #fffdf8; text-align: center; }
.outcome .title { font-size: 2.75rem; margin: 0; }
.outcome .detail { color: #6b5c4a; margin: .35rem 0 0; }
.guilty { color: #8a2b20; }
.acquitted { color: #2f5d3f; }
.unresolved { color: #7a6535; }
.banner { padding: .85rem 1.1rem; border-left: 4px solid #a8842c; background: #fdf6e3; margin: 1.25rem 0; }
.grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); }
.card { border: 1px solid #d8ccb8; background: #fffdf8; padding: 1.1rem 1.2rem; }
.card.missing { background: #f7f2ea; border-style: dashed; }
.side { font-weight: normal; color: #6b5c4a; font-size: .9rem; }
.speech { margin: .5rem 0; white-space: pre-wrap; }
.absent { margin: .5rem 0; color: #7a6535; font-style: italic; }
.verdict { font-size: 1.3rem; margin: .25rem 0 .5rem; }
.meta { font-size: .82rem; color: #6b5c4a; margin: .6rem 0 0; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; word-break: break-word; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .85rem; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
th, td { border-bottom: 1px solid #e0d6c4; padding: .45rem .6rem; text-align: left; white-space: nowrap; }
th { background: #ece3d4; }
td.n, th.n { text-align: right; }
tr.failed td { color: #8a2b20; }
tfoot td { font-weight: bold; border-top: 2px solid #8c7355; }
details { border: 1px solid #d8ccb8; background: #fffdf8; margin-bottom: .5rem; }
summary { cursor: pointer; padding: .6rem .8rem; font-size: .85rem; font-family: ui-monospace, Menlo, Consolas, monospace; }
pre { margin: 0; padding: .8rem; background: #f7f2ea; overflow-x: auto; font-size: .78rem; white-space: pre-wrap; word-break: break-word; }
footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid #d8ccb8; color: #6b5c4a; font-size: .85rem; }
@media print { body { background: #fff; } .card, details { break-inside: avoid; } }
`;

/** Renders one run as a standalone document. Pure: same record, same bytes. */
export function buildExportHtml(record: RunRecord): string {
  const head = headline(record);
  const missing = record.statements.filter((statement) => !statement.ok);
  const totals = record.totals;

  const notices: string[] = [];
  if (record.outcome.kind === "aborted") {
    notices.push(`This trial was abandoned before the bench heard it. ${escapeHtml(record.outcome.message)}`);
  } else if (!record.complete) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `${missing.map((s) => escapeHtml(s.name)).join(" and ")} delivered no statement`,
      );
    }
    if (record.tally.failed > 0) {
      parts.push(`${record.tally.failed} of three judges returned no verdict`);
    }
    notices.push(`This is an incomplete trial: ${parts.join("; ")}.`);
  }
  if (record.collisions.length > 0) {
    notices.push(
      `Two or more roles ran on the same model: ${record.collisions
        .map((c) => `${escapeHtml(c.model)} (${c.roles.map(escapeHtml).join(", ")})`)
        .join("; ")}.`,
    );
  }
  if (totals.usageMissing) {
    notices.push("At least one call reported no token usage, so the totals below are a floor.");
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Tribunal — ${escapeHtml(record.defendant.name)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="sheet">

<header>
  <h1>The Tribunal</h1>
  <p class="sub">${escapeHtml(record.defendant.name)}, defendant · ${escapeHtml(
    record.startedAt,
  )} · ${escapeHtml(record.mode)} mode</p>
</header>

<div class="outcome">
  <p class="title ${head.tone}">${escapeHtml(head.title)}</p>
  <p class="detail">${escapeHtml(head.detail)}</p>
</div>

${notices.map((notice) => `<p class="banner">${notice}</p>`).join("\n")}

<h2>The charge</h2>
<div class="card"><p class="speech">${escapeHtml(record.chargeSheet)}</p>
<p class="meta">${record.chargeSheetWords} words</p></div>

<h2>The casting</h2>
<div class="card"><p class="speech">${record.casting
    .map((c) => `${escapeHtml(c.name)} — ${escapeHtml(SIDE_NAME[c.side])}`)
    .join("\n")}</p></div>

<h2>The statements</h2>
<div class="grid">${record.statements.map(statementBlock).join("\n")}</div>

<h2>The bench</h2>
<div class="grid">${
    record.judges.length > 0
      ? record.judges.map(judgeBlock).join("\n")
      : `<article class="card missing"><p class="absent">The bench never heard this case.</p></article>`
  }</div>

<h2>Every call</h2>
<div class="scroll"><table>
<thead><tr>
  <th>role</th><th>attempt</th><th>model</th>
  <th class="n">prompt</th><th class="n">completion</th><th class="n">reasoning</th>
  <th class="n">total</th><th class="n">price</th><th class="n">time</th><th>result</th>
</tr></thead>
<tbody>${record.attempts.map(attemptRow).join("\n")}</tbody>
<tfoot><tr>
  <td colspan="3">${totals.calls} call${totals.calls === 1 ? "" : "s"}</td>
  <td class="n">${number(totals.promptTokens)}</td>
  <td class="n">${number(totals.completionTokens)}</td>
  <td class="n">${number(totals.reasoningTokens)}</td>
  <td class="n">${number(totals.totalTokens)}</td>
  <td class="n">${price(totals.costUsd)}</td>
  <td class="n">${seconds(totals.elapsedMs)}</td>
  <td></td>
</tr></tfoot>
</table></div>

<h2>Raw responses</h2>
${record.attempts.map(rawBlock).join("\n")}

<footer>
  <p>The three judges are <strong>fictional simulations</strong>, written for this
  exercise and given the names of real presidents of the Supreme Court of Israel. Nothing
  here represents anything those people said, wrote, or would say. The defendant and the
  advocates are fictional characters, and the trial never happened.</p>
  <p>Every model call in this run used a free model. Token counts and prices are read
  from the API's own response, never estimated. Run started ${escapeHtml(
    record.startedAt,
  )}, finished ${escapeHtml(record.finishedAt)}.</p>
</footer>

</div>
</body>
</html>
`;
}
