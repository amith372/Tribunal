/**
 * export.ts — the run record as one self-contained HTML file.
 *
 * specs.md Part 3: the exported HTML file is the portable copy of a run — the one a
 * reader keeps and can submit, and the only trace that leaves this server at all. The
 * archive is durable, but it is ours; this file is theirs. It is therefore not a report
 * *about* a run, it is the run — the thing that shows the token numbers were read from
 * real responses and the verdicts were read from models rather than invented.
 *
 * Five properties it holds to:
 *
 *   1. **Self-contained.** Inline styles, one embedded font, no script, no image, no
 *      link to anywhere. It must open from disk with the server stopped and no network,
 *      so anything fetched at view time would be a broken file rather than a slow one.
 *
 *   2. **Pure, and the same source as the screen.** It takes a `RunRecord` and returns
 *      a string — no clock, no I/O. The panels render that same record, which is what
 *      makes Part 2's "its numbers match what the app showed" true by construction.
 *
 *   3. **It looks like the app that produced it.** Part 3 asks a reader to check the
 *      panels *against* this file, so the two must plainly be the same product: the same
 *      bronze frame around the same parchment sheet, the same crimson plate, the same two
 *      verdict colours, and the app's own display face carried inside the file rather
 *      than linked. The palette lives in `export-theme.ts`, which a test holds against
 *      `web/src/styles/tokens.css` so the two copies cannot quietly drift; the face is
 *      Cinzel, subsetted, in `export-font.ts` (see `scripts/embed-font.ts` for why the
 *      display face is embedded and the reading text is not).
 *
 *   4. **Everything from a model is escaped.** Up to 300 words of user charge sheet and
 *      seven model replies land in this file. All of it goes through `escapeHtml`, and
 *      there is no path that writes an unescaped value.
 *
 *   5. **An incomplete run is recorded as incomplete.** A missing advocate is named as
 *      missing and a bench that reached no verdict says so. A record that quietly
 *      looked complete would be worse than no record.
 */

import type { RunRecord } from "./aggregate.js";
import type { Attempt } from "./openrouter.js";
// The call table renders only what the browser is also shown, so it is typed against the
// view rather than the full attempt. `rawBlock` below still takes the whole thing — the
// raw body is exactly what the appendix exists to print.
import type { AttemptView } from "./record-view.js";
import type { JudgeOutcome } from "./judging.js";
import type { StatementOutcome } from "./statements.js";
import type { StageRollup } from "./summary.js";
import {
  advocatesNote,
  benchNote,
  bySide,
  closingLines,
  findingNote,
  headline,
  PANELS,
  number,
  price,
  runSubtitle,
  seconds,
  sideTone,
  stages,
  summaryRows,
  judgeNoAnswer,
  statementNoAnswer,
  usageOf,
  VERDICT_LABEL,
} from "./summary.js";
import { FONT_FAMILY, FONT_NOTICE, FONT_WOFF2_BASE64 } from "./export-font.js";
import { rootVariables } from "./export-theme.js";

/** The one way text enters this file. Ampersand first, or it double-escapes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A filename for a downloaded record: the defendant and when the run happened.
 *
 * The timestamp is what stops two exports of the same defendant landing on one another,
 * and it is the run's own start rather than the moment of download, so re-exporting a run
 * twice produces the same name for the same record.
 */
export function exportFileName(record: RunRecord): string {
  const who = record.defendant.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const when = record.startedAt.replace(/[:.]/g, "-").replace(/z$/i, "");
  return `tribunal-${who || "run"}-${when}.html`;
}

