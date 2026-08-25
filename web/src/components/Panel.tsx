import type { ReactNode } from "react";
import "./Panel.css";

/**
 * A cream panel ruled in tan — the one container the sheet uses for content.
 *
 * Three tones, and they mean different things rather than merely looking different:
 *   · `panel`  — the ordinary case: something to read or fill in.
 *   · `inset`  — a step further in, for a value the panel above it is about.
 *   · `raised` — sitting on top of the sheet rather than cut into it; Side Select's
 *                unassigned cards, which are the ones still asking for a decision.
 *
 * Keeping them as tones on one component rather than three components is what stops a
 * fourth cream box appearing with its own border colour.
 */
export type PanelTone = "panel" | "inset" | "raised";

export function Panel({
  children,
  tone = "panel",
  /** The pressed-into-the-sheet shadow. Off for anything that should sit on top. */
  sunken = false,
  className,
}: {
  children: ReactNode;
  tone?: PanelTone;
  sunken?: boolean;
  className?: string;
}) {
  const classes = ["panel", `panel-${tone}`];
  if (sunken) classes.push("is-sunken");
  if (className) classes.push(className);
  return <div className={classes.join(" ")}>{children}</div>;
}

/**
 * The crimson bar that heads a framed section — Side Select's title strip. Same plate as
 * the masthead, lit a step brighter because it sits *inside* the sheet rather than above
 * it, which is the difference between a heading and a frame.
 */
export function SectionBar({ children }: { children: ReactNode }) {
  return (
    <div className="section-bar">
      <div className="display section-bar-label">{children}</div>
    </div>
  );
}
