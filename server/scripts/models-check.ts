/**
 * models-check.ts — what the app would cast a run from, right now.
 *
 * **This used to be a maintenance chore and is now a window.** Its old job was to name
 * which pinned identifiers had been delisted and which environment variable would replace
 * each one, because the roster was written out in `config.ts` and rotted there. specs.md
 * Part 1 no longer permits a hard-coded roster: the app asks OpenRouter at startup, so
 * there is nothing left to go stale and nothing to hand-edit.
 *
 * What is worth looking at instead is the *decision* — which free models arrived, which of
 * them this app refuses to seat and why, and how the survivors were dealt between the bench
 * and the advocates. That is what this prints:
 *
 *   npm run models:check
 *
 * Still deliberately a script and never an endpoint: discovery narrows the pool and can
 * only ever produce free models, but a way for a *user* to change models at runtime is the
 * cost hole specs.md Part 5 forbids.
 *
 * Needs no API key: the model list is public.
 */

import {
  EXCLUDED_MODELS,
  FALLBACK_ROUTER,
  JUDGE_INELIGIBLE,
  getModelRegistry,
  setRoster,
} from "../src/config.js";
import { discoverRoster } from "../src/roster.js";

const RULE = "─".repeat(78);

async function main(): Promise<void> {
  const roster = await discoverRoster();

  console.log(`\n${RULE}`);
  console.log(
    `OpenRouter — ${roster.models.length} free models ` +
      (roster.cached ? `(from the cache written ${roster.fetchedAt})` : "(fetched just now)"),
  );
  console.log(RULE);
  for (const id of roster.models) {
    const why = EXCLUDED_MODELS.get(id) ?? JUDGE_INELIGIBLE.get(id);
    const mark = EXCLUDED_MODELS.has(id) ? "refused " : JUDGE_INELIGIBLE.has(id) ? "advocate" : "        ";
    console.log(`  ${mark}  ${id}${why ? `\n              ${why}` : ""}`);
  }

  setRoster(roster.models);

  let registry;
  try {
    registry = getModelRegistry();
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  const { solo, judgePool, advocatePool, allowlist } = registry;

  console.log(`\n${RULE}`);
  console.log(`The bench draws from ${judgePool.length} models, for 3 seats`);
  console.log(RULE);
  for (const id of judgePool) console.log(`  ${id}`);

  console.log(`\n${RULE}`);
  console.log(`The advocates draw from ${advocatePool.length} models, for 4 seats`);
  console.log(RULE);
  for (const id of advocatePool) console.log(`  ${id}`);

  console.log(`\n  solo mode:       ${solo}`);
  console.log(`  fallback router: ${FALLBACK_ROUTER}`);
  console.log(`  allowlist:       ${allowlist.size} identifiers, and nothing else may be called.`);

  // The pools share no model, which is what keeps "no two roles share one" true before
  // `fallbackChainFor` is consulted at all (specs.md Part 1). Cheap to assert, and the kind
  // of thing that would otherwise be noticed only in a run.
  const overlap = judgePool.filter((id) => advocatePool.includes(id));
  if (overlap.length > 0) {
    console.error(`\n  ✗ the pools share ${overlap.length} model(s): ${overlap.join(", ")}\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  ✓ the two pools share no model.\n");
}

await main();
