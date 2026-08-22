import "./CharacterTile.css";

/**
 * One character's portrait, in one of its three states.
 *
 * The art is the project's own: five characters at 256 px in `idle` / `thinking` /
 * `happy`, encoded at Stage 5. Only `idle` is used on the setup screens — a character
 * who has not been asked anything yet is idle — but the state is a prop rather than a
 * constant because Stage 7 flips these same tiles to `thinking` and then `happy` as each
 * statement lands, and a tile that could only ever be idle would have to be rebuilt then.
 *
 * **The avatar files are named by short name, and the data files by id.** `grey-worm` is
 * `worm.webp` and `jon-snow` is `jon.webp`; that mapping is the art's, not the roster's,
 * so it is written down here rather than guessed at by trimming a hyphen.
 */

const AVATAR_KEYS: Record<string, string> = {
  "jon-snow": "jon",
  daenerys: "daenerys",
  tyrion: "tyrion",
  "grey-worm": "worm",
  cersei: "cersei",
};

export type TileState = "idle" | "thinking" | "happy";

/**
 * What the portrait's frame says. `defense` and `prosecution` are the verdict palette's
 * green and crimson — the same two colours a result panel uses, so a side means one
 * colour across the whole app.
 */
export type TileTone = "neutral" | "accused" | "defense" | "prosecution";

export function CharacterTile({
  characterId,
  name,
  state = "idle",
  size = 70,
  tone = "neutral",
}: {
  characterId: string;
  name: string;
  state?: TileState;
  /** Edge length in px. The screens use 34 (a chip), 50 (a row) and 70 (the track). */
  size?: number;
  tone?: TileTone;
}) {
  const key = AVATAR_KEYS[characterId];

  return (
    <img
      className={`character-tile tone-${tone}`}
      src={key ? `/avatars/${state}_${key}.webp` : undefined}
      // The portrait carries no information the name beside it does not, so on the
      // screens it is decorative — but it is the only thing identifying a card while the
      // plaque is out of view on a narrow phone, so it keeps a real alt.
      alt={name}
      width={size}
      height={size}
      style={{ width: `${size}px`, height: `${size}px` }}
      draggable={false}
    />
  );
}
