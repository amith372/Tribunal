/**
 * One run, held outside React.
 *
 * **The screen does not own the run, and this file is why.** A run is started by a click
 * and costs seven requests out of an allowance rationed in requests; it must therefore
 * begin exactly once, no matter how many times the component that displays it mounts. An
 * effect is the wrong place for that: React's StrictMode deliberately runs every effect
 * twice in development to surface effects that are not idempotent, and this one is the
 * expensive kind — two POSTs, fourteen requests, two trials of the same case. Rather than
 * turning that check off, the run is started where a run actually starts, in the event
 * handler, and the screen subscribes to something already under way.
 *
 * That also buys three things the effect version could not have:
 *
 *   · **Leaving the screen does not abandon the run.** The session outlives the component,
 *     so a re-render, a remount or a route change never drops the stream.
 *   · **A late subscriber misses nothing.** The state is accumulated here, so whoever
 *     subscribes reads the whole run so far rather than only what arrives next.
 *   · **The record survives the trial screen**, which is what the results panels will read.
 *
 * The state itself is a plain reduction over the stream's events, so it stays a pure
 * function of what the server sent — the same discipline `aggregate.ts` holds server-side.
 */

import type {
  JudgeView,
  PreflightEvent,
  PreflightFailure,
  RunRecordView,
  StatementView,
} from "./api.js";
import { openRunStream, type RunSource, type StreamPhase } from "./run-stream.js";
import { rememberRun } from "./run-memory.js";

export interface RunSnapshot {
  /** The casting and the bench, before a single model was asked anything. */
  readonly preflight: PreflightEvent | null;
  readonly statements: Readonly<Record<string, StatementView>>;
  readonly judges: Readonly<Record<string, JudgeView>>;
  readonly record: RunRecordView | null;
  /** Refused before any model call. Nothing was spent, and nothing will be. */
  readonly refusal: { failures: readonly PreflightFailure[]; message: string | null } | null;
  readonly lost: string | null;
  readonly serverError: string | null;
  readonly phase: StreamPhase;
  readonly attempt: number;
}

export const EMPTY_RUN: RunSnapshot = {
  preflight: null,
  statements: {},
  judges: {},
  record: null,
  refusal: null,
  lost: null,
  serverError: null,
  phase: "connecting",
  attempt: 0,
};

export interface RunSession {
  readonly source: RunSource;
  getSnapshot: () => RunSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Stops listening. The run itself goes on — the server does not need us. */
  close: () => void;
}

/**
 * Starts the stream and begins accumulating. Call this from a click, never from an effect.
 */
export function startRunSession(source: RunSource): RunSession {
  let snapshot = EMPTY_RUN;
  const listeners = new Set<() => void>();

  const update = (next: RunSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const close = openRunStream(source, {
    onPreflight: (event) => {
      // Parked so a reloaded tab rejoins this run instead of starting a second one.
      rememberRun(event.runId);
      update({ ...snapshot, preflight: event });
    },

    onStatement: (statement) =>
      update({
        ...snapshot,
        statements: { ...snapshot.statements, [statement.advocateId]: statement },
      }),

    onJudge: (judge) =>
      update({ ...snapshot, judges: { ...snapshot.judges, [judge.judgeId]: judge } }),

    /**
     * The record is authoritative and carries roles that never reported at all — an
     * advocate the run's deadline overtook has no `statement` event of its own but is in
     * here as the gap it is. Folding it in is what keeps the cards honest at the end.
     *
     * The run id is deliberately *kept*: the server holds a finished run for ten minutes,
     * so a reload inside that window walks back into the trial that just happened rather
     * than into an empty charge sheet.
     */
    onDone: (record) =>
      update({
        ...snapshot,
        record,
        statements: {
          ...snapshot.statements,
          ...Object.fromEntries(record.statements.map((s) => [s.advocateId, s])),
        },
        judges: {
          ...snapshot.judges,
          ...Object.fromEntries(record.judges.map((j) => [j.judgeId, j])),
        },
      }),

    onServerError: (message) => {
      rememberRun(null);
      update({ ...snapshot, serverError: message });
    },

    onRefused: (failures, message) => {
      rememberRun(null);
      update({ ...snapshot, refusal: { failures, message } });
    },

    onLost: (message) => update({ ...snapshot, lost: message }),

    onPhase: (phase, attempt) => update({ ...snapshot, phase, attempt }),
  });

  return {
    source,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      listeners.clear();
      close();
    },
  };
}
