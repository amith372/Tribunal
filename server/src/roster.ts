/**
 * roster.ts — which models exist, asked of OpenRouter rather than written down.
 *
 * specs.md Part 1: membership comes from OpenRouter and the app maintains no hard-coded
 * list of free identifiers. The roster rotates, sometimes weekly, and a list a developer
 * typed is a list that rots — `config.ts` carried one for months with a comment saying
 * which day it had last been true.
 *
 * **Membership only.** This module answers "what is free right now" and nothing else.
 * Whether a model may be *seated* is `config.ts`'s decision, made after this one: the free
 * rule re-applied to the identifier, the recorded exclusions, and role fitness. Presence
 * here is necessary and never sufficient, and that separation is the whole point — being
 * listed and being usable are different properties, which this project learned by seating
 * a model that answered every request with 403.
 *
 * **Discovery narrows and never widens.** It can only ever hand back identifiers that pass
 * `isFreeModelId` *and* are priced at zero by OpenRouter's own listing, it is reachable by no user, no request field, no flag and no environment
 * variable, and nothing it returns can put a paid model in a seat. That is what keeps it on
 * the right side of specs.md Part 5's cost hole: what is forbidden there is a *user*-
 * reachable mechanism, not a change of roster.
 *
 * **When it fails, it says so rather than improvising.** A model list that does not arrive
 * leaves the app with the last one that did, and the app reports that it is working from a
 * cached roster. With no cache either, runs are refused in plain words. What it must never
 * do is fall back to seating models nothing has vetted: a run that completes on unvetted
 * models produces a record that looks legitimate and is not, which is the one outcome this
 * whole app is built to avoid.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isFreeModelId } from "./config.js";

const ENDPOINT = "https://openrouter.ai/api/v1/models";

/** Only the fields this module reads; the payload carries a great deal more. */
interface ModelsResponse {
  readonly data?: readonly {
    readonly id?: string;
    readonly pricing?: Readonly<Record<string, unknown>>;
  }[];
}

/**
 * Whether OpenRouter prices every part of this model at exactly zero.
 *
 * **The `:free` suffix is a name, and a name is not a price.** `isFreeModelId` reads the
 * identifier, which is a convention OpenRouter happens to follow — it is not a promise, and
 * nothing stops a listing from carrying a `:free` id beside a non-zero rate. specs.md Part 1
 * asks for both checks and says neither alone is sufficient; this is the half that reads the
 * number rather than the name.
 *
 * **A model whose price cannot be confirmed is not free.** No pricing block, an empty one,
 * or any value that is not exactly zero — including a negative, which means "not applicable"
 * rather than "no charge" — keeps the model out. The failure direction is deliberate: an
 * over-strict filter costs a model that could have been used and is visible immediately in
 * `models:check`, while an over-lax one spends real money on somebody's key.
 */
function isZeroPriced(pricing: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!pricing || typeof pricing !== "object") return false;
  const rates = Object.values(pricing);
  if (rates.length === 0) return false;
  return rates.every((rate) => {
    const value = Number(rate);
    return Number.isFinite(value) && value === 0;
  });
}

export interface Roster {
  /** Every free identifier OpenRouter listed, sorted so a run is reproducible. */
  readonly models: readonly string[];
  /** When the list was actually fetched — not when it was read from the cache. */
  readonly fetchedAt: string;
  /** True when discovery failed and this is the last list that arrived. */
  readonly cached: boolean;
}

export class RosterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterUnavailableError";
  }
}

/** The seam the tests replace, so none of this needs a network. */
export type RosterFetch = () => Promise<Response>;

/**
 * Where the last successful list is kept.
 *
 * A plain file beside the build. **On an ephemeral filesystem — Render's free tier, for
 * one — this does not survive a restart**, and that is a real limit rather than a bug: the
 * cache protects a running instance from a momentary outage at OpenRouter, not a cold start
 * from one. A cold start with no list and no answer refuses runs and says why, which is the
 * behaviour specs.md asks for.
 */
const CACHE_FILE = fileURLToPath(new URL("../.roster-cache.json", import.meta.url));

function readCache(): Roster | null {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Partial<Roster>;
    const models = (raw.models ?? []).filter((id) => typeof id === "string" && isFreeModelId(id));
    if (models.length === 0) return null;
    return { models, fetchedAt: raw.fetchedAt ?? "unknown", cached: true };
  } catch {
    return null;
  }
}

function writeCache(roster: Roster): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(roster, null, 2), "utf8");
  } catch (error) {
    // A cache that cannot be written is a smaller problem than a run that cannot happen.
    console.warn(`Could not cache the model roster: ${(error as Error).message}`);
  }
}

export interface DiscoverOptions {
  readonly fetchModels?: RosterFetch;
  /** Test seam: skips reading and writing the file. */
  readonly cache?: { read: () => Roster | null; write: (roster: Roster) => void };
}

/**
 * The current free roster, or the last one that arrived, or a refusal.
 *
 * The `:free` filter is applied to what OpenRouter returns rather than trusted from it:
 * `isFreeModelId` is the same rule `assertAllowedModel` enforces before a request leaves
 * the server, so the two cannot disagree about what "free" means.
 */
export async function discoverRoster(options: DiscoverOptions = {}): Promise<Roster> {
  const fetchModels = options.fetchModels ?? (() => fetch(ENDPOINT, { signal: AbortSignal.timeout(30_000) }));
  const cache = options.cache ?? { read: readCache, write: writeCache };

  try {
    const response = await fetchModels();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as ModelsResponse;

    // Both checks, and in this order: the name has to say free *and* every rate has to be
    // zero. specs.md Part 1 — neither alone is sufficient.
    const models = [...new Set(
      (body.data ?? [])
        .filter((entry) => isZeroPriced(entry.pricing))
        .map((entry) => entry.id),
    )]
      .filter((id): id is string => typeof id === "string" && isFreeModelId(id))
      .sort();

    if (models.length === 0) throw new Error("the list carried no free models");

    const roster: Roster = { models, fetchedAt: new Date().toISOString(), cached: false };
    cache.write(roster);
    return roster;
  } catch (error) {
    const why = (error as Error).message;
    const fallback = cache.read();
    if (fallback) {
      console.warn(`Could not reach ${ENDPOINT} (${why}) — using the roster cached ${fallback.fetchedAt}.`);
      return fallback;
    }
    throw new RosterUnavailableError(
      `Could not reach ${ENDPOINT} (${why}), and no roster has been cached. ` +
        "There are no models available, so no run can be started. Nothing was spent.",
    );
  }
}
