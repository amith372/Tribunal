/**
 * models-check.ts — is every pinned identifier still live and still free?
 *
 * specs.md Part 5: the free roster rotates, sometimes weekly, so the pinned
 * identifiers are re-checked before a demo. A check that depends on remembering to
 * look is not a check, so this is one command:
 *
 *   npm run models:check
 *
 * It prints each pinned identifier as live or GONE beside the environment variable
 * that overrides it, then every free identifier OpenRouter is currently offering — so
 * a delisting and its replacement are visible in the same output. Fixing one is a
 * configuration change on the host, never a code change.
 *
 * Deliberately a script and never an endpoint. A way to change models at runtime is
 * the cost hole Part 5 forbids.
 *
 * Needs no API key: the model list is public.
 */

import { FALLBACK_ROUTER, getModelRegistry, isFreeModelId } from "../src/config.js";

const ENDPOINT = "https://openrouter.ai/api/v1/models";

/** Only the two fields this script reads; the payload carries far more. */
interface ModelsResponse {
  readonly data?: readonly { readonly id?: string }[];
}

/** Which env var overrides each slot, so a GONE line says what to set. */
const SLOT_ENV: readonly (readonly [string, string])[] = (() => {
  const { solo, judgePool, advocatePool } = getModelRegistry();
  return [
    [solo, "TRIBUNAL_MODEL_SOLO"],
    ...judgePool.map((id, i) => [id, `TRIBUNAL_MODEL_JUDGE_${i + 1}`] as const),
    ...advocatePool.map((id, i) => [id, `TRIBUNAL_MODEL_ADVOCATE_${i + 1}`] as const),
  ];
})();

async function main(): Promise<void> {
  let live: Set<string>;
  try {
    const response = await fetch(ENDPOINT, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as ModelsResponse;
    live = new Set((body.data ?? []).map((m) => m.id).filter((id): id is string => !!id));
  } catch (error) {
    console.error(`Could not reach ${ENDPOINT}: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nOpenRouter roster checked ${new Date().toISOString().slice(0, 10)} — ${live.size} models listed.\n`);

  const width = Math.max(...SLOT_ENV.map(([id]) => id.length));
  const missing: string[] = [];

  // The router is the last entry of every fallback chain, so its absence is the one
  // that would quietly remove the degradation guarantee rather than one role.
  const rows: (readonly [string, string])[] = [...SLOT_ENV, [FALLBACK_ROUTER, "— fallback router"]];

  for (const [id, env] of rows) {
    const ok = live.has(id);
    if (!ok) missing.push(`${id}  →  set ${env}`);
    console.log(`  ${ok ? "live" : "GONE"}  ${id.padEnd(width)}  ${env}`);
  }

  const free = [...live].filter(isFreeModelId).sort();
  console.log(`\nFree identifiers currently on offer (${free.length}):`);
  for (const id of free) console.log(`  ${id}`);

  if (missing.length > 0) {
    console.log(`\n${missing.length} pinned identifier(s) no longer listed. Replace from the list above:`);
    for (const line of missing) console.log(`  ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll pinned identifiers are live and free.\n");
}

void main();
