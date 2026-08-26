import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { AppFrame } from "../components/AppFrame.js";
import { Button } from "../components/Button.js";
import { CharacterTile } from "../components/CharacterTile.js";
import { JudgePortrait, type BenchPhase } from "../components/JudgePortrait.js";
import { Masthead } from "../components/Masthead.js";
import { Panel } from "../components/Panel.js";
import { preloadAvatars } from "../components/avatars.js";
import type {
  Character,
  JudgeView,
  RunRecordView,
  RunRequest,
  Side,
  StatementView,
} from "../api.js";
import { type RunSession, type RunSnapshot } from "../run-session.js";
// Tokens and time for one role, summed across its attempts — the same reading the results
// panels use, kept in one place so a card and a panel cannot disagree about a role's cost.
import { usageOf } from "../results-model.js";
import "./Run.css";

/**
 * Step 3: the trial, watched as it happens.
 *
 * specs.md Part 1: "As each advocate's statement arrives its avatar moves from idle to
 * thinking to happy; once the four are done the judges deliberate behind loading gavels."
 * That sentence is the whole reason this screen streams rather than waits — and the reason
 * the four advocate calls being *parallel* matters to it. All four are asked at once, so
 * all four are thinking at once, and each flips on its own the moment its own statement
 * lands. Nothing here batches, and nothing waits for a sibling.
 *
 * **A failed advocate never reaches the happy state.** It goes to a drained, crimson-framed
 * card carrying the reason, because a run with three statements is an incomplete trial and
 * Part 2 requires it to be shown as one rather than as a completed run that happens to have
 * a gap. The same rule holds on the bench: a seat with no verdict keeps the undone portrait.
 *
 * **The room is drawn before the server has said anything.** The casting was chosen on the
 * previous screen, so the four cards and the three seats exist from the first frame, in the
 * waiting state, and the model identifiers fill in when the `preflight` event arrives. The
 * alternative — an empty sheet until the first response — would put the longest pause of
 * the run on the emptiest screen.
 *
 * **Losing the connection does not lose the run.** The stream is resumed by run id from the
 * last event seen (`run-stream.ts`), and the id is kept in `sessionStorage` so even a
 * reloaded tab rejoins rather than starting a second run. Seven rationed requests are far
 * too expensive to spend twice on the same case.
 *
 * **This screen renders a run; it does not start one.** The session was opened by the click
 * on the previous screen and lives outside React (`run-session.ts`), so nothing about how
 * often this component mounts can cost a request. All that happens here is a subscription.
 */

/* ---- the screen ------------------------------------------------------------------------ */

/** A role's four states, in the order it passes through them. */
type CardPhase = "waiting" | "thinking" | "spoke" | "failed";

interface CastRow {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
  readonly requestedModel: string | null;
}

