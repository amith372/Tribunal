/**
 * The cost-containment guard (specs.md Part 2: "there is no field, setting, or
 * environment variable by which a run can be made to use a paid model"; Part 5: a
 * user-editable model field is a cost hole).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  FALLBACK_ROUTER,
  ModelPolicyError,
  assertAllowedModel,
  fallbackChainFor,
  getModelRegistry,
  isFreeModelId,
  resetModelRegistry,
  resolveRunModels,
} from "../config.js";
import { DEFAULT_MAX_ATTEMPTS } from "../openrouter.js";

const OVERRIDE_KEYS = [
  "TRIBUNAL_MODEL_SOLO",
  "TRIBUNAL_MODEL_JUDGE_1",
  "TRIBUNAL_MODEL_JUDGE_2",
  "TRIBUNAL_MODEL_JUDGE_3",
  "TRIBUNAL_MODEL_ADVOCATE_1",
  "TRIBUNAL_MODEL_ADVOCATE_2",
  "TRIBUNAL_MODEL_ADVOCATE_3",
  "TRIBUNAL_MODEL_ADVOCATE_4",
];

afterEach(() => {
  for (const key of OVERRIDE_KEYS) delete process.env[key];
  resetModelRegistry();
});

describe("the free rule", () => {
  it("accepts an identifier ending in :free", () => {
    expect(isFreeModelId("google/gemma-4-31b-it:free")).toBe(true);
  });

  it("accepts the fallback router by explicit exception, not a loosened suffix", () => {
    // It ends in `/free`, not `:free`. The exception is the entry, not the pattern —
    // a `free$` rule would also admit whatever a future roster happens to name so.
    expect(isFreeModelId(FALLBACK_ROUTER)).toBe(true);
    expect(isFreeModelId("someone/pretend-free")).toBe(false);
    expect(isFreeModelId("someone/model-free")).toBe(false);
  });

  it("rejects a paid identifier", () => {
    expect(isFreeModelId("openai/gpt-4o")).toBe(false);
    expect(isFreeModelId("anthropic/claude-opus-4")).toBe(false);
  });
});

describe("assertAllowedModel", () => {
  it("passes every model in the registry", () => {
    const registry = getModelRegistry();
    for (const id of registry.allowlist) {
      expect(() => assertAllowedModel(id)).not.toThrow();
    }
  });

  it("passes the fallback router", () => {
    expect(() => assertAllowedModel(FALLBACK_ROUTER)).not.toThrow();
  });

  it("refuses a paid identifier", () => {
    expect(() => assertAllowedModel("openai/gpt-4o")).toThrow(ModelPolicyError);
    expect(() => assertAllowedModel("openai/gpt-4o")).toThrow(/not a free model/);
  });

  it("refuses a free identifier that is not on the allowlist", () => {
    // Free is necessary but not sufficient — an unvetted model never gets called
    // just because its name ends the right way.
    expect(() => assertAllowedModel("some-vendor/never-vetted:free")).toThrow(/allowlist/);
  });
});

describe("environment overrides", () => {
  it("lets a free identifier be swapped in without a code change", () => {
    // The roster rotates weekly (specs.md Part 5), so a delisted id must be
    // replaceable on the host. Doing so puts it on the allowlist.
    process.env.TRIBUNAL_MODEL_JUDGE_2 = "some-vendor/newly-listed:free";
    resetModelRegistry();

    expect(getModelRegistry().judgePool).toContain("some-vendor/newly-listed:free");
    expect(() => assertAllowedModel("some-vendor/newly-listed:free")).not.toThrow();
  });

  it("refuses to start when an override names a paid model", () => {
    // The escape hatch that must not exist: no env var can widen the free rule.
    process.env.TRIBUNAL_MODEL_JUDGE_1 = "openai/gpt-4o";
    resetModelRegistry();

    expect(() => getModelRegistry()).toThrow(ModelPolicyError);
    expect(() => getModelRegistry()).toThrow(/TRIBUNAL_MODEL_JUDGE_1/);
  });

  it("refuses a paid solo model too", () => {
    process.env.TRIBUNAL_MODEL_SOLO = "openai/gpt-4o";
    resetModelRegistry();
    expect(() => getModelRegistry()).toThrow(/not a free model/);
  });

  it("keeps a paid override off the allowlist entirely", () => {
    process.env.TRIBUNAL_MODEL_ADVOCATE_1 = "openai/gpt-4o";
    resetModelRegistry();
    expect(() => getModelRegistry()).toThrow(ModelPolicyError);

    delete process.env.TRIBUNAL_MODEL_ADVOCATE_1;
    resetModelRegistry();
    expect(getModelRegistry().allowlist.has("openai/gpt-4o")).toBe(false);
  });
});

describe("the registry itself", () => {
  it("holds only free identifiers", () => {
    for (const id of getModelRegistry().allowlist) {
      expect(isFreeModelId(id)).toBe(true);
    }
  });

  it("carries three judge models and four advocate models", () => {
    const registry = getModelRegistry();
    expect(registry.judgePool).toHaveLength(3);
    expect(registry.advocatePool).toHaveLength(4);
  });
});

describe("per-run model resolution", () => {
  it("gives solo mode one model for all seven roles", () => {
    const models = resolveRunModels("solo");
    const all = [...models.judges, ...models.advocates];
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(1);
  });

  it("permutes each pool in per-role mode without mixing them", () => {
    const registry = getModelRegistry();
    const models = resolveRunModels("per-role");

    expect([...models.judges].sort()).toEqual([...registry.judgePool].sort());
    expect([...models.advocates].sort()).toEqual([...registry.advocatePool].sort());
  });
});

describe("pool composition", () => {
  /**
   * specs.md Part 1: a pool holds no two models of the same lineage. Shuffling three
   * judges across models that share a training pipeline is not independence — two such
   * judges can agree for reasons that are not judicial, and a majority of three lets
   * that pair decide.
   *
   * The provider prefix is a proxy for lineage, not a definition of it: it catches the
   * case this rule was written for (two NVIDIA Nemotron 3 models on the bench at once)
   * without pretending to know how any two model families are related.
   */
  const providerOf = (id: string): string => id.split("/")[0] as string;

  it("draws the judge pool from three separate providers", () => {
    const { judgePool } = getModelRegistry();
    const providers = judgePool.map(providerOf);
    expect(new Set(providers).size).toBe(judgePool.length);
  });

  it("draws the advocate pool from separate providers too", () => {
    const { advocatePool } = getModelRegistry();
    const providers = advocatePool.map(providerOf);
    expect(new Set(providers).size).toBe(advocatePool.length);
  });
});

