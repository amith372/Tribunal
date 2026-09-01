/**
 * Discovery: what the app does with OpenRouter's model list, and what it does without one.
 *
 * specs.md Part 1 makes membership OpenRouter's to decide and eligibility this app's. These
 * tests are about the first half only — what arrives, what is filtered on the way in, and
 * the three ways a fetch can leave the app worse off than before it asked.
 *
 * No test here opens a socket. `discoverRoster` takes its fetch and its cache as options
 * for the same reason `executeRun` takes its caller: a suite that depended on what
 * OpenRouter is offering today would be asserting on a Tuesday.
 */

import { describe, expect, it, vi } from "vitest";

import { discoverRoster, RosterUnavailableError, type Roster } from "../roster.js";

/**
 * A fetch that answers with a model list, shaped as OpenRouter's endpoint shapes it.
 *
 * Entries are priced at zero unless a test says otherwise, because that is what the real
 * listing carries for every model whose id ends in `:free` — checked against the live
 * endpoint on 2026-09-01, where the only pricing keys present were `prompt` and
 * `completion` and every value was the string "0".
 */
function listing(ids: readonly (string | undefined)[], ok = true, status = 200) {
  return () =>
    Promise.resolve({
      ok,
      status,
      json: () =>
        Promise.resolve({ data: ids.map((id) => ({ id, pricing: { prompt: "0", completion: "0" } })) }),
    } as Response);
}

/** A listing whose entries carry whatever pricing a test hands them. */
function priced(entries: readonly { id: string; pricing?: Record<string, string> }[]) {
  return () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: entries }) } as Response);
}

/** A cache that lives in this test and nowhere on disk. */
function memoryCache(seed: Roster | null = null) {
  let held = seed;
  return {
    read: () => held,
    write: (roster: Roster) => {
      held = roster;
    },
    get held() {
      return held;
    },
  };
}

describe("what discovery accepts", () => {
  it("keeps the free models and drops everything else", async () => {
    const roster = await discoverRoster({
      fetchModels: listing([
        "alpha/one:free",
        "openai/gpt-4o",
        "beta/two:free",
        "anthropic/claude-opus-4",
      ]),
      cache: memoryCache(),
    });

    expect(roster.models).toEqual(["alpha/one:free", "beta/two:free"]);
    expect(roster.cached).toBe(false);
  });

  /**
   * The free rule is re-applied to what arrives rather than trusted from it. `openrouter/
   * free` is the one identifier that does not end in `:free` and is still permitted — it is
   * the router every fallback chain ends with — so the filter has to know the same rule
   * `assertAllowedModel` knows, not a lookalike of it.
   */
  it("admits the fallback router, which is free without saying so", async () => {
    const roster = await discoverRoster({
      fetchModels: listing(["openrouter/free", "alpha/one:free"]),
      cache: memoryCache(),
    });
    expect(roster.models).toContain("openrouter/free");
  });

  it("sorts and de-duplicates, so the same listing gives the same roster", async () => {
    const roster = await discoverRoster({
      fetchModels: listing(["beta/two:free", "alpha/one:free", "beta/two:free", undefined]),
      cache: memoryCache(),
    });
    expect(roster.models).toEqual(["alpha/one:free", "beta/two:free"]);
  });

  /**
   * **The name is not the price.** `:free` is a convention OpenRouter happens to follow, not
   * a promise it has made, and the whole point of checking both is that a listing could
   * carry the suffix beside a real rate. A run must cost nothing, so a fraction of a cent is
   * as disqualifying as a dollar.
   */
  it("refuses a model named free that is not priced at zero", async () => {
    const roster = await discoverRoster({
      fetchModels: priced([
        { id: "alpha/honest:free", pricing: { prompt: "0", completion: "0" } },
        { id: "beta/liar:free", pricing: { prompt: "0", completion: "0.00000001" } },
      ]),
      cache: memoryCache(),
    });
    expect(roster.models).toEqual(["alpha/honest:free"]);
  });

  /**
   * A price that cannot be read is not a price of zero. Rejecting is the safe direction: it
   * costs a model that might have been usable, and `models:check` shows that immediately,
   * where the other way round spends money on somebody's key.
   */
  it("refuses a model whose price it cannot confirm", async () => {
    const roster = await discoverRoster({
      fetchModels: priced([
        { id: "alpha/priced:free", pricing: { prompt: "0", completion: "0" } },
        { id: "beta/no-pricing-block:free" },
        { id: "gamma/empty-pricing:free", pricing: {} },
        { id: "delta/not-applicable:free", pricing: { prompt: "0", completion: "-1" } },
      ]),
      cache: memoryCache(),
    });
    expect(roster.models).toEqual(["alpha/priced:free"]);
  });

  it("caches what it found, so the next failure has something to fall back to", async () => {
    const cache = memoryCache();
    await discoverRoster({ fetchModels: listing(["alpha/one:free"]), cache });
    expect(cache.held?.models).toEqual(["alpha/one:free"]);
  });
});

describe("what discovery does when it fails", () => {
  const dead = () => Promise.reject(new Error("network down"));

  it("falls back to the last roster that arrived, and says that it did", async () => {
    const cache = memoryCache({
      models: ["alpha/one:free", "beta/two:free"],
      fetchedAt: "2026-08-30T00:00:00.000Z",
      cached: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const roster = await discoverRoster({ fetchModels: dead, cache });

    expect(roster.models).toEqual(["alpha/one:free", "beta/two:free"]);
    expect(roster.cached).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  /**
   * The behaviour the whole module exists for. With no list and no cache the app has no
   * vetted model to seat, and specs.md Part 1 is explicit that it must refuse rather than
   * reach for whatever is available — a run completed on unvetted models produces a record
   * that looks legitimate and is not.
   */
  it("refuses when there is no list and nothing cached", async () => {
    await expect(discoverRoster({ fetchModels: dead, cache: memoryCache() })).rejects.toThrow(
      RosterUnavailableError,
    );
  });

  it("says plainly that nothing was spent", async () => {
    await expect(discoverRoster({ fetchModels: dead, cache: memoryCache() })).rejects.toThrow(
      /no run can be started. Nothing was spent/i,
    );
  });

  it("treats a non-OK response as a failure rather than as an empty roster", async () => {
    await expect(
      discoverRoster({ fetchModels: listing([], false, 503), cache: memoryCache() }),
    ).rejects.toThrow(RosterUnavailableError);
  });

  /**
   * A listing that parses but carries no free model is a failure, not a roster of none.
   * Accepting it would compose an empty allowlist and refuse every call one at a time,
   * which reads as seven broken models rather than as one unanswered question.
   */
  it("treats a listing with no free models as a failure", async () => {
    await expect(
      discoverRoster({ fetchModels: listing(["openai/gpt-4o"]), cache: memoryCache() }),
    ).rejects.toThrow(RosterUnavailableError);
  });

  it("does not overwrite a good cache with a bad fetch", async () => {
    const cache = memoryCache({ models: ["alpha/one:free"], fetchedAt: "x", cached: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await discoverRoster({ fetchModels: dead, cache });
    expect(cache.held?.models).toEqual(["alpha/one:free"]);
    warn.mockRestore();
  });
});