export function Run({
  session,
  characters,
  judgeNames,
  request,
  onNewCase,
  onSeeVerdict,
}: {
  /** A run already under way. Opened by the click on Side Select, never by this screen. */
  session: RunSession;
  /** The roster, for the portraits — a rejoined run knows names but not which art to use. */
  characters: readonly Character[];
  /** The bench, from `/api/health`, so the three seats exist before the run reports them. */
  judgeNames: readonly string[];
  /** What was posted, so the room can be drawn before the server answers. Null on a rejoin. */
  request: RunRequest | null;
  onNewCase: () => void;
  /** On to the verdict panels, which read the finished record from this same session. */
  onSeeVerdict: () => void;
}) {
  // The session accumulates outside React and hands over a whole snapshot each time it
  // changes, so a subscriber that arrives late still reads the entire run so far.
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Every portrait, fetched while the trial is opening. A state change that had to wait
  // for a download would flash an empty tile at the exact moment being watched.
  useEffect(preloadAvatars, []);

  const byId = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );

  /**
   * The casting: the server's once it has spoken, the local request until then.
   *
   * They are the same four either way — the request is what was posted a moment ago — but
   * the server's copy carries the model each seat was assigned, and the server is the one
   * that decides who argues. So it wins as soon as it exists.
   */
  const casting: readonly CastRow[] = useMemo(() => {
    if (state.preflight) {
      return state.preflight.casting.map((row) => ({
        id: row.id,
        name: row.name,
        side: row.side,
        requestedModel: row.requestedModel,
      }));
    }
    if (state.record) {
      return state.record.casting.map((row) => ({ ...row, requestedModel: null }));
    }
    return (request?.advocates ?? []).map((advocate) => ({
      id: advocate.id,
      name: byId.get(advocate.id)?.name ?? advocate.id,
      side: advocate.side,
      requestedModel: null,
    }));
  }, [state.preflight, state.record, request, byId]);

  const bench = useMemo(() => {
    if (state.preflight) return state.preflight.bench;
    return judgeNames.map((name) => ({ id: name, name, requestedModel: "" }));
  }, [state.preflight, judgeNames]);

  const defendant =
    state.preflight?.defendant ??
    state.record?.defendant ??
    (request
      ? { id: request.defendant, name: byId.get(request.defendant)?.name ?? request.defendant }
      : null);
  const defendantId = defendant?.id ?? "";
  const defendantName = defendant?.name ?? "the accused";
  const chargeSheet = state.preflight?.chargeSheet ?? state.record?.chargeSheet ?? request?.chargeSheet ?? "";

  const settledStatements = casting.filter((row) => state.statements[row.id]).length;
  const settledJudges = bench.filter((seat) => state.judges[seat.id]).length;
  const totalCalls = casting.length + bench.length;
  const returned = settledStatements + settledJudges;

  const started = state.preflight !== null;
  const aborted = state.record?.outcome.kind === "aborted";
  // Judging begins the instant the last advocate settles — that is literally the next line
  // in `run.ts` — so the bench starts deliberating on the fourth statement, not on a signal.
  const benchSitting = started && settledStatements === casting.length && casting.length > 0;

  const finished = state.record !== null || state.refusal !== null || state.serverError !== null;

  const cardPhase = (row: CastRow): CardPhase => {
    const statement = state.statements[row.id];
    if (statement) return statement.ok ? "spoke" : "failed";
    if (state.record) return "failed";
    return started ? "thinking" : "waiting";
  };

  const benchPhase = (judgeId: string): BenchPhase => {
    const judge = state.judges[judgeId];
    if (judge) return judge.verdict === null ? "failed" : "ruled";
    if (aborted) return "waiting";
    if (state.record) return "failed";
    return benchSitting ? "deliberating" : "waiting";
  };

  const defense = casting.filter((row) => row.side === "for");
  const prosecution = casting.filter((row) => row.side === "against");

  /* ---- refusals and lost connections take the whole sheet ---------------------------- */

  if (state.refusal !== null) {
    return (
      <Stopped
        heading="The tribunal refused the case"
        onNewCase={onNewCase}
        lead={
          state.refusal.message ??
          "The pre-flight rejected this setup before a single model was called. Nothing was " +
            "spent, and nothing about your allowance has changed."
        }
      >
        {state.refusal.failures.length > 0 && (
          <ul className="run-failures">
            {state.refusal.failures.map((failure) => (
              <li key={failure.code}>{failure.message}</li>
            ))}
          </ul>
        )}
      </Stopped>
    );
  }

  if (state.lost !== null && !started) {
    return <Stopped heading="The trial could not be reached" lead={state.lost} onNewCase={onNewCase} />;
  }

  /* ---- the trial ---------------------------------------------------------------------- */

  return (
    <AppFrame
      footer={
        <>
          <div className="app-sheet-footer-status">
            <RunStatus
              state={state}
              runId={state.preflight?.runId ?? null}
              finished={finished}
              record={state.record}
            />
          </div>
          <div className="app-sheet-footer-actions">
            {finished ? (
              <>
                <Button onClick={onNewCase}>Start a new case</Button>
                <Button
                  variant="primary"
                  trailingArrow
                  // A run that produced no record has no verdict to show, and the panels
                  // are never opened on nothing. A refusal or a lost connection ends here.
                  disabled={state.record === null}
                  onClick={onSeeVerdict}
                  title={
                    state.record === null
                      ? "This run produced no record, so there is no finding to show."
                      : undefined
                  }
                >
                  See the verdict
                </Button>
              </>
            ) : (
              <span className="run-footer-note">Nothing is exportable until the run finishes.</span>
            )}
          </div>
        </>
      }
    >
      <Masthead subtitle="The court is sitting. Statements arrive one at a time." step={3} />

      <div className="run">
        <div className="run-charge">
          <span className="display run-charge-label">The charge</span>
          {/* The accused, named beside the charge. Since Part 1 lets them hold a defence
              seat, they may also appear below as one of the four advocate cards — which is
              not a duplicate but the two things they are, and the tones say which is which:
              this chip is `accused`, the card down there is `defense`. */}
          <span className="run-charge-accused">
            <CharacterTile
              characterId={defendantId}
              name={defendantName}
              size={30}
              tone="accused"
            />
            <span className="display run-charge-accused-name">{defendantName}</span>
          </span>
          <span className={`run-charge-text${sheetOpen ? " is-open" : ""}`}>{chargeSheet}</span>
          <button
            type="button"
            className="run-charge-toggle"
            onClick={() => setSheetOpen((open) => !open)}
          >
            {sheetOpen ? "Fold it away" : "Read the full sheet"}
          </button>
        </div>

        <div className="run-section-head">
          <h2 className="section-heading">The Advocates — one statement each</h2>
          <div className="run-progress">
            <div
              className="run-meter"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={totalCalls}
              aria-valuenow={returned}
              aria-label="Calls returned"
            >
              <div
                className="run-meter-fill"
                style={{ width: `${totalCalls === 0 ? 0 : (returned / totalCalls) * 100}%` }}
              />
            </div>
            <span className="mono run-progress-count">
              {returned} of {totalCalls} calls returned
            </span>
          </div>
        </div>

        {/* Defense left, prosecution right — the same left-to-right order Side Select uses
            and the result panels keep, so a side sits in one place across the whole app. */}
        <div className="run-sides">
          <SideColumn side="for" rows={defense} phaseOf={cardPhase} statements={state.statements} />
          <SideColumn
            side="against"
            rows={prosecution}
            phaseOf={cardPhase}
            statements={state.statements}
          />
        </div>

        <Panel tone="inset" sunken className="run-bench">
          <div className="run-bench-head">
            <h2 className="section-heading">The Bench</h2>
            <span className="run-bench-note">
              The judges read the four statements by side, never by name.
            </span>
          </div>
          <div className="run-bench-seats">
            {bench.map((seat) => (
              <JudgeSeat
                key={seat.id}
                name={seat.name}
                phase={benchPhase(seat.id)}
                judge={state.judges[seat.id]}
                requestedModel={seat.requestedModel}
                aborted={aborted}
              />
            ))}
          </div>
        </Panel>

        {state.serverError !== null && (
          <Panel sunken className="run-alert is-error">
            <h3 className="display run-alert-heading">The run stopped</h3>
            <p>{state.serverError}</p>
          </Panel>
        )}

        {aborted && state.record?.outcome.kind === "aborted" && (
          <Panel sunken className="run-alert is-error">
            <h3 className="display run-alert-heading">The bench never sat</h3>
            <p>{state.record.outcome.message}</p>
          </Panel>
        )}
      </div>
    </AppFrame>
  );
}

