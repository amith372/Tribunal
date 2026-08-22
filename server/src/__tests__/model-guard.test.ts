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
  ADVOCATE_SEATS,
  JUDGE_SEATS,
  MAX_ATTEMPTS_PER_CALL,
} from "../config.js";
import { DEFAULT_MAX_ATTEMPTS } from "../openrouter.js";

/**
 * The maker half of an identifier. A proxy for lineage, not a definition of it: it
 * catches the case the rule was written for — two NVIDIA Nemotron models on the bench at
 * once — without pretending to know how any two model families are related.
 */
const providerOf = (id: string): string => id.split("/")[0] as string;

const OVERRIDE_KEYS = [
  "TRIBUNAL_MODEL_SOLO",
  "TRIBUNAL_MODEL_JUDGE_1",
  "TRIBUNAL_MODEL_JUDGE_2",
  "TRIBUNAL_MODEL_JUDGE_3",
  "TRIBUNAL_MODEL_ADVOCATE_1",
  "TRIBUNAL_MODEL_ADVOCATE_2",
  "TRIBUNAL_MODEL_ADVOCATE_3",
  "TRIBUNAL_MODEL_ADVOCATE_4",
  "TRIBUNAL_MODEL_ADVOCATE_5",
  "TRIBUNAL_MODEL_ADVOCATE_6",
  "TRIBUNAL_MODEL_JUDGE_4",
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

  /**
   * Each pool is deliberately larger than the roles it serves, so every seat has a vetted
   * model to fall over onto before the router is ever considered. This assertion used to
   * read 3 and 4 — the seat counts — and it passed while `buildRegistry` was quietly
   * truncating both pools to exactly that, which is how the spares came to be configured
   * and never used. It is written against the seat counts now, not against literals.
   */
  it("carries more models than there are seats, so every role has a spare", () => {
    const registry = getModelRegistry();
    expect(registry.judgePool.length).toBeGreaterThan(JUDGE_SEATS);
    expect(registry.advocatePool.length).toBeGreaterThan(ADVOCATE_SEATS);
  });
});

