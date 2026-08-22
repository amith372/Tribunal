import type { ReactNode } from "react";
import "./Button.css";

/**
 * The three button treatments, and there are exactly three on purpose.
 *
 * specs.md Part 1: "a single glossy blue plate for the one primary action a screen
 * offers". So `primary` is rationed — one per screen — and everything else is `secondary`
 * stone. A disabled button of either kind goes flat: present, greyed, and still saying
 * what it would do (see `--flat` in tokens.css for why nothing is hidden instead).
 *
 * The blue plate is also the app's only saturated colour, which is what lets a user find
 * the way forward on a screen made entirely of parchment without reading anything.
 */
export type ButtonVariant = "primary" | "secondary";

export function Button({
  children,
  variant = "secondary",
  disabled = false,
  onClick,
  /** The forward arrow the canvas puts on a step-advancing action. */
  trailingArrow = false,
  type = "button",
  title,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  trailingArrow?: boolean;
  type?: "button" | "submit";
  /** Why a disabled button is disabled, for a pointer. The screen says it in words too. */
  title?: string;
}) {
  const classes = ["btn", `btn-${variant}`];
  if (variant === "primary") classes.push("display");

  return (
    <button
      type={type}
      className={classes.join(" ")}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
      {trailingArrow && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8 H13" />
          <path d="M9 4 L13 8 L9 12" />
        </svg>
      )}
    </button>
  );
}
