/**
 * config.ts — the single source of truth for model identifiers.
 *
 * specs.md Part 1: the identifiers are chosen by the developer and live server-side;
 * they are never editable in the app, the browser never sends one, and no request may
 * introduce one. specs.md Part 5: a user-editable model field is a cost hole.
 *
 * The free rule is enforced in two layers, neither of which can be loosened:
 *   1. Every identifier this module hands out — pinned default or env override — must
 *      pass `isFreeModelId`. An override naming a paid model is a startup failure, not
 *      a silent fallback, so a misconfigured host never reaches a paid call.
 *   2. The allowlist is *composed* from exactly those validated identifiers. Nothing
 *      else is ever in it. `assertAllowedModel` is what openrouter.ts calls before a
 *      request leaves the server.
 *
 * There is deliberately no env var, flag, or request field that widens either layer.
 */

export type Mode = "solo" | "per-role";

/**
 * OpenRouter's own free router, the last entry in every fallback chain (specs.md
 * Part 5), so a mid-run delisting degrades a run instead of killing it. It ends in
 * `/free`, not `:free`, so it gets this explicit exception rather than a widened
 * suffix rule — matching `free$` would also admit whatever a future roster happens
 * to name that way.
 */
export const FALLBACK_ROUTER = "openrouter/free";

/**
 * Roster verified live and $0 on OpenRouter on 2026-08-21 (`npm run models:check`).
 *
 * The judge pool holds three *different lineages* on purpose (specs.md Part 1) — it
 * previously ran two NVIDIA Nemotron 3 models, and two judges built from shared weights
 * can agree for reasons that are not judicial, which a majority of three then lets
 * decide the verdict.
 */
const DEFAULTS = {
  solo: "nvidia/nemotron-3-ultra-550b-a55b:free",
  judges: [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "google/gemma-4-31b-it:free",
    "z-ai/glm-5.2:free",
  ],
  advocates: [
    "openai/gpt-oss-20b:free",
    "google/gemma-4-26b-a4b-it:free",
    "dots-studio/dots-3-note-preview:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
  ],
};

/** Env vars that may swap a delisted identifier without a code change (specs.md Part 5). */
const ENV_KEYS = {
  solo: "TRIBUNAL_MODEL_SOLO",
  judges: ["TRIBUNAL_MODEL_JUDGE_1", "TRIBUNAL_MODEL_JUDGE_2", "TRIBUNAL_MODEL_JUDGE_3"],
  advocates: [
    "TRIBUNAL_MODEL_ADVOCATE_1",
    "TRIBUNAL_MODEL_ADVOCATE_2",
    "TRIBUNAL_MODEL_ADVOCATE_3",
    "TRIBUNAL_MODEL_ADVOCATE_4",
  ],
};

export class ModelPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelPolicyError";
  }
}

/**
 * The free rule, hardcoded. A model is free if its identifier ends in `:free`, or if
 * it is the fallback router. Nothing else, under any configuration.
 */
export function isFreeModelId(id: string): boolean {
  return id === FALLBACK_ROUTER || id.endsWith(":free");
}

/** Reads one slot from env, falling back to the pinned default. A paid override throws. */
function resolveSlot(envKey: string, fallback: string): string {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  if (!isFreeModelId(raw)) {
    throw new ModelPolicyError(
      `${envKey} is set to "${raw}", which is not a free model. Only identifiers ` +
        `ending in ":free" (or "${FALLBACK_ROUTER}") are permitted. There is no ` +
        `setting that allows a paid model.`,
    );
  }
  return raw;
}

export interface ModelRegistry {
  /** One model for all seven roles, in solo mode. */
  readonly solo: string;
  /** The three stronger models judges draw from, in per-role mode. */
  readonly judgePool: readonly string[];
  /** The four models advocates draw from, in per-role mode. */
  readonly advocatePool: readonly string[];
  /** Every identifier this app may ever send, and nothing else. */
  readonly allowlist: ReadonlySet<string>;
}

function buildRegistry(): ModelRegistry {
  const solo = resolveSlot(ENV_KEYS.solo, DEFAULTS.solo);
  const judgePool = ENV_KEYS.judges.map((key, i) => resolveSlot(key, DEFAULTS.judges[i]));
  const advocatePool = ENV_KEYS.advocates.map((key, i) => resolveSlot(key, DEFAULTS.advocates[i]));

  // Composed from the validated identifiers above — never widened, and never read
  // from the environment as a list of its own.
  const allowlist = new Set<string>([solo, ...judgePool, ...advocatePool, FALLBACK_ROUTER]);

  return { solo, judgePool, advocatePool, allowlist };
}

