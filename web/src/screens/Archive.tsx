import { useEffect, useState, type ReactNode } from "react";

import { AppFrame } from "../components/AppFrame.js";
import { Button } from "../components/Button.js";
import { CharacterTile } from "../components/CharacterTile.js";
import { Masthead } from "../components/Masthead.js";
import { Panel } from "../components/Panel.js";
import { getArchivedRun, listArchive, type ArchiveSummary, type RunRecordView } from "../api.js";
import { archivedRunIds, forgetArchivedRuns, missingArchiveIds } from "../run-memory.js";
import { headline, number, price } from "../results-model.js";
import { ResultsPanels } from "./Results.js";
import "./Archive.css";

/**
 * Past runs, as this browser remembers them.
 *
 * specs.md Part 3's per-browser rule, made into a screen: the server archives every run it
 * finishes, but a browser only ever lists the ids `run-memory.ts` kept for it — a run is
 * not discoverable by anyone who does not hold its id, and a second browser opening this
 * screen sees an empty list even for a run this one just ran. That rule is why this screen
 * asks `archivedRunIds()` first and treats the answer as the whole truth, rather than
 * asking the server what exists.
 *
 * **Opening a row renders the same `ResultsPanels` a live run ends on.** A row is fetched
 * once, on click, and handed straight to the panels a finished trial already uses — an
 * archived run cannot read differently from how it read the day it finished, because
 * nothing here re-derives what it says.
 */
export function Archive({ onBack }: { onBack: () => void }) {
  const [ids, setIds] = useState(() => archivedRunIds());
  // Already known synchronously when there is nothing to ask the server about — no effect
  // needed to reach that state, only to fetch when there is.
  const [rows, setRows] = useState<readonly ArchiveSummary[] | null>(() =>
    ids.length === 0 ? [] : null,
  );
  const [listError, setListError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openRecord, setOpenRecord] = useState<RunRecordView | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) return;
    let live = true;
    listArchive(ids)
      .then((found) => {
        if (live) setRows(found);
      })
      .catch((error: Error) => {
        if (live) setListError(error.message);
      });
    return () => {
      live = false;
    };
  }, [ids]);

  /**
   * Drops the remembered ids the server did not resolve.
   *
   * Only ever the *missing* ones, so `rows` stays true without being refetched — every row
   * on screen is a run the server just answered for, and none of them is being forgotten.
   * The new list is read back out of storage rather than computed here, so what the screen
   * shows next is what the browser actually holds.
   */
  const forgetMissing = (): void => {
    forgetArchivedRuns(missingArchiveIds(ids, (rows ?? []).map((row) => row.runId)));
    setIds(archivedRunIds());
  };

  const openRun = (runId: string): void => {
    setOpenId(runId);
    setOpenRecord(null);
    setOpenError(null);
    getArchivedRun(runId)
      .then((body) => setOpenRecord(body.record))
      .catch((error: Error) => setOpenError(error.message));
  };

  const closeRun = (): void => {
    setOpenId(null);
    setOpenRecord(null);
    setOpenError(null);
  };

  if (openId !== null) {
    if (openRecord !== null) {
      return (
        <ResultsPanels
          record={openRecord}
          runId={openId}
          onNewCase={closeRun}
          newCaseLabel="Back to your past runs"
        />
      );
    }
    return (
      <AppFrame
        footer={
          <div className="app-sheet-footer-actions">
            <Button onClick={closeRun}>Back to your past runs</Button>
          </div>
        }
      >
        <Masthead subtitle="Reading an archived run…" step={1} />
        <div className="app-message">
          {openError !== null ? (
            <Panel sunken className="app-message-panel">
              <h2 className="section-heading">This run could not be read</h2>
              <p>{openError}</p>
            </Panel>
          ) : (
            <p className="mono app-loading">Reading the record…</p>
          )}
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame
      footer={
        <div className="app-sheet-footer-actions">
          <Button onClick={onBack}>Back to the charge</Button>
        </div>
      }
    >
      <Masthead subtitle="Runs this browser has kept the id of." step={1} />
      <div className="archive">
        {ids.length === 0 ? (
          <EmptyState />
        ) : listError !== null ? (
          <ErrorState message={listError} />
        ) : rows === null ? (
          <p className="mono app-loading">Reading the archive…</p>
        ) : (
          <ArchiveList ids={ids} rows={rows} onOpen={openRun} onForgetMissing={forgetMissing} />
        )}
      </div>
    </AppFrame>
  );
}

