/**
 * archive-shape.test.ts — the single most important test in the archive: a record must
 * survive being broken into `toArchived`'s two documents and put back together by
 * `fromArchived` with nothing lost, added, or reordered.
 *
 * `CATALOGUE` (`record-cases.ts`) is reused rather than hand-built records, on the same
 * reasoning `summary-mirror.test.ts` already relies on: it is built by running the real
 * pipeline, so it covers every shape the record can actually take — a clean split, a
 * unanimous bench, a silent seat, a missing advocate, a hung bench, a run abandoned
 * before judging, solo mode, and shared model lineage.
 */

import { describe, expect, it } from "vitest";

import { buildExportHtml } from "../export.js";
import { fromArchived, toArchived } from "../archive-shape.js";
import { CATALOGUE } from "./record-cases.js";

const RELATIONS = [
  { a: "jon-snow", b: "daenerys", text: "He knelt to her once, in the snow." },
];

describe("a record survives the round trip through the archive shape", () => {
  for (const { name, record } of CATALOGUE) {
    it(`${name}: comes back identical, and renders the identical export`, () => {
      const { run, attempts } = toArchived("test-run-id", record, RELATIONS);
      const back = fromArchived(run, attempts);

      expect(back.runId).toBe("test-run-id");
      expect(back.record).toEqual(record);
      expect(buildExportHtml(back.record)).toBe(buildExportHtml(record));
    });
  }
});

describe("relations stay on the server", () => {
  it("are present on the archived run and absent from the record handed back", () => {
    const { record } = CATALOGUE[0];
    const { run, attempts } = toArchived("test-run-id", record, RELATIONS);

    expect(run.relations).toEqual(RELATIONS);

    const back = fromArchived(run, attempts);
    expect(back.record).not.toHaveProperty("relations");
  });
});

describe("attempts are stored once and regrouped exactly", () => {
  it("keeps `record.attempts` in its original order after a round trip", () => {
    const { record } = CATALOGUE[0];
    const { run, attempts } = toArchived("test-run-id", record, RELATIONS);
    const back = fromArchived(run, attempts);

    expect(back.record.attempts.map((a) => a.label)).toEqual(
      record.attempts.map((a) => a.label),
    );
  });

  it("numbers attempts by their position in record.attempts, 0-based", () => {
    const { record } = CATALOGUE[0];
    const { attempts } = toArchived("test-run-id", record, RELATIONS);

    expect(attempts.map((a) => a.seq)).toEqual(record.attempts.map((_, i) => i));
    for (const attempt of attempts) expect(attempt.runId).toBe("test-run-id");
  });

  it("survives attempts arriving out of seq order", () => {
    const { record } = CATALOGUE[0];
    const { run, attempts } = toArchived("test-run-id", record, RELATIONS);
    const shuffled = [...attempts].reverse();

    const back = fromArchived(run, shuffled);
    expect(back.record).toEqual(record);
  });
});
