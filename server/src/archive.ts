/**
 * archive.ts — the run archive: durable storage for a finished run, behind an interface
 * that is trivial to fake.
 *
 * `memoryArchive()` is the test fake — a `Map`, no I/O — and is what every other test in
 * this codebase should reach for. `mongoArchive()` is the real thing. `archiveFromEnv()`
 * returns `null` when `MONGODB_URI` is unset, and the whole app must keep working in that
 * state: offline dev, CI and the pre-commit hook must never need a database, the same way
 * `getServerConfig().apiKey === null` already degrades rather than throws.
 */

import { MongoClient, type Collection, type Db } from "mongodb";

import type { RunRecord } from "./aggregate.js";
import type { Relation } from "./data.js";
import {
  fromArchived,
  summaryOf,
  toArchived,
  type ArchivedAttempt,
  type ArchivedRun,
  type ArchiveSummary,
} from "./archive-shape.js";

export interface RunArchive {
  save(runId: string, record: RunRecord, relations: readonly Relation[]): Promise<void>;
  list(runIds: readonly string[]): Promise<readonly ArchiveSummary[]>;
  get(runId: string): Promise<{ runId: string; record: RunRecord } | null>;
}

/** The test fake — a `Map`, no I/O. */
export function memoryArchive(): RunArchive {
  const runs = new Map<string, ArchivedRun>();
  const attemptsByRun = new Map<string, readonly ArchivedAttempt[]>();

  return {
    save(runId, record, relations) {
      const archived = toArchived(runId, record, relations);
      runs.set(runId, archived.run);
      attemptsByRun.set(runId, archived.attempts);
      return Promise.resolve();
    },

    list(runIds) {
      const found = runIds
        .map((id) => runs.get(id))
        .filter((run): run is ArchivedRun => run !== undefined)
        .map(summaryOf)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return Promise.resolve(found);
    },

    get(runId) {
      const run = runs.get(runId);
      if (!run) return Promise.resolve(null);
      return Promise.resolve(fromArchived(run, attemptsByRun.get(runId) ?? []));
    },
  };
}

interface Collections {
  readonly runs: Collection<ArchivedRun>;
  readonly attempts: Collection<ArchivedAttempt>;
}

/**
 * One lazy singleton connection per repository, opened on first use and reused. Not
 * connected at import time — the test suite imports this module and must never open a
 * socket for it.
 */
export function mongoArchive(uri: string, dbName: string): RunArchive {
  let ready: Promise<Collections> | null = null;

  const connect = (): Promise<Collections> => {
    if (!ready) {
      ready = (async () => {
        const client = new MongoClient(uri);
        await client.connect();
        const db: Db = client.db(dbName);
        const runs = db.collection<ArchivedRun>("runs");
        const attempts = db.collection<ArchivedAttempt>("run_attempts");
        await Promise.all([
          runs.createIndex({ startedAt: -1 }),
          attempts.createIndex({ runId: 1, seq: 1 }),
        ]);
        return { runs, attempts };
      })();
    }
    return ready;
  };

  return {
    async save(runId, record, relations) {
      const { runs, attempts } = await connect();
      const archived = toArchived(runId, record, relations);
      await runs.replaceOne({ _id: runId }, archived.run, { upsert: true });
      // Idempotent: a re-save must not leave stale rows behind from a previous write.
      await attempts.deleteMany({ runId });
      if (archived.attempts.length > 0) await attempts.insertMany([...archived.attempts]);
    },

    async list(runIds) {
      if (runIds.length === 0) return [];
      const { runs } = await connect();
      const found = await runs
        .find({ _id: { $in: [...runIds] } })
        .sort({ startedAt: -1 })
        .toArray();
      return found.map(summaryOf);
    },

    async get(runId) {
      const { runs, attempts } = await connect();
      const run = await runs.findOne({ _id: runId });
      if (!run) return null;
      const rows = await attempts.find({ runId }).toArray();
      return fromArchived(run, rows);
    },
  };
}

export function archiveFromEnv(): RunArchive | null {
  const uri = process.env.MONGODB_URI?.trim();
  const dbName = process.env.MONGODB_DB?.trim();
  if (!uri || !dbName) return null;
  return mongoArchive(uri, dbName);
}
