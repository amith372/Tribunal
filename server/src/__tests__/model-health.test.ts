/**
 * The short memory of which models are refusing. Zero model calls: a clock is passed in.
 *
 * What matters here is the line between preference and permission. This module may sink a
 * model down an ordering; it may never remove one, and it may never conclude anything about
 * a model from a failure that was really about the account.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  coldModels,
  isCold,
  noteFailure,
  noteSuccess,
  resetModelHealth,
  warmFirst,
} from "../model-health.js";

const A = "nvidia/nemotron-3-ultra-550b-a55b:free";
const B = "google/gemma-4-31b-it:free";
const C = "poolside/laguna-xs-2.1:free";

beforeEach(resetModelHealth);

describe("what a failure teaches", () => {
  it("cools a model that was rate-limited", () => {
    noteFailure(B, "rate_limited");
    expect(isCold(B)).toBe(true);
    expect(isCold(A)).toBe(false);
  });

  it("cools a delisted or gated model for much longer than a rate limit", () => {
    const now = 1_000_000;
    noteFailure(B, "rate_limited", now);
    noteFailure(C, "model_forbidden", now);

    // A shared-pool rate limit says "retry shortly" and means it; a gated model will not
    // ungate itself, and re-testing it costs a request from a rationed daily allowance.
    const halfAnHour = now + 30 * 60_000;
    expect(isCold(B, halfAnHour)).toBe(false);
    expect(isCold(C, halfAnHour)).toBe(true);
  });

  /**
   * A rejected key and an exhausted daily allowance are facts about the *account*. Every
   * model would report them identically, so cooling the one that happened to be asked
   * would be reading the wrong lesson — and would sink a perfectly good model for the rest
   * of the session on the strength of something it had nothing to do with.
   */
  it("learns nothing about a model from a failure that was about the account", () => {
    noteFailure(A, "daily_limit");
    noteFailure(B, "unauthorized");

    expect(isCold(A)).toBe(false);
    expect(isCold(B)).toBe(false);
  });

  it("warms a model again the moment it answers", () => {
    noteFailure(B, "rate_limited");
    noteSuccess(B);
    expect(isCold(B)).toBe(false);
  });

  it("lets a mark lapse on its own, so a recovered model returns without an edit", () => {
    const now = 1_000_000;
    noteFailure(B, "rate_limited", now);
    expect(isCold(B, now + 60_000)).toBe(true);
    expect(isCold(B, now + 60 * 60_000)).toBe(false);
  });
});

describe("ordering by health", () => {
  it("sinks cold models below warm ones", () => {
    noteFailure(B, "rate_limited");
    expect(warmFirst([B, A, C])).toEqual([A, C, B]);
  });

  it("keeps the order it was given inside each group", () => {
    // The caller has already shuffled for the per-run permutation, or ranked by maker;
    // this must sink what is refusing without undoing any of that.
    noteFailure(B, "rate_limited");
    expect(warmFirst([C, B, A])).toEqual([C, A, B]);
  });

  it("changes nothing when everything is answering", () => {
    expect(warmFirst([C, A, B])).toEqual([C, A, B]);
  });

  it("changes nothing when everything is refusing", () => {
    for (const model of [A, B, C]) noteFailure(model, "rate_limited");
    // A preference, not a permission: with nothing warm left, every model is still offered
    // in the order the caller wanted them.
    expect(warmFirst([C, A, B])).toEqual([C, A, B]);
  });

  it("never drops a model, whatever it knows about it", () => {
    for (const model of [A, B, C]) noteFailure(model, "model_forbidden");
    expect(warmFirst([A, B, C])).toHaveLength(3);
  });
});

describe("what the process will admit to knowing", () => {
  it("reports only models still cold, with why", () => {
    const now = 1_000_000;
    noteFailure(B, "rate_limited", now);
    noteFailure(C, "model_unavailable", now);

    expect(coldModels(now + 1000)).toEqual(
      expect.arrayContaining([
        { model: B, kind: "rate_limited" },
        { model: C, kind: "model_unavailable" },
      ]),
    );
    // The rate limit has lapsed by now; the delisting has not.
    expect(coldModels(now + 30 * 60_000).map((entry) => entry.model)).toEqual([C]);
  });

  it("forgets everything on a reset, which is what a restart does for free", () => {
    noteFailure(B, "rate_limited");
    resetModelHealth();
    expect(coldModels()).toEqual([]);
  });
});