function ArchiveList({
  ids,
  rows,
  onOpen,
  onForgetMissing,
}: {
  ids: readonly string[];
  rows: readonly ArchiveSummary[];
  onOpen: (runId: string) => void;
  onForgetMissing: () => void;
}) {
  const missing = missingArchiveIds(ids, rows.map((row) => row.runId)).length;

  return (
    <>
      {missing > 0 && (
        <Callout>
          <span className="archive-callout-text">
            {missing} of {ids.length} remembered {ids.length === 1 ? "run" : "runs"} could not be
            found on this server — it may predate the archive, or have since been removed.
          </span>
          {/* specs.md Part 3: an unresolved id is dropped only when a person asks. The list
              of ids is the only handle a run has, and a server answering for the wrong
              database would look exactly like this. */}
          <Button variant="secondary" onClick={onForgetMissing}>
            {missing === 1 ? "Forget it" : "Forget them"}
          </Button>
        </Callout>
      )}

      {rows.length === 0 ? (
        <EmptyState prunedAll={missing > 0} />
      ) : (
        <div className="archive-list">
          {rows.map((row) => (
            <ArchiveRow key={row.runId} row={row} onOpen={() => onOpen(row.runId)} />
          ))}
        </div>
      )}
    </>
  );
}

function ArchiveRow({ row, onOpen }: { row: ArchiveSummary; onOpen: () => void }) {
  const head = headline(row);

  return (
    <button type="button" className="archive-row" onClick={onOpen}>
      <CharacterTile characterId={row.defendant.id} name={row.defendant.name} size={50} tone="accused" />

      <div className="archive-row-body">
        <div className="archive-row-top">
          <span className="display archive-row-name">{row.defendant.name}</span>
          <span className="mono archive-row-date">{dateOf(row.startedAt)}</span>
        </div>
        <p className="archive-row-charge">{row.chargePreview}</p>
      </div>

      <div className="archive-row-stats">
        <span className={`display archive-row-verdict is-${head.tone}`}>{head.title}</span>
        <span className="mono archive-row-tally">
          {row.tally.guilty}–{row.tally.notGuilty}
          {row.tally.failed > 0 && `–${row.tally.failed}`}
        </span>
        <span className="mono archive-row-cost">
          {price(row.costUsd)} · {number(row.totalTokens)} tok
        </span>
        {!row.complete && <span className="mono archive-row-incomplete">incomplete</span>}
      </div>
    </button>
  );
}

function EmptyState({ prunedAll = false }: { prunedAll?: boolean }) {
  return (
    <Panel sunken className="app-message-panel">
      <h2 className="section-heading">
        {prunedAll ? "None of the remembered runs are still on the server" : "No runs saved yet"}
      </h2>
      <p>
        {prunedAll
          ? "This browser held ids for past runs, but the server no longer has any of them."
          : "This browser has not kept the id of a finished run yet — one appears here as soon " +
            "as a trial reaches a verdict."}{" "}
        This list is per-browser: it only ever shows runs finished here, never a run from
        another browser or device.
      </p>
    </Panel>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Panel sunken className="app-message-panel">
      <h2 className="section-heading">The archive could not be read</h2>
      <p>{message}</p>
    </Panel>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="archive-callout">
      <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="9" cy="9" r="7" />
        <path d="M9 8 L9 13" />
        <path d="M9 5.5 L9 5.51" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

/** `12 August 2026`, in UTC — the same date format the results panels use. */
function dateOf(iso: string): string {
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ] as const;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}
