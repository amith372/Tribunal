import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { AppFrame } from "../components/AppFrame.js";
import { Button } from "../components/Button.js";
import { CharacterTile } from "../components/CharacterTile.js";
import { JudgePortrait } from "../components/JudgePortrait.js";
import { Masthead } from "../components/Masthead.js";
import { Panel } from "../components/Panel.js";
import type { Attempt, JudgeView, RunRecordView, StatementView } from "../api.js";
import { rememberArchivedRun } from "../run-memory.js";
import type { RunSession } from "../run-session.js";
import { exportOf, saveExport, type ExportedRecord } from "../run-export.js";
import {
  advocatesNote,
  benchNote,
  bySide,
  findingNote,
  headline,
  number,
  PANELS,
  price,
  rolesAnswered,
  runSubtitle,
  seconds,
  SIDE_LABEL,
  sideTone,
  stages,
  summaryRows,
  usageOf,
  VERDICT_LABEL,
  closingLines,
  NO_ANSWER,
} from "@record/summary.js";
import { stepPanel } from "../panel-nav.js";
import "./Results.css";

/**
 * Step 4: the verdict, in five panels.
 *
 * specs.md Part 1: "the results then appear as five swipeable panels — the final verdict,
 * the three judges (tap to expand reasoning), the four advocates with their side, the
 * token-and-price breakdown, and a closing summary slide." This is that, desktop-first:
 * arrows in the footer, the arrow keys, and a swipe where there is a finger.
 *
 * **Every panel renders the record and nothing else.** Part 3: one run produces one record
 * and everything downstream renders it. The record is already in the browser — it closed
 * the stream — and it is read straight off the session that carried it, so this screen
 * fetches nothing, recomputes nothing, and cannot show a number the server did not send.
 * `results-model.ts` does the arranging; there is no arithmetic in this file that is not a
 * call into it.
 *
 * **The one thing it does fetch is the file.** The exported record is built on the server
 * from that same record (`run-export.ts` explains why there, and why it is asked for the
 * moment the run finishes rather than when the button is pressed).
 *
 * **This screen never starts anything.** The run was opened by a click two screens ago and
 * lives outside React; arriving here, leaving and coming back costs nothing.
 *
 * **The panels are a pure function of a record, split out as `ResultsPanels`.** A live run
 * and an archived one both end up with a `RunRecordView` and nothing else in common — this
 * component is the live wrapper that reads one off a session's stream; the archive screen
 * reads one off `GET /api/archive/:id` and renders the identical panels, so an archived run
 * cannot drift from how a live one was shown.
 */

