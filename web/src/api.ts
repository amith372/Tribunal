/**
 * What the browser reads from the server, and the shapes it comes in.
 *
 * Two GETs, both free of an API key and of any model call: `/api/health` for the roster
 * and the pre-flight's rules, `/api/models` for the identifiers a run will draw from.
 *
 * **Nothing here can name a model.** `/api/models` is read-only and reads nothing back
 * — specs.md Part 1: the identifiers live server-side and are never editable in the app.
 * The one model-related thing this client ever sends is a mode, and that goes on the run
 * request, not here.
 */

export type Side = "for" | "against";

export interface Character {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/**
 * The pre-flight's own rules, served so the setup screens can show their checks passing
 * as the user types. The server re-checks everything and is authoritative; this only
 * lets the screen agree with it in advance rather than keep a second copy of the rules
 * that would eventually disagree.
 */
export interface PreflightRules {
  readonly minChargeSheetWords: number;
  readonly maxChargeSheetWords: number;
  /** Per character id, the names the charge sheet is searched for. Shown to the user. */
  readonly searchedNames: Readonly<Record<string, readonly string[]>>;
  /** Word stems that read as an accusation. */
  readonly chargeCues: readonly string[];
}

export interface Health {
  readonly ok: boolean;
  readonly characters: readonly Character[];
  readonly judges: readonly string[];
  readonly relations: number;
  readonly preflight: PreflightRules;
  readonly apiKeyConfigured: boolean;
}

export interface ModelsView {
  readonly ok: boolean;
  readonly solo: { readonly model: string; readonly seats: number };
  readonly perRole: {
    readonly judges: { readonly seats: number; readonly pool: readonly string[] };
    readonly advocates: { readonly seats: number; readonly pool: readonly string[] };
  };
  readonly fallbackRouter: string;
}

/** The run's only model-related input: a mode, never an identifier. */
export type Mode = "solo" | "per-role";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const getHealth = () => getJson<Health>("/api/health");
export const getModels = () => getJson<ModelsView>("/api/models");