/* ---- pieces ---------------------------------------------------------------------------- */

function SideColumn({
  side,
  rows,
  phaseOf,
  statements,
}: {
  side: Side;
  rows: readonly CastRow[];
  phaseOf: (row: CastRow) => CardPhase;
  statements: Readonly<Record<string, StatementView>>;
}) {
  return (
    <div className={`run-side is-${side === "for" ? "defense" : "prosecution"}`}>
      <div className={`display run-side-label is-${side === "for" ? "defense" : "prosecution"}`}>
        {side === "for" ? "The Defense" : "The Prosecution"}
      </div>
      {rows.map((row) => (
        <AdvocateCard
          key={row.id}
          row={row}
          phase={phaseOf(row)}
          statement={statements[row.id]}
        />
      ))}
    </div>
  );
}

function AdvocateCard({
  row,
  phase,
  statement,
}: {
  row: CastRow;
  phase: CardPhase;
  statement: StatementView | undefined;
}) {
  const sideLabel = row.side === "for" ? "For the defense" : "For the prosecution";

  return (
    <article
      className={`run-card is-${phase} side-${row.side === "for" ? "defense" : "prosecution"}`}
    >
      <div className="run-card-head">
        <CharacterTile
          characterId={row.id}
          name={row.name}
          size={56}
          // The art tracks the call: idle before it starts, thinking while it is out, and
          // happy only for a statement that actually arrived.
          state={phase === "thinking" ? "thinking" : phase === "spoke" ? "happy" : "idle"}
          tone={phase}
          motion={phase === "thinking" ? "thinking" : phase === "spoke" ? "happy" : phase === "waiting" ? "idle" : "none"}
        />
        <div className="run-card-identity">
          <div className="display run-card-name">{row.name}</div>
          <div className={`mono run-card-side is-${row.side === "for" ? "defense" : "prosecution"}`}>
            {sideLabel}
          </div>
        </div>
        <StatusChip phase={phase} />
      </div>

      {phase === "spoke" && statement?.text !== null && statement !== undefined && (
        <p className="run-card-text">{statement.text}</p>
      )}

      {phase === "thinking" && (
        <div className="run-skeleton" aria-hidden="true">
          <span style={{ width: "100%" }} />
          <span style={{ width: "94%" }} />
          <span style={{ width: "97%" }} />
          <span style={{ width: "61%" }} />
        </div>
      )}

      {phase === "waiting" && (
        <div className="run-card-empty">
          <span>Has not been called yet.</span>
        </div>
      )}

      {phase === "failed" && (
        <p className="run-card-error">
          {statement?.error ??
            "No statement came back for this advocate, and none was written for it. The " +
              "trial is recorded as incomplete rather than as one that happened to be quiet."}
        </p>
      )}

      <div className="mono run-card-meta">
        <CardMeta row={row} phase={phase} statement={statement} />
      </div>
    </article>
  );
}