export function Results({
  session,
  onNewCase,
}: {
  session: RunSession;
  onNewCase: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const runId =
    state.preflight?.runId ?? (session.source.kind === "rejoin" ? session.source.runId : null);

  /**
   * The one place a run's id joins this browser's archive list — not a click handler, so
   * every path to a finished record hits it alike: a run watched live to its close, one
   * rejoined mid-flight, and one reopened here after a reload. `rememberArchivedRun`
   * dedupes, so a repeat of this effect (React's double-invoke in development, a record
   * that is already there) costs nothing.
   */
  useEffect(() => {
    if (state.record !== null && runId !== null) rememberArchivedRun(runId);
  }, [state.record, runId]);

  if (state.record === null) {
    return (
      <AppFrame
        footer={
          <>
            <div className="app-sheet-footer-status">
              <span className="mono results-note">Nothing was recorded, so nothing is exportable.</span>
            </div>
            <div className="app-sheet-footer-actions">
              <Button variant="primary" onClick={onNewCase}>
                Back to the charge
              </Button>
            </div>
          </>
        }
      >
        <Masthead subtitle="The bench never reached a finding." step={4} />
        <div className="app-message">
          <Panel sunken className="app-message-panel">
            <h2 className="section-heading">There is no record to show</h2>
            <p>
              This run ended without producing a record — it was refused before any model was
              called, or the connection to it was lost before the bench ruled. Nothing is
              invented to fill that in.
            </p>
          </Panel>
        </div>
      </AppFrame>
    );
  }

  return <ResultsPanels record={state.record} runId={runId} onNewCase={onNewCase} />;
}

/**
 * The panels. Renders a record; knows nothing about sessions or streams — a live run and
 * an archived one both reach this component the same way, through a plain `RunRecordView`.
 */
export function ResultsPanels({
  record,
  runId,
  onNewCase,
  newCaseLabel,
}: {
  record: RunRecordView;
  runId: string | null;
  onNewCase: () => void;
  /** Defaults to "Start a new charge sheet" — the archive screen's Back button overrides it. */
  newCaseLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [file, setFile] = useState<ExportedRecord | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const touchStart = useRef<number | null>(null);

  const go = (by: number): void => setIndex((current) => stepPanel(current, by));

  /**
   * The arrow keys move between panels — Part 1 asks for keyboard as well as arrows, and
   * on a screen whose whole content is one of five slides the keyboard is the fast way.
   * Bound on the window rather than a focusable container so it works without the user
   * having clicked anything first.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      // Never steal a key from something the user is typing or operating.
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|BUTTON|SUMMARY)$/.test(target.tagName)) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      }
      if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "Home") setIndex(0);
      else if (event.key === "End") setIndex(PANELS.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * The record is asked for as a file as soon as there is one.
   *
   * An effect here and not on a click, deliberately, and it is the opposite case from the
   * run itself: this is one GET to our own server for a file that already exists, it costs
   * nothing against the model allowance, and `exportOf` memoises by run id so React running
   * this twice in development asks once. What it buys is that the server's ten-minute hold
   * is spent while the reader is still on the first panel rather than when they press
   * Export on the fourth.
   */
  useEffect(() => {
    if (runId === null) return;
    let live = true;
    exportOf(runId)
      .then((ready) => {
        if (live) setFile(ready);
      })
      .catch((error: Error) => {
        if (live) setExportError(error.message);
      });
    return () => {
      live = false;
    };
  }, [runId]);

  const retryExport = (): void => {
    if (runId === null) return;
    setExportError(null);
    exportOf(runId)
      .then(setFile)
      .catch((error: Error) => setExportError(error.message));
  };

  const panel = PANELS[index];
  // Three states and no fourth: it is here, it failed, or it is still coming. "Still
  // coming" is the absence of the other two rather than a flag that could disagree.
  const exportState = { file, error: exportError, onRetry: retryExport };

  return (
    <AppFrame
      footer={
        <PanelNav
          index={index}
          onGo={go}
          onJump={setIndex}
        />
      }
    >
      <Masthead subtitle={runSubtitle(record)} step={4} />

      <div
        className="results"
        // Swipe, for the touch half of "desktop-first, responsive to mobile". A horizontal
        // drag of any length that is mostly horizontal turns the page; anything else is
        // left to the browser, so a vertical scroll inside a panel still scrolls.
        onTouchStart={(event) => {
          touchStart.current = event.touches[0].clientX;
        }}
        onTouchEnd={(event) => {
          const from = touchStart.current;
          touchStart.current = null;
          if (from === null) return;
          const moved = event.changedTouches[0].clientX - from;
          if (Math.abs(moved) > 55) go(moved < 0 ? 1 : -1);
        }}
      >
        {panel.id === "verdict" && <VerdictPanel record={record} />}
        {panel.id === "bench" && <BenchPanel record={record} />}
        {panel.id === "advocates" && <AdvocatesPanel record={record} />}
        {panel.id === "spend" && <SpendPanel record={record} exportState={exportState} />}
        {panel.id === "closing" && (
          <ClosingPanel
            record={record}
            exportState={exportState}
            onNewCase={onNewCase}
            newCaseLabel={newCaseLabel}
          />
        )}
      </div>
    </AppFrame>
  );
}

/* ---- panel 1: the finding ---------------------------------------------------------------- */

function VerdictPanel({ record }: { record: RunRecordView }) {
  const head = headline(record);

  return (
    <section className="results-panel is-centred" aria-label="The verdict">
      <div className={`results-finding is-${head.tone}`}>
        <div className="display results-finding-label">The tribunal finds</div>
        <div className={`display results-finding-title is-${head.tone}`}>{head.title}</div>
        <GoldRule />
        <div className="results-finding-detail">{head.detail}</div>
      </div>

      <div className="results-seats">
        {record.judges.map((judge) => (
          <div key={judge.judgeId} className="results-seat">
            <JudgePortrait name={judge.name} phase={judge.verdict === null ? "failed" : "ruled"} size={46} />
            <div>
              <div className="results-seat-name">{judge.name}</div>
              {judge.verdict === null ? (
                <div className="results-seat-none">No readable verdict</div>
              ) : (
                <div className={`display results-verdict is-${judge.verdict === "guilty" ? "guilty" : "acquitted"}`}>
                  {VERDICT_LABEL[judge.verdict]}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="results-charge">
        <span className="display results-charge-label">The charge</span>
        <p className="results-charge-text">{record.chargeSheet}</p>
      </div>

      <p className="results-footnote">{findingNote()}</p>
    </section>
  );
}

/* ---- panel 2: the bench ------------------------------------------------------------------- */

function BenchPanel({ record }: { record: RunRecordView }) {
  // The first seat opens with the panel; the rest are a click away. Something has to be
  // readable on arrival, and the alternative — all three expanded — makes the panel scroll
  // before it has said anything.
  const [open, setOpen] = useState<string | null>(record.judges[0]?.judgeId ?? null);

  return (
    <section className="results-panel" aria-label="The bench">
      <PanelHead
        title={PANELS[1].heading}
        note="Two reasons asked for. What each judge gave is reported as it came."
      />

      <div className="results-bench">
        {record.judges.map((judge) => (
          <JudgeCard
            key={judge.judgeId}
            judge={judge}
            open={open === judge.judgeId}
            onToggle={() => setOpen((current) => (current === judge.judgeId ? null : judge.judgeId))}
          />
        ))}
      </div>

      <Callout tone="gold">{benchNote(record.mode)}</Callout>
    </section>
  );
}

function JudgeCard({
  judge,
  open,
  onToggle,
}: {
  judge: JudgeView;
  open: boolean;
  onToggle: () => void;
}) {
  const usage = usageOf(judge.attempts);
  const ruled = judge.verdict !== null;
  const notes = [
    `${judge.reasonCount} ${judge.reasonCount === 1 ? "reason" : "reasons"}`,
    ...(judge.thinReasoning && ruled ? ["thinner than the two asked for"] : []),
    ...(usage.tokens === null ? [] : [`${number(usage.tokens)} tokens`]),
    seconds(usage.elapsedMs),
  ];

  return (
    <article className={`results-judge${open ? " is-open" : ""}${ruled ? "" : " is-failed"}`}>
      {/* A button rather than a div with a handler: this is the one thing on the panel a
          keyboard user has to be able to reach, and Part 1 asks for keyboard throughout. */}
      <button type="button" className="results-judge-head" onClick={onToggle} aria-expanded={open}>
        <JudgePortrait name={judge.name} phase={ruled ? "ruled" : "failed"} size={52} />
        <span className="display results-judge-name">{judge.name}</span>
        <span className="mono results-judge-hint">
          {open ? "click to fold away" : "click for the reasoning"}
        </span>
        {ruled && judge.verdict !== null ? (
          <span className={`display results-verdict is-${judge.verdict === "guilty" ? "guilty" : "acquitted"}`}>
            {VERDICT_LABEL[judge.verdict]}
          </span>
        ) : (
          <span className="results-seat-none">No readable verdict</span>
        )}
        <Chevron up={open} />
      </button>

      {open && (
        <div className="results-judge-body">
          {ruled ? (
            <p className="results-reasoning">{judge.reasoning}</p>
          ) : (
            <p className="results-reasoning is-absent">
              {NO_ANSWER}
            </p>
          )}
          <div className="mono results-meta">
            {judge.model ?? judge.requestedModel} · {notes.join(" · ")}
            {judge.model !== null && judge.model !== judge.requestedModel && (
              <> · fell back from {judge.requestedModel}</>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/* ---- panel 3: the advocates --------------------------------------------------------------- */

function AdvocatesPanel({ record }: { record: RunRecordView }) {
  const { defense, prosecution } = bySide(record.statements);

  return (
    <section className="results-panel" aria-label="The advocates">
      <PanelHead
        title={PANELS[2].heading}
        note="The bench saw these labelled by side only."
      />

      {/* Defense left, prosecution right, as on Side Select and the trial screen. */}
      <div className="results-sides">
        <div className="results-side">
          {defense.map((statement) => (
            <StatementCard key={statement.advocateId} statement={statement} />
          ))}
        </div>
        <div className="results-side">
          {prosecution.map((statement) => (
            <StatementCard key={statement.advocateId} statement={statement} />
          ))}
        </div>
      </div>

      <Callout tone="plain">{advocatesNote()}</Callout>
    </section>
  );
}

function StatementCard({ statement }: { statement: StatementView }) {
  const tone = sideTone(statement.side);
  const usage = usageOf(statement.attempts);

  return (
    <article className={`results-statement side-${tone}${statement.ok ? "" : " is-failed"}`}>
      <div className="results-statement-head">
        <CharacterTile
          characterId={statement.advocateId}
          name={statement.name}
          size={50}
          state={statement.ok ? "happy" : "idle"}
          tone={statement.ok ? tone : "failed"}
        />
        <div>
          <div className="display results-statement-name">{statement.name}</div>
          <div className={`mono results-statement-side is-${tone}`}>{SIDE_LABEL[statement.side]}</div>
        </div>
      </div>

      {statement.ok ? (
        <p className="results-speech">{statement.text}</p>
      ) : (
        <p className="results-speech is-absent">
          {NO_ANSWER}
        </p>
      )}

      <div className="mono results-meta">
        {statement.model ?? statement.requestedModel}
        {statement.words !== null && <> · {statement.words} words</>}
        {statement.overCap && (
          <span className="results-overcap"> · over the {statement.wordCap}-word cap</span>
        )}
        {usage.tokens !== null && <> · {number(usage.tokens)} tokens</>}
        <> · {seconds(usage.elapsedMs)}</>
        {statement.rescreened && <> · asked twice</>}
      </div>
    </article>
  );
}

/* ---- panel 4: what it spent ---------------------------------------------------------------- */

interface ExportState {
  readonly file: ExportedRecord | null;
  readonly error: string | null;
  readonly onRetry: () => void;
}

function SpendPanel({ record, exportState }: { record: RunRecordView; exportState: ExportState }) {
  const totals = record.totals;
  const waves = stages(record);

  return (
    <section className="results-panel" aria-label="What it spent">
      <PanelHead
        title={PANELS[3].heading}
        note="Read from each API response. Nothing here is estimated."
      />

      <div className="results-table-frame">
        <table className="results-table">
          <thead>
            <tr>
              <th>role</th>
              <th>try</th>
              <th>model</th>
              <th className="n">prompt</th>
              <th className="n">answer</th>
              <th className="n">thinking</th>
              <th className="n">total</th>
              <th className="n">price</th>
              <th className="n">time</th>
              <th>result</th>
            </tr>
          </thead>

          {/* One body per wave, so the per-stage numbers sit under the calls they add up —
              the plan asks this panel for both, and a stage total floating at the bottom
              would be a number with nothing beside it to check against. */}
          {waves.map((wave) => (
            <tbody key={wave.stage}>
              <tr className="results-stage">
                <td colSpan={10}>{wave.caption}</td>
              </tr>
              {wave.attempts.map((attempt, position) => (
                <CallRow key={`${attempt.label}-${attempt.attempt}-${position}`} attempt={attempt} />
              ))}
              <tr className="results-subtotal">
                <td colSpan={3}>
                  {wave.attempts.length} {wave.attempts.length === 1 ? "call" : "calls"}
                  {wave.failed > 0 && `, ${wave.failed} failed`}
                </td>
                <td className="n">{number(wave.promptTokens)}</td>
                <td className="n">{number(wave.completionTokens)}</td>
                <td className="n">{number(wave.reasoningTokens)}</td>
                <td className="n">{number(wave.totalTokens)}</td>
                <td className="n">{price(wave.costUsd)}</td>
                {/* Summed, not elapsed: the calls in a wave overlap, so this is time spent
                    waiting on models rather than time the wave took. */}
                <td className="n">{seconds(wave.elapsedMs)}</td>
                <td />
              </tr>
            </tbody>
          ))}

          <tfoot>
            <tr>
              <td colSpan={3}>
                {totals.calls} {totals.calls === 1 ? "call" : "calls"} · the whole run
              </td>
              <td className="n">{number(totals.promptTokens)}</td>
              <td className="n">{number(totals.completionTokens)}</td>
              <td className="n">{number(totals.reasoningTokens)}</td>
              <td className="n">{number(totals.totalTokens)}</td>
              <td className="n">{price(totals.costUsd)}</td>
              <td className="n">{seconds(totals.elapsedMs)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {totals.usageMissing && (
        <Callout tone="gold">
          At least one call reported no token usage, so the totals above are a floor rather
          than an exact figure. Nothing was estimated to fill the gap.
        </Callout>
      )}

      <ExportCard exportState={exportState} />
    </section>
  );
}

function CallRow({ attempt }: { attempt: Attempt }) {
  const usage = attempt.usage;
  const cell = (value: number | null): string => (value === null ? "—" : number(value));

  return (
    <tr className={attempt.ok ? "" : "is-failed"}>
      <td>{attempt.label}</td>
      <td>
        {attempt.attempt}
        {attempt.isRetry && " (retry)"}
      </td>
      <td>{attempt.respondedModel ?? attempt.requestedModel}</td>
      <td className="n">{cell(usage.promptTokens)}</td>
      <td className="n">{cell(usage.completionTokens)}</td>
      <td className="n">{cell(usage.reasoningTokens)}</td>
      <td className="n">{cell(usage.totalTokens)}</td>
      <td className="n">{price(usage.costUsd ?? 0)}</td>
      <td className="n">{seconds(attempt.elapsedMs)}</td>
      <td>{attempt.ok ? "ok" : (attempt.errorKind ?? "failed")}</td>
    </tr>
  );
}

/* ---- panel 5: in closing --------------------------------------------------------------------- */

function ClosingPanel({
  record,
  exportState,
  onNewCase,
  newCaseLabel,
}: {
  record: RunRecordView;
  exportState: ExportState;
  onNewCase: () => void;
  newCaseLabel?: string;
}) {
  const closing = closingLines(record);
  const roles = rolesAnswered(record);

  return (
    <section className="results-panel is-centred" aria-label="In closing">
      <div className="results-closing">
        <div className="display results-closing-label">{PANELS[4].label}</div>
        <p className="results-closing-lead">{closing.lead}</p>
        {closing.note !== "" && <p className="results-closing-note">{closing.note}</p>}
      </div>

      <dl className="results-facts">
        {summaryRows(record).map((row) => (
          <div key={row.label} className="results-fact">
            <dt className="display results-fact-label">{row.label}</dt>
            <dd className={`results-fact-value${row.tone ? ` display is-${row.tone}` : ""}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {!record.complete && (
        <Callout tone="gold">
          {roles.answered} of the {roles.of} roles this run asked for came back. It is recorded
          and exported as an incomplete trial, not as a complete one with a quiet gap.
        </Callout>
      )}

      <div className="results-closing-actions">
        <ExportButton exportState={exportState} />
        <Button onClick={onNewCase}>{newCaseLabel ?? "Start a new charge sheet"}</Button>
      </div>

      <p className="results-footnote">
        If this server keeps an archive, this run has been added to it and will show up
        under your past runs in this browser. The exported file is the portable copy
        either way — the one that opens with no server and no network.
      </p>
    </section>
  );
}

/* ---- the export, and the footer ---------------------------------------------------------------- */

function ExportCard({ exportState }: { exportState: ExportState }) {
  return (
    <Panel tone="inset" sunken className="results-export">
      <div className="results-export-words">
        <div className="display results-export-title">Keep the record</div>
        <div className="results-export-note">
          One HTML file — the sheet, the casting, the statements, the verdicts, this table and
          the raw replies. It opens from disk with no server and no network.
        </div>
      </div>
      <ExportButton exportState={exportState} />
    </Panel>
  );
}

/**
 * The one blue action on this screen.
 *
 * It is disabled until the file has actually arrived, rather than pretending and failing on
 * the press: the record is fetched when the run finishes, so in practice it is ready long
 * before anyone reaches this panel, and a button that says why it is not is better than one
 * that looks ready and is not.
 */
function ExportButton({ exportState }: { exportState: ExportState }) {
  const { file, error, onRetry } = exportState;

  if (error !== null) {
    return (
      <div className="results-export-failed">
        <p className="results-export-error">{error}</p>
        <Button onClick={onRetry}>Ask for the record again</Button>
      </div>
    );
  }

  return (
    <Button
      variant="primary"
      disabled={file === null}
      onClick={() => {
        if (file !== null) saveExport(file);
      }}
      title={
        file === null
          ? "The record is still being put together on the server."
          : `Downloads ${file.filename}`
      }
    >
      <DownloadMark />
      {file === null ? "Preparing the record…" : "Export this run"}
    </Button>
  );
}

/** The footer: where you are, what is on either side, and the way to both. */
function PanelNav({
  index,
  onGo,
  onJump,
}: {
  index: number;
  onGo: (by: number) => void;
  onJump: (to: number) => void;
}) {
  const previous = PANELS[index - 1];
  const next = PANELS[index + 1];

  return (
    /* One element, not three: the sheet's footer stacks its children on a phone, and this
       row is the navigation — it has to stay a row at every width. */
    <div className="results-nav">
      <div className="results-nav-side">
        <button
          type="button"
          className="results-arrow"
          onClick={() => onGo(-1)}
          disabled={previous === undefined}
          aria-label={previous ? `Back to ${previous.label}` : "This is the first panel"}
        >
          <Arrow back />
        </button>
        <span className={`results-nav-label${previous ? "" : " is-flat"}`}>
          {previous ? previous.label : "First panel"}
        </span>
      </div>

      {/* A dot per panel, and the dots are buttons: five panels is few enough that jumping
          straight to one beats pressing an arrow four times. */}
      <div className="results-dots">
        {PANELS.map((spec, position) => (
          <button
            key={spec.id}
            type="button"
            className={`results-dot${position === index ? " is-current" : ""}`}
            onClick={() => onJump(position)}
            aria-label={spec.label}
            aria-current={position === index ? "true" : undefined}
          />
        ))}
        <span className="mono results-count">
          {index + 1} / {PANELS.length} · {PANELS[index].label}
        </span>
      </div>

      <div className="results-nav-side is-right">
        <span className={`results-nav-label${next ? "" : " is-flat"}`}>
          {next ? next.label : "Last panel"}
        </span>
        <button
          type="button"
          className="results-arrow"
          onClick={() => onGo(1)}
          disabled={next === undefined}
          aria-label={next ? `On to ${next.label}` : "This is the last panel"}
        >
          <Arrow />
        </button>
      </div>
    </div>
  );
}

/* ---- small pieces ------------------------------------------------------------------------------- */

function PanelHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="results-head">
      <h2 className="section-heading">{title}</h2>
      <span className="results-head-note">{note}</span>
    </div>
  );
}

function Callout({ tone, children }: { tone: "gold" | "plain"; children: ReactNode }) {
  return (
    <div className={`results-callout is-${tone}`}>
      <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="9" cy="9" r="7" />
        <path d="M9 8 L9 13" />
        <path d="M9 5.5 L9 5.51" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

/** The gold rule under the finding — two lines and a lozenge, as drawn on the canvas. */
function GoldRule() {
  return (
    <svg className="results-rule" width="240" height="16" viewBox="0 0 240 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M4 8 L104 8" />
      <path d="M136 8 L236 8" />
      <path d="M120 2.5 L125.5 8 L120 13.5 L114.5 8 Z" fill="currentColor" stroke="none" />
      <circle cx="108.5" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="131.5" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg className="results-chevron" width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {up ? <path d="M5 14 L11 8 L17 14" /> : <path d="M5 8 L11 14 L17 8" />}
    </svg>
  );
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg width="34" height="34" viewBox="0 0 38 38" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="19" cy="19" r="17" />
      {back ? <path d="M23 12 L16 19 L23 26" /> : <path d="M15 12 L22 19 L15 26" />}
    </svg>
  );
}

function DownloadMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2 L8 10" />
      <path d="M4.5 7 L8 10.5 L11.5 7" />
      <path d="M2.5 13 L13.5 13" />
    </svg>
  );
}
