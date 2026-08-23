import { useEffect, useState } from "react";
import "./Portrait.css";

/**
 * One portrait, animated, and able to change what it shows without flickering.
 *
 * specs.md Part 1 describes the trial screen as something that *moves*: "as each
 * advocate's statement arrives its avatar moves from idle to thinking to happy". The art
 * is seventeen static images, so the movement is CSS on those images rather than frames —
 * no new asset was drawn for it, and none is needed:
 *
 *   · **idle** — a slow rise and fall with a degree of roll, which reads as breathing.
 *   · **thinking** — a faster bob with a sway, over a soft pulsing glow.
 *   · **happy** — one bounce as the statement lands, settling into a gentler float.
 *   · **none** — held still, for a role that failed. A failed advocate must never reach
 *     the happy state, and it should not be breathing contentedly either.
 *
 * **The change between two states is a cross-fade, not a swap.** A hard `src` change reads
 * as a flicker — the eye sees the interruption rather than the transition — so the
 * outgoing image is left in place at full opacity and the incoming one is faded in over it.
 * That also means a state change costs nothing if the new file has not loaded: the old
 * portrait simply stays visible until it has. (`preloadAvatars` makes sure it has.)
 *
 * Reduced motion is handled globally in `tokens.css`, which flattens every animation and
 * transition on the page — the cross-fade included, so a state change there is instant.
 */

export type Motion = "none" | "idle" | "thinking" | "happy";

/** Matches `--portrait-fade` in the stylesheet. The outgoing layer is dropped after it. */
const FADE_MS = 300;

export function Portrait({
  src,
  alt,
  size,
  motion = "none",
  /** Applied to the image layers, so a caller can frame the portrait however it likes. */
  imageClassName,
  className,
  /** The letter shown if the image is missing or fails to load. */
  fallback,
}: {
  src: string | undefined;
  alt: string;
  size: number;
  motion?: Motion;
  imageClassName?: string;
  className?: string;
  fallback?: string;
}) {
  // `shown` is what is on top; `fading` is the layer still underneath it, if any. `v`
  // counts the changes so a repeat of an earlier state still restarts the fade.
  const [layers, setLayers] = useState({ shown: src, fading: undefined as string | undefined, v: 0 });
  const [broken, setBroken] = useState(false);

  if (src !== layers.shown) {
    setLayers((current) => ({ shown: src, fading: current.shown, v: current.v + 1 }));
    if (broken) setBroken(false);
  }

  useEffect(() => {
    if (layers.fading === undefined) return;
    const timer = setTimeout(
      () => setLayers((current) => ({ ...current, fading: undefined })),
      FADE_MS,
    );
    return () => clearTimeout(timer);
  }, [layers.v, layers.fading]);

  const classes = ["portrait", `motion-${motion}`];
  if (className) classes.push(className);

  return (
    <span
      className={classes.join(" ")}
      style={{ width: `${size}px`, height: `${size}px` }}
      // The name is beside every portrait on every screen, so the image itself adds
      // nothing for a screen reader — except on a narrow phone where the plaque wraps out
      // of view, which is why the img below still carries a real alt.
    >
      {motion === "thinking" && <span className="portrait-glow" aria-hidden="true" />}

      {layers.fading !== undefined && (
        <img
          key={`out-${layers.v}`}
          className={`portrait-layer${imageClassName ? ` ${imageClassName}` : ""}`}
          src={layers.fading}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}

      {src !== undefined && !broken && (
        <img
          key={`in-${layers.v}`}
          className={`portrait-layer is-entering${imageClassName ? ` ${imageClassName}` : ""}`}
          src={src}
          alt={alt}
          width={size}
          height={size}
          onError={() => setBroken(true)}
          draggable={false}
        />
      )}

      {/* specs.md leaves nothing riding on the art, so a portrait that will not load is
          replaced by the character's initial rather than by a broken-image glyph. */}
      {(src === undefined || broken) && (
        <span
          className={`display portrait-fallback${imageClassName ? ` ${imageClassName}` : ""}`}
          role="img"
          aria-label={alt}
        >
          {fallback ?? alt.slice(0, 1)}
        </span>
      )}
    </span>
  );
}