/** The asks behind a role that gave nothing — the same rows the call table lists. */
function triesList(lines: readonly string[]): string {
  return lines.length === 0
    ? ""
    : `<ul class="tries">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
}

function statementBlock(statement: StatementOutcome): string {
  const tone = sideTone(statement.side);
  const plaque = tone === "defense" ? "For the defense" : "For the prosecution";
  if (!statement.ok) {
    // An advocate that gave nothing accounts for itself here rather than pointing at the
    // table two sections down (`summary.ts`, `statementNoAnswer`, and specs.md Part 5):
    // every line below is the same attempt that table lists, said in words.
    const account = statementNoAnswer(statement);
    return `<article class="card missing side-${tone}">
      <h3 class="display">${escapeHtml(statement.name)}</h3>
      <p class="plaque ${tone}">${plaque}</p>
      <p class="absent">${escapeHtml(account.lead)}</p>
      ${triesList(account.attempts)}
    </article>`;
  }
  // The word cap is soft (specs.md Part 2): a reply that ran over is reported here exactly
  // as the panel reports it, and was never trimmed or re-asked for it.
  const flags: string[] = [];
  if (statement.overCap) flags.push(`over the ${statement.wordCap}-word cap`);
  if (statement.rescreened) flags.push("first reply refused as not a statement; this is the second");
  const usage = usageOf(statement.attempts);
  return `<article class="card side-${tone}">
    <h3 class="display">${escapeHtml(statement.name)}</h3>
    <p class="plaque ${tone}">${plaque}</p>
    <p class="speech">${escapeHtml(statement.text ?? "")}</p>
    <p class="meta">${escapeHtml(statement.model ?? "—")} · ${statement.words ?? 0} words${
      usage.tokens === null ? "" : ` · ${number(usage.tokens)} tokens`
    } · ${seconds(usage.elapsedMs)}${
      flags.length > 0 ? ` · ${escapeHtml(flags.join(" · "))}` : ""
    }</p>
  </article>`;
}

function judgeBlock(judge: JudgeOutcome): string {
  if (judge.verdict === null) {
    // A seat that did not rule gives its account here rather than pointing at the table two
    // sections down (`summary.ts`, `judgeNoAnswer`): the bench is the finding, and every
    // line below is the same attempt the table lists, said in words.
    const account = judgeNoAnswer(judge);
    return `<article class="card missing">
      <h3 class="display">${escapeHtml(judge.name)}</h3>
      <p class="absent">${escapeHtml(account.lead)}</p>
      ${triesList(account.attempts)}
    </article>`;
  }
  const usage = usageOf(judge.attempts);
  const notes: string[] = [`${judge.reasonCount} reason${judge.reasonCount === 1 ? "" : "s"}`];
  if (judge.thinReasoning) notes.push("thinner than the two asked for");
  if (judge.retryReason) notes.push(`retried once (${judge.retryReason.replace(/_/g, " ")})`);
  if (usage.tokens !== null) notes.push(`${number(usage.tokens)} tokens`);
  notes.push(seconds(usage.elapsedMs));
  return `<article class="card">
    <h3 class="display">${escapeHtml(judge.name)}</h3>
    <p class="display verdict ${judge.verdict === "guilty" ? "guilty" : "acquitted"}">${
      VERDICT_LABEL[judge.verdict]
    }</p>
    <p class="speech">${escapeHtml(judge.reasoning)}</p>
    <p class="meta">${escapeHtml(judge.model ?? "—")} · ${escapeHtml(notes.join(" · "))}</p>
  </article>`;
}

/** One seat as it appears on the finding section: name over verdict, nothing else. */
function seatChip(judge: JudgeOutcome): string {
  const verdict =
    judge.verdict === null
      ? `<div class="absent">No readable verdict</div>`
      : `<div class="display verdict ${judge.verdict === "guilty" ? "guilty" : "acquitted"}">${
          VERDICT_LABEL[judge.verdict]
        }</div>`;
  return `<div class="seat"><div class="seat-name">${escapeHtml(judge.name)}</div>${verdict}</div>`;
}

function attemptRow(attempt: AttemptView): string {
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

/**
 * One wave of the run: a caption, its calls, and its own totals directly beneath them.
 *
 * The same grouping the results panel shows, so the two tables can be read side by side.
 * The wave's time is its calls summed rather than its wall clock — the calls in a wave
 * overlap, and the caption says so.
 */
function stageRows(wave: StageRollup): string {
  return `<tbody>
  <tr class="stage"><td colspan="10">${escapeHtml(wave.caption)}</td></tr>
  ${wave.attempts.map(attemptRow).join("\n")}
  <tr class="subtotal">
    <td colspan="3">${wave.attempts.length} call${wave.attempts.length === 1 ? "" : "s"}${
      wave.failed > 0 ? `, ${wave.failed} failed` : ""
    }</td>
    <td class="n">${number(wave.promptTokens)}</td>
    <td class="n">${number(wave.completionTokens)}</td>
    <td class="n">${number(wave.reasoningTokens)}</td>
    <td class="n">${number(wave.totalTokens)}</td>
    <td class="n">${price(wave.costUsd)}</td>
    <td class="n">${seconds(wave.elapsedMs)}</td>
    <td></td>
  </tr>
</tbody>`;
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

/** The scales, drawn rather than fetched — the same mark the app's masthead carries. */
const SCALES = `<svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 7.5 L16 27"/><path d="M10.5 27 L21.5 27"/><path d="M6 10.5 L26 10.5"/><path d="M6 10.5 L2.8 18"/><path d="M6 10.5 L9.2 18"/><path d="M2.8 18 A3.2 3.2 0 0 0 9.2 18"/><path d="M26 10.5 L22.8 18"/><path d="M26 10.5 L29.2 18"/><path d="M22.8 18 A3.2 3.2 0 0 0 29.2 18"/><circle cx="16" cy="5.6" r="1.7"/></svg>`;

/** The gold rule under the verdict, from the results canvas. Two lines and a lozenge. */
const GOLD_RULE = `<svg class="rule" width="240" height="16" viewBox="0 0 240 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M4 8 L104 8"/><path d="M136 8 L236 8"/><path d="M120 2.5 L125.5 8 L120 13.5 L114.5 8 Z" fill="currentColor" stroke="none"/><circle cx="108.5" cy="8" r="1.6" fill="currentColor" stroke="none"/><circle cx="131.5" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>`;

/**
 * The whole stylesheet, built from the same tokens the four screens are drawn from.
 *
 * Three families in the app; two here. Cinzel is embedded and carries the wordmark, the
 * headings and the verdicts. EB Garamond is not, and the body falls back to the closest
 * old-style serif the machine already has — the decision logged on 2026-08-23, and the
 * reason it is the *display* face that travels: the verdict is what a reader looks at.
 * The monospace stack is whatever the machine has, as it is in the app.
 */
const STYLES = `
@font-face {
  font-family: "${FONT_FAMILY}";
  font-style: normal;
  /* One embedded weight, claimed across the range so nothing is synthesised from it. */
  font-weight: 400 700;
  font-display: swap;
  src: url(data:font/woff2;base64,${FONT_WOFF2_BASE64}) format("woff2");
}

:root {
  color-scheme: light;
${rootVariables()}
  --font-display: "${FONT_FAMILY}", "Iowan Old Style", Palatino, Georgia, serif;
  --font-text: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 22px 15px 40px;
  color: var(--ink);
  font: 17px/1.65 var(--font-text);
  background: linear-gradient(180deg, var(--frame-1) 0%, var(--frame-2) 16%, var(--frame-3) 50%, var(--frame-2) 84%, var(--frame-1) 100%);
  background-attachment: fixed;
}

.display { font-family: var(--font-display); }

/* The parchment sheet inside the bronze frame — the shape every screen of the app is
 * drawn on, so the record and the app are visibly one product. */
.sheet {
  max-width: 62rem;
  margin: 0 auto;
  border: 2px solid var(--frame-edge);
  border-radius: 4px;
  overflow: hidden;
  background: linear-gradient(180deg, var(--sheet-1) 0%, var(--sheet-2) 24%, var(--sheet-3) 58%, var(--sheet-3) 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 241, 205, 0.45), 0 6px 22px rgba(0, 0, 0, 0.4);
}

.body { padding: 26px 34px 30px; }

/* The crimson masthead plate, as on every screen. */
header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 34px 18px;
  color: var(--ink-on-plate);
  background: linear-gradient(180deg, var(--crimson-1) 0%, var(--crimson-2) 55%, var(--crimson-3) 100%);
  border-bottom: 2px solid var(--gold-rule);
  box-shadow: inset 0 1px 0 rgba(255, 220, 180, 0.28);
}

header svg { color: var(--scales); flex-shrink: 0; }

h1 {
  margin: 0 0 3px;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
}

.sub { margin: 0; font-size: 14px; color: var(--masthead-sub); }

h2 {
  margin: 30px 0 12px;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  color: var(--crimson-1);
}

h3 { margin: 0 0 2px; font-size: 18px; font-weight: 600; }

/* The verdict block: the app's first results panel, at rest. */
.outcome {
  margin: 4px 0 20px;
  padding: 24px 30px 26px;
  text-align: center;
  border: 2px solid var(--crimson-1);
  border-radius: 5px;
  background: var(--panel);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6), 0 3px 10px rgba(120, 60, 20, 0.22);
}

.outcome .label {
  font-family: var(--font-display);
  font-size: 13px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--faint);
}

.outcome .title {
  margin: 8px 0 0;
  font-family: var(--font-display);
  font-size: 64px;
  line-height: 1.05;
  letter-spacing: 0.03em;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
}

.outcome .rule { display: block; margin: 6px auto 2px; color: var(--gold); }
.outcome .detail { margin: 0; font-size: 19px; color: var(--muted); }

.guilty { color: var(--guilty); }
.acquitted { color: var(--acquitted); }
.unresolved { color: var(--gold-deep); }

.banner {
  margin: 12px 0;
  padding: 13px 18px;
  border: 1px solid var(--chip-thinking-border);
  border-left: 4px solid var(--gold);
  border-radius: 4px;
  background: var(--highlight);
  color: var(--muted);
  font-size: 15px;
}

.grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  align-items: start;
}

/* Defense left, prosecution right — the order Side Select, the trial screen and the
 * results panels all hold, so a side is in one place across the whole app. */
.sides { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; align-items: start; }
.side { display: flex; flex-direction: column; gap: 14px; }

.card {
  padding: 16px 20px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
  box-shadow: inset 0 1px 3px rgba(120, 95, 55, 0.1);
}

.card.side-defense { border-top: 3px solid var(--acquitted); }
.card.side-prosecution { border-top: 3px solid var(--guilty); }

.card.missing { background: var(--panel-inset); border-style: dashed; }
.card.missing.side-defense, .card.missing.side-prosecution { border-top-style: solid; }

/* The asks behind a seat that never ruled: the call table's own rows, in mono so they read
 * as machine record rather than as prose about the case. */
.tries {
  margin: 10px 0 0;
  padding: 9px 0 0;
  border-top: 1px solid var(--hairline);
  list-style: none;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--faint);
  word-break: break-word;
}

.plaque {
  margin: 0 0 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.plaque.defense { color: var(--acquitted); }
.plaque.prosecution { color: var(--guilty); }

.speech { margin: 8px 0 0; white-space: pre-wrap; text-wrap: pretty; }
.absent { margin: 8px 0 0; color: var(--gold-deep); font-style: italic; }

.verdict { margin: 4px 0 6px; font-size: 22px; }

.meta {
  margin: 12px 0 0;
  padding-top: 9px;
  border-top: 1px solid var(--hairline);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--faint);
  word-break: break-word;
}

/* The call table: crimson plate for the head, a stripe every other row, mono throughout —
 * so what came back from the API never looks hand-written. */
.scroll {
  overflow-x: auto;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--panel);
  box-shadow: 0 2px 5px rgba(120, 95, 55, 0.16);
}

table { border-collapse: collapse; width: 100%; font-family: var(--font-mono); font-size: 12.5px; }
th, td { border-bottom: 1px solid var(--hairline); padding: 9px 10px; text-align: left; white-space: nowrap; }
th {
  background: linear-gradient(180deg, #a52424, #7a1515);
  color: var(--ink-on-plate);
  font-weight: 600;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--gold-rule);
}
td.n, th.n { text-align: right; }
tbody tr:nth-child(even) td { background: var(--panel-stripe); }
tr.failed td { color: var(--guilty); }
tfoot td { font-weight: 700; border-top: 2px solid var(--tile-border-accused); border-bottom: none; background: var(--panel-inset); }

details {
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
}
summary {
  cursor: pointer;
  padding: 9px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
}
pre {
  margin: 0;
  padding: 12px;
  background: var(--panel-inset);
  border-top: 1px solid var(--hairline);
  overflow-x: auto;
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- the five sections ------------------------------------------------------------------
 * Each is one of the app's results panels, laid out as a section of a document rather than
 * as a slide: there is no script in this file, so nothing can be paged through. The eyebrow
 * above each heading says which panel it is, so a reader holding the file against the screen
 * knows where they are without counting.
 */
.panel {
  padding-bottom: 26px;
  margin-bottom: 26px;
  border-bottom: 1px solid var(--border);
}

.panel:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }

.mark {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--faint);
}

.panel h2 { margin-top: 4px; }

/* The three seats under the finding: name over verdict, and nothing else to read. */
.seats {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  margin-bottom: 14px;
}

.seat {
  padding: 12px 18px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
}

.seat-name { font-size: 15px; color: var(--muted); }
.seat .verdict { font-size: 19px; margin: 2px 0 0; }
.seat .absent { margin: 2px 0 0; font-size: 14px; }

.charge {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 16px 22px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--crimson-1);
  border-radius: 4px;
  background: var(--panel);
}

.charge-label {
  flex-shrink: 0;
  padding-top: 3px;
  font-size: 14px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--crimson-1);
  white-space: nowrap;
}

.charge .speech { margin: 0; }

.note { margin: 14px 0 0; font-size: 14px; color: var(--muted); }

.callout {
  margin: 14px 0 0;
  padding: 12px 18px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel-inset);
  font-size: 14.5px;
  color: var(--muted);
}

/* The wave caption, and the wave's own totals directly under the calls they add up. */
tr.stage td {
  background: var(--panel-inset);
  color: var(--crimson-1);
  font-family: var(--font-display);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

tr.subtotal td {
  background: var(--panel-inset);
  font-weight: 700;
  border-top: 1px solid var(--border-strong);
}

/* In closing. */
.closing {
  padding: 22px 30px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
  text-align: center;
}

.closing .lead { margin: 0; font-size: 21px; line-height: 1.6; text-wrap: pretty; }
.closing-note { margin: 12px 0 0; font-size: 16px; color: var(--muted); text-wrap: pretty; }

.facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 36px;
  margin: 16px 0 0;
  padding: 16px 26px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel-inset);
}

.fact {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--hairline);
}

.fact dt {
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--crimson-1);
  white-space: nowrap;
}

.fact dd { margin: 0; font-size: 16px; text-align: right; }

.appendix .note { max-width: 44em; margin-bottom: 14px; }

footer {
  margin-top: 30px;
  padding: 18px 34px 22px;
  border-top: 1px solid var(--border);
  background: rgba(232, 220, 186, 0.75);
  color: var(--muted);
  font-size: 14px;
}

footer p { margin: 0 0 10px; }
footer p:last-child { margin-bottom: 0; }
footer .licence { font-family: var(--font-mono); font-size: 11px; color: var(--faint); }

@media (max-width: 720px) {
  body { padding: 8px 8px 24px; }
  .body { padding: 18px 16px 22px; }
  header { padding: 16px 16px 14px; }
  footer { padding: 16px; }
  .sides { grid-template-columns: 1fr; }
  .facts { grid-template-columns: 1fr; }
  .outcome .title { font-size: 44px; }
}

@media print {
  body { background: #fff; padding: 0; }
  .sheet { border: none; box-shadow: none; max-width: none; }
  .card, details, .fact { break-inside: avoid; }
  /* One panel to a page, so the printed record pages the way the screen does. */
  .panel { break-after: page; border-bottom: none; }
  .panel:last-child { break-after: auto; }
}
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
  if (record.benchLineage.length > 0) {
    notices.push(
      `Two seats on the bench answered on models from one maker: ${record.benchLineage
        .map((c) => `${escapeHtml(c.maker)} (${c.judges.map(escapeHtml).join(", ")})`)
        .join("; ")}. Judges built from shared weights can agree for reasons that are not judicial.`,
    );
  }
  if (totals.usageMissing) {
    notices.push("At least one call reported no token usage, so the totals below are a floor.");
  }

  const { defense, prosecution } = bySide(record.statements);
  const closing = closingLines(record);
  const waves = stages(record);
  const section = (index: number): string =>
    `<div class="mark mono">Panel ${index + 1} of ${PANELS.length}</div>
<h2>${escapeHtml(PANELS[index].heading)}</h2>`;

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
  ${SCALES}
  <div>
    <h1>The Tribunal</h1>
    <p class="sub">${escapeHtml(runSubtitle(record))}</p>
  </div>
</header>

<div class="body">

<!-- The five sections below are the app's five results panels, in the app's own order and
     under the app's own headings, so that this file can be read against the screen that
     produced it one panel at a time (specs.md Part 3). What follows them is an appendix:
     the raw responses, which have no panel because no screen shows them. -->

<section class="panel">
${section(0)}
<div class="outcome">
  <div class="label">The tribunal finds</div>
  <p class="title ${head.tone}">${escapeHtml(head.title)}</p>
  ${GOLD_RULE}
  <p class="detail">${escapeHtml(head.detail)}</p>
</div>

${notices.map((notice) => `<p class="banner">${notice}</p>`).join("\n")}

<div class="seats">${record.judges.map(seatChip).join("\n")}</div>

<div class="charge">
  <span class="display charge-label">The charge</span>
  <div>
    <p class="speech">${escapeHtml(record.chargeSheet)}</p>
    <p class="meta">${record.chargeSheetWords} words · ${escapeHtml(
      record.defendant.name,
    )}, the accused, never argues</p>
  </div>
</div>

<p class="note">${escapeHtml(findingNote())}</p>
</section>

<section class="panel">
${section(1)}
<div class="grid">${
    record.judges.length > 0
      ? record.judges.map(judgeBlock).join("\n")
      : `<article class="card missing"><p class="absent">The bench never heard this case.</p></article>`
  }</div>
<p class="callout">${escapeHtml(benchNote(record.mode))}</p>
</section>

<section class="panel">
${section(2)}
<div class="sides">
  <div class="side">${defense.map(statementBlock).join("\n")}</div>
  <div class="side">${prosecution.map(statementBlock).join("\n")}</div>
</div>
<p class="callout">${escapeHtml(advocatesNote())}</p>
</section>

<section class="panel">
${section(3)}
<div class="scroll"><table>
<thead><tr>
  <th>role</th><th>try</th><th>model</th>
  <th class="n">prompt</th><th class="n">answer</th><th class="n">thinking</th>
  <th class="n">total</th><th class="n">price</th><th class="n">time</th><th>result</th>
</tr></thead>
${waves.map(stageRows).join("\n")}
<tfoot><tr>
  <td colspan="3">${totals.calls} call${totals.calls === 1 ? "" : "s"} · the whole run</td>
  <td class="n">${number(totals.promptTokens)}</td>
  <td class="n">${number(totals.completionTokens)}</td>
  <td class="n">${number(totals.reasoningTokens)}</td>
  <td class="n">${number(totals.totalTokens)}</td>
  <td class="n">${price(totals.costUsd)}</td>
  <td class="n">${seconds(totals.elapsedMs)}</td>
  <td></td>
</tr></tfoot>
</table></div>
</section>

<section class="panel">
${section(4)}
<div class="closing">
  <p class="lead">${escapeHtml(closing.lead)}</p>
  ${closing.note === "" ? "" : `<p class="closing-note">${escapeHtml(closing.note)}</p>`}
</div>
<dl class="facts">${summaryRows(record)
    .map(
      (row) =>
        `<div class="fact"><dt class="display">${escapeHtml(row.label)}</dt><dd${
          row.tone ? ` class="display ${row.tone}"` : ""
        }>${escapeHtml(row.value)}</dd></div>`,
    )
    .join("\n")}</dl>
</section>

<section class="panel appendix">
<div class="mark mono">Appendix · not a panel</div>
<h2>Raw responses</h2>
<p class="note">Every reply as it arrived, including the failures. No screen shows these;
they are here because a record of what a model returned is the only thing that makes the
numbers above checkable rather than merely stated.</p>
${record.attempts.map(rawBlock).join("\n")}
</section>

</div>

<footer>
  <p>The three judges are <strong>fictional simulations</strong>, written for this
  exercise and given the names of real justices of the Supreme Court of Israel. Their
  reasoning habits were adapted from published opinions; nothing here represents anything
  those people said, wrote, or would say, and none of it predicts how any of them would
  decide anything. The defendant and the advocates are fictional characters, and the
  trial never happened.</p>
  <p>Every model call in this run used a free model. Token counts and prices are read
  from the API's own response, never estimated. Run started ${escapeHtml(
    record.startedAt,
  )}, finished ${escapeHtml(record.finishedAt)}.</p>
  <p class="licence">${escapeHtml(FONT_NOTICE)}</p>
</footer>

</div>
</body>
</html>
`;
}
