import { Portrait, type Motion } from "./Portrait.js";
import { avatarSrc, type TileState } from "./avatars.js";
import "./CharacterTile.css";

/**
 * One character's portrait, in one of its three states and one of its frames.
 *
 * The art is the project's own: five characters at 256 px in `idle` / `thinking` /
 * `happy`, encoded at Stage 5. The setup screens use `idle` only — a character who has
 * not been asked anything yet is idle — and the run screen moves the same tiles through
 * all three as the statements land.
 *
 * **State is the art; tone is the frame; motion is whether it moves.** They are three
 * props rather than one because they answer to different things: the state comes from what
 * the model did, the tone from what the card is saying about it, and the motion is off by
 * default so the setup screens stay exactly as still as they were drawn.
 */


/**
 * What the portrait's frame says.
 *
 * `defense` and `prosecution` are the verdict palette's green and crimson — the same two
 * colours a result panel uses, so a side means one colour across the whole app. The last
 * four are the run screen's, and `failed` is the load-bearing one: an advocate whose call
 * did not come back is framed as the gap it is and never reaches the happy state.
 */
export type TileTone =
  | "neutral"
  | "accused"
  | "defense"
  | "prosecution"
  | "waiting"
  | "thinking"
  | "spoke"
  | "failed";

export function CharacterTile({
  characterId,
  name,
  state = "idle",
  size = 70,
  tone = "neutral",
  motion = "none",
}: {
  characterId: string;
  name: string;
  state?: TileState;
  /** Edge length in px. The screens use 34 (a chip), 50 (a row), 56 and 70 (a card). */
  size?: number;
  tone?: TileTone;
  motion?: Motion;
}) {
  return (
    <Portrait
      src={avatarSrc(characterId, state)}
      // The portrait carries no information the name beside it does not, so on the setup
      // screens it is decorative — but it is the only thing identifying a card while the
      // plaque is out of view on a narrow phone, so it keeps a real alt.
      alt={name}
      size={size}
      motion={motion}
      imageClassName={`character-tile tone-${tone}`}
    />
  );
}