describe("fallback chains", () => {
  it("start at the role's model and end at the fallback router", () => {
    const registry = getModelRegistry();
    const primary = registry.judgePool[0] as string;
    const chain = fallbackChainFor(primary, "per-role", "judge");

    expect(chain[0]).toBe(primary);
    expect(chain[chain.length - 1]).toBe(FALLBACK_ROUTER);
  });

  it("contain no duplicates and nothing outside the allowlist", () => {
    const registry = getModelRegistry();
    const chain = fallbackChainFor(registry.advocatePool[2] as string, "per-role", "advocate");

    expect(new Set(chain).size).toBe(chain.length);
    for (const id of chain) expect(() => assertAllowedModel(id)).not.toThrow();
  });

  it("stay minimal in solo mode — the chosen model, then the router", () => {
    const registry = getModelRegistry();
    expect(fallbackChainFor(registry.solo, "solo", "judge")).toEqual([
      registry.solo,
      FALLBACK_ROUTER,
    ]);
  });

  /**
   * specs.md Part 1: no two roles share a model, and the distinctness holds under
   * failure. Two judges on the same weights reading the same prompt can agree for
   * reasons that are not judicial, and a majority of three lets one such pair decide.
   */
  it("never offer a model that is already serving another role in the run", () => {
    const models = resolveRunModels("per-role");

    for (const [index, primary] of models.judges.entries()) {
      const chain = fallbackChainFor(primary, "per-role", "judge", models.judges);
      const others = models.judges.filter((_, i) => i !== index);
      for (const other of others) expect(chain).not.toContain(other);
    }

    for (const [index, primary] of models.advocates.entries()) {
      const chain = fallbackChainFor(primary, "per-role", "advocate", models.advocates);
      const others = models.advocates.filter((_, i) => i !== index);
      for (const other of others) expect(chain).not.toContain(other);
    }
  });

  it("collapse to the role's own model and the router once every slot is taken", () => {
    const models = resolveRunModels("per-role");
    const primary = models.judges[0] as string;

    expect(fallbackChainFor(primary, "per-role", "judge", models.judges)).toEqual([
      primary,
      FALLBACK_ROUTER,
    ]);
  });

  /**
   * The router is the whole degradation guarantee (specs.md Part 5), and it is the
   * last entry — so a chain longer than the attempt cap would leave it never tried.
   * This is the regression guard for exactly that.
   */
  it("are short enough that the attempt cap still reaches the router", () => {
    const models = resolveRunModels("per-role");
    const chains = [
      ...models.judges.map((m) => fallbackChainFor(m, "per-role", "judge", models.judges)),
      ...models.advocates.map((m) =>
        fallbackChainFor(m, "per-role", "advocate", models.advocates),
      ),
      fallbackChainFor(getModelRegistry().solo, "solo", "judge"),
    ];

    for (const chain of chains) {
      expect(chain[chain.length - 1]).toBe(FALLBACK_ROUTER);
      expect(chain.length).toBeLessThanOrEqual(DEFAULT_MAX_ATTEMPTS);
    }
  });
});
