/**
 * run-buffer.ts — the in-process hold that lets a browser let go of a run and come back.
 *
 * specs.md Part 3: "a run is addressable by an identifier, and the server holds it while
 * it is in flight and briefly after it finishes", so a reconnecting browser is sent
 * everything that has already arrived and then continues with the rest. A run costs seven
 * requests from an allowance rationed in requests and produces nothing exportable until it
 * finishes, so a refresh at second eight would otherwise destroy something expensive and
 * unrecoverable.
 *
 * **This is a buffer and not a store, and the distinction is the whole point.** It lives in
 * this process and dies with a restart, nothing is browsable, no past run is queryable,
 * there is no lookup by anything but an unguessable id, and every run is dropped a few
 * minutes after it ends. The 2026-08-18 no-database decision is untouched — the exported
 * file is still the run record, and this exists only so a moment's flakiness does not cost
 * seven calls and the record with them.
 *
 * Two bounds keep a long-lived process honest: `HOLD_AFTER_FINISH_MS` drops a finished run,
 * and `MAX_RUNS` drops the oldest if a wave of runs arrives faster than that.
 */

import { randomUUID } from "node:crypto";

/** The four events of a run, plus the one that reports a run that could not be made. */
export type RunEventName = "preflight" | "statement" | "judge" | "done" | "error";

export interface RunEvent {
  /** 1-based and gap-free, so a reconnecting client can say what it already has. */
  readonly seq: number;
  readonly event: RunEventName;
  readonly data: unknown;
}

/** How long a finished run stays reachable for a reconnect or a late export. */
export const HOLD_AFTER_FINISH_MS = 10 * 60 * 1000;

/** A ceiling on held runs, so a busy process cannot grow without bound. */
export const MAX_RUNS = 20;

export type Listener = (event: RunEvent) => void;

export interface BufferedRun {
  readonly id: string;
  readonly startedAt: number;
  readonly events: readonly RunEvent[];
  readonly finished: boolean;
  readonly finishedAt: number | null;
}

interface Entry {
  readonly id: string;
  readonly startedAt: number;
  readonly events: RunEvent[];
  finished: boolean;
  finishedAt: number | null;
  readonly listeners: Set<Listener>;
}

export class RunBuffer {
  private readonly runs = new Map<string, Entry>();

  constructor(
    private readonly holdMs: number = HOLD_AFTER_FINISH_MS,
    private readonly maxRuns: number = MAX_RUNS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Opens a run and returns its identifier. Unguessable on purpose: it is the only key. */
  open(): string {
    this.sweep();
    const id = randomUUID();
    this.runs.set(id, {
      id,
      startedAt: this.now(),
      events: [],
      finished: false,
      finishedAt: null,
      listeners: new Set(),
    });
    // Insertion order is age order, so the oldest is the first key.
    while (this.runs.size > this.maxRuns) {
      const oldest = this.runs.keys().next().value as string;
      this.drop(oldest);
    }
    return id;
  }

  /**
   * Records an event and hands it to whoever is listening. Buffering first is what makes
   * a reconnect lossless: an event is never sent to a live connection without being
   * recorded for the one that is not there yet.
   */
  push(id: string, event: RunEventName, data: unknown): RunEvent | null {
    const entry = this.runs.get(id);
    if (!entry || entry.finished) return null;

    const recorded: RunEvent = { seq: entry.events.length + 1, event, data };
    entry.events.push(recorded);
    for (const listener of entry.listeners) listener(recorded);
    return recorded;
  }

  /**
   * Closes a run. `done` and `error` are terminal, so they are pushed and the run sealed
   * in one step — nothing can be appended after the record that renders the run.
   */
  close(id: string, event: "done" | "error", data: unknown): RunEvent | null {
    const recorded = this.push(id, event, data);
    const entry = this.runs.get(id);
    if (entry) {
      entry.finished = true;
      entry.finishedAt = this.now();
    }
    return recorded;
  }

  get(id: string): BufferedRun | null {
    this.sweep();
    const entry = this.runs.get(id);
    if (!entry) return null;
    return {
      id: entry.id,
      startedAt: entry.startedAt,
      events: entry.events,
      finished: entry.finished,
      finishedAt: entry.finishedAt,
    };
  }

  /**
   * Replays everything after `fromSeq` and then follows the run live. Returns the
   * unsubscribe, or `null` if the run is not held any more.
   *
   * The replay happens synchronously before the listener is registered, so an event that
   * lands mid-replay cannot arrive twice or be skipped.
   */
  subscribe(id: string, fromSeq: number, listener: Listener): (() => void) | null {
    const entry = this.runs.get(id);
    if (!entry) return null;

    for (const event of entry.events) {
      if (event.seq > fromSeq) listener(event);
    }
    if (entry.finished) return () => {};

    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /** Held runs, for `/api/health`. A count only — nothing about a run is browsable. */
  size(): number {
    this.sweep();
    return this.runs.size;
  }

  private drop(id: string): void {
    this.runs.get(id)?.listeners.clear();
    this.runs.delete(id);
  }

  /**
   * Drops finished runs past their hold. Swept on access rather than on a timer: a timer
   * would keep the process awake, and a buffer nobody is asking about costs nothing to
   * leave sitting for a moment longer.
   */
  private sweep(): void {
    const cutoff = this.now() - this.holdMs;
    for (const entry of [...this.runs.values()]) {
      if (entry.finished && entry.finishedAt !== null && entry.finishedAt < cutoff) {
        this.drop(entry.id);
      }
    }
  }
}