let registry: ModelRegistry | null = null;

/** The model registry, built once from code defaults plus validated env overrides. */
export function getModelRegistry(): ModelRegistry {
  registry ??= buildRegistry();
  return registry;
}

/** Test seam: forget the cached registry so a test can vary the environment. */
export function resetModelRegistry(): void {
  registry = null;
}

/**
 * The guard openrouter.ts calls before every request. Both conditions hold, always:
 * free by the hardcoded rule, and on the composed allowlist.
 */
export function assertAllowedModel(id: string): void {
  const { allowlist } = getModelRegistry();
  if (!isFreeModelId(id)) {
    throw new ModelPolicyError(`Refused to call "${id}": not a free model.`);
  }
  if (!allowlist.has(id)) {
    throw new ModelPolicyError(
      `Refused to call "${id}": not on the app's free allowlist. ` +
        `Permitted: ${[...allowlist].sort().join(", ")}.`,
    );
  }
}

/** Fisher-Yates, used to permute a pool per run. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export interface RunModels {
  readonly mode: Mode;
  /** One model per judge, in judge order. */
  readonly judges: readonly string[];
  /** One model per advocate, in advocate order. */
  readonly advocates: readonly string[];
}

/**
 * Resolves the seven models for one run.
 *
 * specs.md Part 1: models are shuffled within their pool on every run, so a fixed
 * role-to-model mapping never confounds judicial temperament with model capability.
 * Solo mode runs one model for all seven roles, so there is nothing to permute.
 */
export function resolveRunModels(mode: Mode): RunModels {
  const { solo, judgePool, advocatePool } = getModelRegistry();
  if (mode === "solo") {
    return { mode, judges: [solo, solo, solo], advocates: [solo, solo, solo, solo] };
  }
  return { mode, judges: shuffled(judgePool), advocates: shuffled(advocatePool) };
}

/**
 * The chain tried for one call: the role's own model first, then any pool model *not
 * already serving another role this run*, then the fallback router last.
 *
 * specs.md Part 1: no two roles share a model, and the distinctness holds under
 * failure too. Failing a judge over onto a model another judge is using would put two
 * judges on the same weights reading the same prompt — and with a majority of three, a
 * pair that agrees for that reason decides the verdict, invisibly. So `assigned`
 * removes those models from the chain rather than trusting the shuffle alone.
 *
 * In per-role mode every pool slot is taken (three judges / three models, four
 * advocates / four models), so `spare` is empty and every chain is exactly
 * `[own model, router]`. That is deliberate, and it is also what keeps the router
 * reachable: openrouter.ts caps attempts at `DEFAULT_MAX_ATTEMPTS`, so a longer chain
 * would have its tail — the router — never actually tried. `chainReachesRouter` holds
 * that property under test.
 *
 * Every entry is allowlisted by construction, and openrouter.ts re-checks each anyway.
 */
export function fallbackChainFor(
  primary: string,
  mode: Mode,
  kind: "judge" | "advocate",
  /** Every model assigned to this kind of role in this run, from `resolveRunModels`. */
  assigned: readonly string[] = [],
): string[] {
  const { judgePool, advocatePool } = getModelRegistry();
  const pool = mode === "solo" ? [] : kind === "judge" ? judgePool : advocatePool;
  const inUse = new Set(assigned.filter((model) => model !== primary));
  const spare = pool.filter((model) => model !== primary && !inUse.has(model));
  return [...new Set([primary, ...spare, FALLBACK_ROUTER])];
}

export interface ServerConfig {
  readonly port: number;
  readonly apiKey: string | null;
  readonly appUrl: string;
  readonly isProduction: boolean;
}

export function getServerConfig(): ServerConfig {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return {
    port: Number(process.env.PORT ?? 3001),
    apiKey: key && key.length > 0 ? key : null,
    appUrl: process.env.APP_URL?.trim() || "http://localhost:3001",
    isProduction: process.env.NODE_ENV === "production",
  };
}

/**
 * Model calls need the key; `/api/health` and the pre-flight deliberately do not, so
 * the app is runnable and checkable without one. The message is readable on purpose —
 * a missing key should not surface as a stack trace.
 */
export function requireApiKey(): string {
  const { apiKey } = getServerConfig();
  if (!apiKey) {
    throw new ModelPolicyError(
      "OPENROUTER_API_KEY is not set. Model calls cannot run without it. Set it in a " +
        ".env file at the repo root for local development, or as an environment " +
        "variable on the host.",
    );
  }
  return apiKey;
}
