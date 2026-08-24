/**
 * The exported file and the results panels describe a run in the same words.
 *
 * Stage 8 gave the exported record the same five sections as the panels, in the same order
 * and under the same headings, so that specs.md Part 3's instruction — check the panels
 * against this file — can be carried out line by line rather than impressionistically. That
 * only means anything if the two actually agree. A file whose closing paragraph is a
 * near-miss of the screen's does not read as the same run recorded twice; it reads as two
 * accounts that do not quite match, which is the exact doubt the record exists to remove.
 *
 * The derivations therefore exist twice — `server/src/summary.ts` for the file,
 * `web/src/results-model.ts` for the browser — because the two workspaces compile
 * separately and the file has to render with no browser involved. **This test is what makes
 * two copies safe**, and it lives in the server's suite for the same reason the pre-flight
 * mirror's test does: what is being checked is *agreement*, and a test beside only one of
 * the two cannot check it.
 *
 * It runs both over a catalogue of records chosen for the shapes that read differently —
 * a clean 2–1, a unanimous bench, a silent seat, a missing advocate, a hung bench, a run
 * abandoned before judging, a solo-mode run, a shared lineage.
 */

import { describe, expect, it } from "vitest";

import type { RunRecord } from "../aggregate.js";
import * as server from "../summary.js";
import type { RunRecordView } from "../../../web/src/api.js";
import * as browser from "../../../web/src/results-model.js";
import { CATALOGUE } from "./record-cases.js";

/**
 * The browser's copy is typed against `RunRecordView` — the subset of the record the screens
 * read, written out by hand in `web/src/api.ts` rather than imported, because the two
 * workspaces compile separately.
 *
 * **This line is itself a check.** It is a plain assignment with no cast in it, so it only
 * compiles while a real `RunRecord` still satisfies the shape the browser believes it is
 * getting. A field that changed type on the server would stop this file compiling, which is
 * the earliest anyone could be told.
 */
const asView = (record: RunRecord): RunRecordView => record;

describe("the file and the panels say the same things about a run", () => {
  describe.each(CATALOGUE)("$name", ({ record }) => {
    it("heads the five sections identically", () => {
      expect(browser.PANELS).toEqual(server.PANELS);
    });

    it("gives the same finding, in the same words", () => {
      expect(browser.headline(asView(record))).toEqual(server.headline(record));
    });

    it("names the run the same way in the masthead and in the subtitle", () => {
      expect(browser.runSubtitle(asView(record))).toBe(server.runSubtitle(record));
    });

    it("puts the same advocates on the same side, in the same order", () => {
      const fromBrowser = browser.bySide(asView(record).statements);
      const fromServer = server.bySide(record.statements);
      expect(fromBrowser.defense.map((s) => s.advocateId)).toEqual(
        fromServer.defense.map((s) => s.advocateId),
      );
      expect(fromBrowser.prosecution.map((s) => s.advocateId)).toEqual(
        fromServer.prosecution.map((s) => s.advocateId),
      );
    });

    it("groups the calls into the same waves, with the same totals", () => {
      const fromBrowser = browser.stages(asView(record));
      const fromServer = server.stages(record);
      expect(fromBrowser.map((wave) => wave.stage)).toEqual(fromServer.map((wave) => wave.stage));
      expect(fromBrowser.map((wave) => wave.caption)).toEqual(
        fromServer.map((wave) => wave.caption),
      );
      expect(fromBrowser.map((wave) => wave.totalTokens)).toEqual(
        fromServer.map((wave) => wave.totalTokens),
      );
      expect(fromBrowser.map((wave) => wave.failed)).toEqual(fromServer.map((wave) => wave.failed));
    });

    it("lists the same eight facts, with the same values", () => {
      expect(browser.summaryRows(asView(record))).toEqual(server.summaryRows(record));
    });

    it("closes with the same two sentences", () => {
      expect(browser.closingLines(asView(record))).toEqual(server.closingLines(record));
    });

    it("reports the same roles as having answered", () => {
      expect(browser.rolesAnswered(asView(record))).toEqual(server.rolesAnswered(record));
    });

    it("carries the same standing notes", () => {
      expect(browser.findingNote()).toBe(server.findingNote());
      expect(browser.advocatesNote()).toBe(server.advocatesNote());
      expect(browser.benchNote(record.mode)).toBe(server.benchNote(record.mode));
    });
  });
});

describe("the catalogue covers the shapes that read differently", () => {
  it("includes every outcome kind, so no branch of the closing text is untested", () => {
    const kinds = new Set(CATALOGUE.map(({ record }) => record.outcome.kind));
    expect([...kinds].sort()).toEqual(["aborted", "hung", "inconclusive", "verdict"]);
  });

  it("includes an incomplete trial and a shared bench lineage", () => {
    expect(CATALOGUE.some(({ record }) => !record.complete)).toBe(true);
    expect(CATALOGUE.some(({ record }) => record.benchLineage.length > 0)).toBe(true);
    expect(CATALOGUE.some(({ record }) => record.mode === "solo")).toBe(true);
  });
});
