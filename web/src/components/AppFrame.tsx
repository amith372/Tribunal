import type { ReactNode } from "react";
import "./AppFrame.css";

/**
 * The bronze frame and the parchment sheet inside it — the one shape every screen is
 * drawn on (specs.md Part 1: "a bronze frame around a parchment sheet").
 *
 * The frame is structural rather than ornamental: it is what makes the app read as a
 * single case-review console instead of four pages that happen to share a palette, so it
 * belongs to a component the screens cannot opt out of.
 *
 * The footer is a slot rather than markup each screen repeats, because both setup screens
 * end the same way — a line of status on the left, the actions on the right — and two
 * copies of that rule would drift the moment one screen gained a third button.
 *
 * **The sheet is the height of the window, and only its middle scrolls.** specs.md Part 1
 * calls for "a single glossy blue plate for the one primary action a screen offers", and
 * that action lives in the footer — a footer that can fall below the fold is a screen
 * whose way forward is invisible on a short laptop display. So the masthead and the
 * footer are pinned and the body between them takes the overflow, which is also how the
 * old console this is drawn after would behave.
 */
export function AppFrame({
  children,
  footer,
}: {
  children: ReactNode;
  /** The band across the bottom of the sheet: status left, actions right. */
  footer?: ReactNode;
}) {
  return (
    <div className="app-frame">
      <div className="app-sheet">
        <div className="app-sheet-body">{children}</div>
        {footer !== undefined && <footer className="app-sheet-footer">{footer}</footer>}
      </div>
    </div>
  );
}