/**
 * The mono line under a card: what actually answered, and what it cost.
 *
 * Every number here is read off the API's own `usage`, never counted here — specs.md
 * Parts 1 and 2. Where a model reported nothing, the line says so rather than showing a
 * zero that would read as free rather than as unknown.
 */
function CardMeta({
  row,
  phase,
  statement,
}: {
  row: CastRow;
  phase: CardPhase;
  statement: StatementView | undefined;
}) {
  if (phase === "waiting") {
    return <>model assigned at the start of the run</>;
  }
  if (phase === "thinking") {
    return <>{row.requestedModel ?? "…"} · thinking, then answering</>;
  }
  if (phase === "failed") {
    const tried = statement?.attempts.length ?? 0;
    return (
      <>
        {statement?.requestedModel ?? row.requestedModel ?? "—"} ·{" "}
        {tried === 1 ? "1 attempt" : `${tried} attempts`}
        {statement?.errorKind ? ` · ${statement.errorKind.replace(/_/g, " ")}` : ""}
      </>
    );
  }

  const usage = usageOf(statement?.attempts ?? []);
  return (
    <>
      {statement?.model ?? statement?.requestedModel ?? "—"}
      {statement?.words !== null && statement?.words !== undefined && (
        <> · {statement.words} words</>
      )}
      {statement?.overCap && (
        <span className="run-overcap"> · over the {statement.wordCap}-word cap</span>
      )}
      {usage.tokens !== null && <> · {usage.tokens.toLocaleString()} tokens</>}
      <> · {(usage.elapsedMs / 1000).toFixed(1)}s</>
      {statement && statement.model !== null && statement.model !== statement.requestedModel && (
        <> · fell back from {statement.requestedModel}</>
      )}
      {statement?.rescreened && <> · asked twice</>}
    </>
  );
}

function StatusChip({ phase }: { phase: CardPhase }) {
  if (phase === "spoke") {
    return (
      <span className="run-chip is-spoke">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8.5 L6.5 12 L13 4.5" />
        </svg>
        <span className="mono">spoke</span>
      </span>
    );
  }
  if (phase === "thinking") {
    return (
      <span className="run-chip is-thinking">
        <span className="run-dot" aria-hidden="true" />
        <span className="run-dot run-dot-2" aria-hidden="true" />
        <span className="run-dot run-dot-3" aria-hidden="true" />
        <span className="mono">composing</span>
      </span>
    );
  }
  if (phase === "failed") {
    return (
      <span className="run-chip is-failed">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 4 L12 12" />
          <path d="M12 4 L4 12" />
        </svg>
        <span className="mono">no statement</span>
      </span>
    );
  }
  return <span className="mono run-chip is-waiting">waiting</span>;
}