describe("per-run model resolution", () => {
  it("gives solo mode one model for all seven roles", () => {
    const models = resolveRunModels("solo");
    const all = [...models.judges, ...models.advocates];
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(1);
  });

  it("seats one model per role in per-role mode, drawn from that role's own pool", () => {
    const registry = getModelRegistry();
    const models = resolveRunModels("per-role");

    expect(models.judges).toHaveLength(JUDGE_SEATS);
    expect(models.advocates).toHaveLength(ADVOCATE_SEATS);
    for (const model of models.judges) expect(registry.judgePool).toContain(model);
    for (const model of models.advocates) expect(registry.advocatePool).toContain(model);
  });

  it("never seats the same model twice in one run", () => {
    // specs.md Part 1: the defendant aside, no two roles share a model. What the shuffle
    // guarantees, the fallback chain then preserves by excluding assigned models.
    const models = resolveRunModels("per-role");
    const all = [...models.judges, ...models.advocates];
    expect(new Set(all).size).toBe(all.length);
  });

  it("varies which models take the seats from run to run", () => {
    // Part 1: models are shuffled per run so a fixed role-to-model mapping never
    // confounds judicial temperament with model capability.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(resolveRunModels("per-role").judges.join("|"));
    expect(seen.size).toBeGreaterThan(1);
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
  /**
   * The judge pool now carries a second NVIDIA model as depth for a failover, so the
   * lineage rule cannot be asserted over the pool's identifiers any more. What it is
   * really about is which models can be on the bench *at the same time*, and that is
   * asserted directly below and in the chain tests: enough makers to seat a distinct
   * bench, a bench that is always distinct, and a chain that never offers a spare whose
   * maker is already sitting.
   */
  it("offers more distinct makers than there are seats on the bench", () => {
    const { judgePool } = getModelRegistry();
    const makers = new Set(judgePool.map(providerOf));
    expect(makers.size).toBeGreaterThan(JUDGE_SEATS);
  });

  /**
   * The advocate pool carries two NVIDIA models — a first choice and a vetted spare — so
   * the maker rule cannot be asserted over the pool any more. It is asserted where it
   * actually matters instead: over the four models that take seats. `pickSeats` fills
   * them maker-first, so the four voices are drawn from four makers, which is what makes
   * "do the voices actually differ?" a real question. A shared maker among the *unseated*
   * spares costs nothing, because a spare only ever answers when a pinned model failed.
   */
  it("seats four advocates from four different makers", () => {
    for (let i = 0; i < 40; i++) {
      const { advocates } = resolveRunModels("per-role");
      const makers = advocates.map(providerOf);
      expect(new Set(makers).size).toBe(advocates.length);
    }
  });

  it("seats three judges from three different makers", () => {
    for (let i = 0; i < 40; i++) {
      const { judges } = resolveRunModels("per-role");
      const makers = judges.map(providerOf);
      expect(new Set(makers).size).toBe(judges.length);
    }
  });
});

describe("fallback chains", () => {
  /**
   * **A vetted spare outranks the router.** Decided 2026-08-22 after a live run in which
   * four of seven seats fell straight through to `openrouter/free`, which resolved a
   * content-safety classifier onto the bench and put two roles on one model twice. The
   * router is the degradation guarantee of last resort (specs.md Part 5), not the first
   * thing a rate-limited role reaches — and because `MAX_ATTEMPTS_PER_CALL` bounds how
   * far a chain is ever walked, "last" has to mean *last of the entries that get tried*,
   * not last of a list whose tail nothing reaches.
   */
  it("start at the role's own model and prefer a vetted spare to the router", () => {
    const registry = getModelRegistry();
    const primary = registry.judgePool[0] as string;
    const chain = fallbackChainFor(primary, "per-role", "judge");

    expect(chain[0]).toBe(primary);
    expect(chain[1]).not.toBe(FALLBACK_ROUTER);
    expect(registry.judgePool).toContain(chain[1]);
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

  /**
   * The regression guard for the fault this rule was written from. `resolveRunModels`
   * once returned the whole shuffled pool rather than one model per seat, and because
   * that same array is what marks models as "already serving another role", every unused
   * spare was marked in-use and stripped out — leaving `[own model, router]` and making
   * the widened pools worth nothing. The seat counts are the fix, so they are asserted.
   */
  it("hand out exactly one model per seat, leaving the rest of the pool as real spares", () => {
    const models = resolveRunModels("per-role");
    const registry = getModelRegistry();

    expect(models.judges).toHaveLength(JUDGE_SEATS);
    expect(models.advocates).toHaveLength(ADVOCATE_SEATS);
    expect(registry.judgePool.length).toBeGreaterThan(JUDGE_SEATS);
    expect(registry.advocatePool.length).toBeGreaterThan(ADVOCATE_SEATS);

    // Every seat in a real run therefore falls over onto a vetted model, not the router.
    for (const primary of models.judges) {
      expect(fallbackChainFor(primary, "per-role", "judge", models.judges)[1]).not.toBe(
        FALLBACK_ROUTER,
      );
    }
    for (const primary of models.advocates) {
      expect(fallbackChainFor(primary, "per-role", "advocate", models.advocates)[1]).not.toBe(
        FALLBACK_ROUTER,
      );
    }
  });

  it("fall back to the router only for a role with no vetted spare left", () => {
    const { judgePool } = getModelRegistry();
    const primary = judgePool[0] as string;

    // Every other pool model already serving a role: nothing vetted is left to offer.
    expect(fallbackChainFor(primary, "per-role", "judge", judgePool)).toEqual([
      primary,
      FALLBACK_ROUTER,
    ]);
  });

  /**
   * **A vetted model always beats the router, even one another seat is already holding.**
   *
   * Two roles sharing a fallback matters only if both fail in the same moment, and the
   * record discloses it either way. The router can resolve to a model this app has measured
   * and specifically rejected — on 2026-08-22 it produced a content-safety classifier that
   * cost the bench a seat, and a code model that wrote a statement with none of the
   * character in it. A held vetted model beats a lottery, so the router now appears in a
   * chain only when there is genuinely nothing else left.
   */
  it("keeps the router out of every chain while any vetted model remains", () => {
    for (let i = 0; i < 200; i++) {
      const models = resolveRunModels("per-role");

      for (const kind of ["judge", "advocate"] as const) {
        const seats = kind === "judge" ? models.judges : models.advocates;
        for (const primary of seats) {
          expect(fallbackChainFor(primary, "per-role", kind, seats)).not.toContain(
            FALLBACK_ROUTER,
          );
        }
      }
    }
  });

  /**
   * The bench prefers a spare from a maker it is not already using — a judge failing over
   * onto a different NVIDIA model while NVIDIA is already seated puts two sets of shared
   * weights on one prompt, and a majority of three lets such a pair decide.
   *
   * It is a preference, not a prohibition: the free roster is too thin to afford the
   * absolute version, and the alternatives to a same-maker spare are worse ones. So what is
   * asserted is that the seat's *own* spare — the one it will actually reach for first —
   * takes a fresh maker in the clear majority of castings, and that when it cannot,
   * `aggregate.ts` discloses it in the record.
   */
  it("gives most seats a spare from a maker the bench is not already using", () => {
    let fresh = 0;
    let total = 0;

    for (let i = 0; i < 200; i++) {
      const models = resolveRunModels("per-role");
      for (const [index, primary] of models.judges.entries()) {
        const spare = fallbackChainFor(primary, "per-role", "judge", models.judges)[1];
        if (!spare) continue;
        const otherMakers = models.judges.filter((_, k) => k !== index).map(providerOf);
        total++;
        if (!otherMakers.includes(providerOf(spare))) fresh++;
      }
    }

    expect(total).toBeGreaterThan(0);
    expect(fresh / total).toBeGreaterThan(0.5);
  });

  it("never hand the same spare to two judges, however the casting falls", () => {
    // The bench is where this has to be absolute: two judges failing onto one model would
    // vote twice with one mind, and a majority of three lets that pair decide.
    for (let i = 0; i < 200; i++) {
      const models = resolveRunModels("per-role");
      const spares = models.judges
        .map((primary) => fallbackChainFor(primary, "per-role", "judge", models.judges)[1])
        .filter((model) => model !== FALLBACK_ROUTER);

      expect(new Set(spares).size).toBe(spares.length);
    }
  });

  /**
   * **Thirteen usable models cannot give fourteen seats-plus-spares, so one seat goes
   * without — and it is deliberately an advocate.** A shared advocate spare only matters if
   * both advocates fail in the same moment and both reach for it, it is disclosed in the
   * record as a collision, and advocates do not vote. The same shortfall on the bench would
   * be a duplicated judge deciding a verdict. What must hold is that the sharing never
   * becomes a *seat* sharing: the casting itself is always seven distinct models.
   */
  it("lets two advocates share a spare, but never share a seat", () => {
    for (let i = 0; i < 200; i++) {
      const models = resolveRunModels("per-role");
      const all = [...models.judges, ...models.advocates];
      expect(new Set(all).size).toBe(all.length);
    }
  });

  /**
   * With the pools as deep as they are and spares assigned by search rather than in seat
   * order, **no seat's first fallback is the router at all**. It stays in the chain as the
   * guarantee of last resort for a role that genuinely has nothing vetted left — a roster
   * shrinking under the app, which specs.md Part 5 says happens — but it is no longer
   * something an ordinary rate limit reaches.
   *
   * Worth stating what this replaced: every failing seat used to go straight to it. In the
   * live run of 2026-08-22 that put a content-safety classifier on the bench and the same
   * model into two different roles, twice.
   */
  it("never make the router any seat's first fallback", () => {
    for (let i = 0; i < 200; i++) {
      const models = resolveRunModels("per-role");

      for (const primary of models.judges) {
        expect(fallbackChainFor(primary, "per-role", "judge", models.judges)[1]).not.toBe(
          FALLBACK_ROUTER,
        );
      }
      for (const primary of models.advocates) {
        expect(
          fallbackChainFor(primary, "per-role", "advocate", models.advocates)[1],
        ).not.toBe(FALLBACK_ROUTER);
      }
    }
  });

  it("give the same casting the same chains every time", () => {
    // The assignment searches for the best cover, so it must be deterministic or the
    // record would not reproduce: same casting in, same chains out.
    const models = resolveRunModels("per-role");
    const once = models.judges.map((p) => fallbackChainFor(p, "per-role", "judge", models.judges));
    const twice = models.judges.map((p) => fallbackChainFor(p, "per-role", "judge", models.judges));
    expect(once).toEqual(twice);
  });

  /**
   * A chain longer than the attempt cap advertises a fallback nothing ever tries — which
   * misleads a reader of the code and of the token table alike. It is truncated at the
   * source instead, so the chain is always exactly what will be attempted.
   */
  it("are never longer than the number of attempts that will be made", () => {
    const models = resolveRunModels("per-role");
    const chains = [
      ...models.judges.map((m) => fallbackChainFor(m, "per-role", "judge", models.judges)),
      ...models.advocates.map((m) =>
        fallbackChainFor(m, "per-role", "advocate", models.advocates),
      ),
      fallbackChainFor(getModelRegistry().solo, "solo", "judge"),
    ];

    for (const chain of chains) {
      expect(chain.length).toBeLessThanOrEqual(MAX_ATTEMPTS_PER_CALL);
      expect(chain.length).toBeLessThanOrEqual(DEFAULT_MAX_ATTEMPTS);
    }
  });
});
