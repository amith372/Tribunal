/**
 * Where the portraits are, and getting all of them into the browser before they are needed.
 *
 * **The avatar files are named by short name, and the data files by id.** `grey-worm` is
 * `worm.webp` and `jon-snow` is `jon.webp`; that mapping belongs to the art rather than to
 * the roster, so it is written down once here instead of being guessed at by trimming a
 * hyphen. It lived in `CharacterTile.tsx` until the run screen needed it for preloading
 * too.
 *
 * **Preloading is not an optimisation here, it is a correctness fix.** The run screen
 * changes a portrait at the moment a statement lands, and a browser that has never fetched
 * `happy_tyrion.webp` would answer that change with an empty tile for as long as the
 * request takes — a flash of nothing at exactly the moment the user is watching. So every
 * state of every character is fetched while the trial is still opening, when there is
 * nothing else competing for the connection.
 */

export type TileState = "idle" | "thinking" | "happy";

export const AVATAR_KEYS: Record<string, string> = {
  "jon-snow": "jon",
  daenerys: "daenerys",
  tyrion: "tyrion",
  "grey-worm": "worm",
  cersei: "cersei",
};

const STATES: readonly TileState[] = ["idle", "thinking", "happy"];

/** The bench shares one portrait in two states, so judges are told apart by name. */
export const JUDGE_UNDONE = "/avatars/undone_judge.webp";
export const JUDGE_DONE = "/avatars/judge.webp";

/** `undefined` for an id the art has no portrait for — the tile then renders its fallback. */
export function avatarSrc(characterId: string, state: TileState): string | undefined {
  const key = AVATAR_KEYS[characterId];
  return key ? `/avatars/${state}_${key}.webp` : undefined;
}

/** Every file in `web/public/avatars`: 5 characters x 3 states, plus the two judge states. */
export function allAvatarSources(): readonly string[] {
  const characters = Object.keys(AVATAR_KEYS).flatMap((id) =>
    STATES.map((state) => avatarSrc(id, state) as string),
  );
  return [...characters, JUDGE_UNDONE, JUDGE_DONE];
}

let preloaded = false;

/**
 * Fetches every portrait into the browser's cache. Idempotent, and deliberately fire-and-
 * forget: a portrait that fails to load is the tile's own fallback problem, not a reason
 * to hold anything up.
 */
export function preloadAvatars(): void {
  if (preloaded) return;
  preloaded = true;
  for (const src of allAvatarSources()) {
    const image = new Image();
    image.src = src;
  }
}