function JudgeSeat({
  name,
  phase,
  judge,
  requestedModel,
  aborted,
}: {
  name: string;
  phase: BenchPhase;
  judge: JudgeView | undefined;
  requestedModel: string;
  aborted: boolean;
}) {
  const usage = usageOf(judge?.attempts ?? []);

  return (
    <div className={`run-seat is-${phase}`}>
      <JudgePortrait name={name} phase={phase} />
      <div className="run-seat-body">
        {/* Three identical portraits, so the name is what tells the seats apart. */}
        <div className="display run-seat-name">{name}</div>

        {phase === "ruled" && judge?.verdict && (
          <>
            <div className={`display run-verdict is-${judge.verdict === "guilty" ? "guilty" : "acquitted"}`}>
              {judge.verdict === "guilty" ? "Guilty" : "Not guilty"}
            </div>
            <div className="mono run-seat-meta">
              {judge.model ?? judge.requestedModel} · {judge.reasonCount}{" "}
              {judge.reasonCount === 1 ? "reason" : "reasons"}
              {usage.tokens !== null && <> · {usage.tokens.toLocaleString()} tokens</>}
            </div>
          </>
        )}

        {phase === "failed" && (
          <>
            <div className="run-seat-status is-failed">No readable verdict</div>
            <div className="mono run-seat-meta">
              {judge?.error ?? "This seat returned nothing a verdict could be read from."}
            </div>
          </>
        )}

        {phase === "deliberating" && (
          <div className="run-seat-status">Reading the statements…</div>
        )}

        {phase === "waiting" && (
          <div className="run-seat-status">
            {aborted ? "Never asked — the run stopped first" : "Awaiting the statements"}
          </div>
        )}

        {phase !== "ruled" && phase !== "failed" && requestedModel !== "" && (
          <div className="mono run-seat-meta">{requestedModel}</div>
        )}
      </div>

      {/* The gavel taps while the seat is out and rests once it has ruled. */}
      <Gavel active={phase === "deliberating"} />
    </div>
  );
}

function Gavel({ active }: { active: boolean }) {
  return (
    <svg
      className={`run-gavel${active ? " is-tapping" : ""}`}
      width="42"
      height="42"
      viewBox="0 0 44 44"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className="run-gavel-head">
        <rect x="13" y="9" width="18" height="9" rx="2.5" transform="rotate(-38 22 13.5)" />
        <path d="M24 18 L31 30" />
      </g>
      <path d="M12 36 L32 36" />
    </svg>
  );
}

/** The footer's left half: what the connection is doing, or how the run ended. */
function RunStatus({
  state,
  runId,
  finished,
  record,
}: {
  state: RunSnapshot;
  runId: string | null;
  finished: boolean;
  record: RunRecordView | null;
}) {
  if (state.lost !== null && !finished) {
    return <span className="run-status is-warning">{state.lost}</span>;
  }

  if (state.phase === "reconnecting") {
    return (
      <span className="run-status is-warning">
        The connection dropped — picking the trial back up where it left off. The run is
        still going on the server.
      </span>
    );
  }

  if (record !== null) {
    return <span className="run-status">{outcomeLine(record)}</span>;
  }

  if (!finished) {
    return (
      <span className="mono run-status-id">
        {runId ? `run ${runId.slice(0, 4)} · ` : ""}close this tab and come back — the trial
        keeps going without you
      </span>
    );
  }

  return <span className="run-status is-warning">The run ended early.</span>;
}

/**
 * How the run ended, in one sentence.
 *
 * The outcome is a shape rather than a verdict with a flag (specs.md Part 3), so each kind
 * is written out separately here — there is no branch in which a verdict could be printed
 * for a run that never reached one.
 */
function outcomeLine(record: RunRecordView): string {
  const outcome = record.outcome;
  switch (outcome.kind) {
    case "verdict": {
      const count =
        outcome.verdict === "guilty"
          ? `${outcome.tally.guilty}–${outcome.tally.notGuilty}`
          : `${outcome.tally.notGuilty}–${outcome.tally.guilty}`;
      const word = outcome.verdict === "guilty" ? "Guilty" : "Not guilty";
      return `${word}, ${count}${record.complete ? "" : " — on an incomplete trial"}.`;
    }
    case "hung":
      return "Hung — one for, one against, and no third verdict to break it.";
    case "inconclusive":
      return `Inconclusive. ${outcome.why}`;
    case "aborted":
      return "The run stopped before the bench heard it.";
    default:
      return "";
  }
}

/** A whole-sheet stop: refused, or unreachable. Nothing was spent in either case. */
function Stopped({
  heading,
  lead,
  children,
  onNewCase,
}: {
  heading: string;
  lead: string;
  children?: ReactNode;
  onNewCase: () => void;
}) {
  return (
    <AppFrame
      footer={
        <>
          <div className="app-sheet-footer-status">
            <span className="mono run-status-id">No model call was made.</span>
          </div>
          <div className="app-sheet-footer-actions">
            <Button variant="primary" onClick={onNewCase}>
              Back to the charge
            </Button>
          </div>
        </>
      }
    >
      <Masthead subtitle="The court is sitting. Statements arrive one at a time." step={3} />
      <div className="app-message">
        <Panel sunken className="app-message-panel">
          <h2 className="section-heading">{heading}</h2>
          <p>{lead}</p>
          {children}
        </Panel>
      </div>
    </AppFrame>
  );
}
