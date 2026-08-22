/**
 * model-health.ts — a short memory of which models are refusing right now.
 *
 * The free roster is not a list of models that work; it is a list of models that exist.
 * Measured across three live runs on 2026-08-22, two identifiers refused every single
 * request in 0.1–0.4 seconds with `limit_source: "upstream_provider_shared_pool"` — the
 * free capacity at the upstream provider is exhausted and shared with every other free
 * user, so it is not this account's quota and no amount of retrying by this app can move
 * it. Meanwhile other identifiers answered every time.
 *
 * Nothing in the app noticed. Each call started from the same fixed opinion of the roster,
 * so a judge whose model was saturated could be handed, as its one spare, another model
 * the advocates had already discovered was saturated a few seconds earlier — two requests
 * spent to learn the same thing twice, and a seat lost.
 *
 * So the process remembers. A model that refuses is marked cold for a while, and cold
 * models sink to the bottom of every ordering: they are picked last to fill a seat where a
 * maker has an alternative, and last to serve as anyone's spare.
 *
 * **This changes preference, never permission.** A cold model is still allowed, still on
 * the allowlist, still seated when it is the only thing that can fill a role — because the
 * bench needs three distinct makers and some makers have exactly one model. What it stops
 * is the pointless case: reaching for a model we already know is refusing when a model we
 * know is answering was available.
 *
 * Like the run buffer, this is memory and not a store: it lives in the process, it dies
 * with a restart, and it holds nothing but a model identifier and a timestamp.
 */

import type { ErrorKind } from "./openrouter.js";

/**
 * How long a refusal keeps a model cold.
 *
 * A shared-pool rate limit is explicitly temporary — the provider's own message says
 * "retry shortly" — so it lapses in minutes, and a model that recovers is picked up again
 * on its own without anything having to be edited. A model that is gone or gated is a
 * different fact with a different half-life: it will not come back within a session, and
 * re-testing it costs a request from a rationed daily allowance to be told so.
 */
const COLD_MS: Partial<Record<ErrorKind, number>> = {
  rate_limited: 10 * 60_000,
  server_error: 5 * 60_000,
  timeout: 5 * 60_000,
  model_unavailable: 6 * 60 * 60_000,
  model_forbidden: 6 * 60 * 60_000,
};

interface Cold {
  readonly until: number;
  readonly kind: ErrorKind;
}

const cold = new Map<string, Cold>();

/** Test seam, and what a restart does for free. */
export function resetModelHealth(): void {
  cold.clear();
}

/**
 * Records that a model refused. Failures that say nothing about the model are ignored:
 * a bad API key and an exhausted daily allowance are facts about the *account*, and every
 * model would report them equally, so cooling one would be reading the wrong lesson.
 */
export function noteFailure(model: string, kind: ErrorKind, now: number = Date.now()): void {
  const ms = COLD_MS[kind];
  if (ms === undefined) return;
  cold.set(model, { until: now + ms, kind });
}

/** Records that a model answered. Success is the only thing that clears a mark early. */
export function noteSuccess(model: string): void {
  cold.delete(model);
}

export function isCold(model: string, now: number = Date.now()): boolean {
  const entry = cold.get(model);
  if (!entry) return false;
  if (entry.until <= now) {
    cold.delete(model);
    return false;
  }
  return true;
}

/**
 * The same models, warm ones first, with the order inside each group untouched.
 *
 * A stable partition rather than a sort: the caller has usually already shuffled or ranked
 * its input for reasons of its own — a per-run permutation, a maker preference — and this
 * must not undo that. It only sinks what is known to be refusing.
 */
export function warmFirst(models: readonly string[], now: number = Date.now()): string[] {
  const warm: string[] = [];
  const chilled: string[] = [];
  for (const model of models) (isCold(model, now) ? chilled : warm).push(model);
  return [...warm, ...chilled];
}

/** What the process currently believes, for `/api/health` and for diagnosis. */
export function coldModels(now: number = Date.now()): { model: string; kind: ErrorKind }[] {
  return [...cold.entries()]
    .filter(([, entry]) => entry.until > now)
    .map(([model, entry]) => ({ model, kind: entry.kind }));
}
