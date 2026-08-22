import "./Masthead.css";

/**
 * The crimson plate across the top of the sheet: scales mark, wordmark, one line of
 * subtitle, and the four-step rail on the right.
 *
 * **The rail is the app's whole shape stated once.** A run is charge → casting → trial →
 * verdict, and a user who lands on Side Select with no idea how much is left is the
 * problem it solves; it is not decoration, so it is part of the masthead rather than
 * something each screen may or may not draw.
 *
 * The subtitle changes per screen and the step index with it — those are the only two
 * things a screen may vary here.
 */

/** The four steps, in order. The rail is the same on every screen; only `step` moves. */
const STEPS = ["1 · Charge", "2 · Casting", "3 · Trial", "4 · Verdict"] as const;

export type Step = 1 | 2 | 3 | 4;

export function Masthead({ subtitle, step }: { subtitle: string; step: Step }) {
  return (
    <header className="masthead">
      <div className="masthead-identity">
        <ScalesMark />
        <div className="masthead-titles">
          <div className="display masthead-wordmark">The Tribunal</div>
          <div className="masthead-subtitle">{subtitle}</div>
        </div>
      </div>

      {/* A list, because that is what it is: four ordered steps with one current. */}
      <ol className="masthead-rail" aria-label="Progress through the run">
        {STEPS.map((label, index) => {
          const current = index + 1 === step;
          return (
            <li
              key={label}
              className={`mono masthead-step${current ? " is-current" : ""}`}
              aria-current={current ? "step" : undefined}
            >
              {label}
            </li>
          );
        })}
      </ol>
    </header>
  );
}

/** The scales of justice, drawn rather than imported: two lines of SVG beat an asset. */
function ScalesMark() {
  return (
    <svg
      className="masthead-scales"
      width="30"
      height="30"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 7.5 L16 27" />
      <path d="M10.5 27 L21.5 27" />
      <path d="M6 10.5 L26 10.5" />
      <path d="M6 10.5 L2.8 18" />
      <path d="M6 10.5 L9.2 18" />
      <path d="M2.8 18 A3.2 3.2 0 0 0 9.2 18" />
      <path d="M26 10.5 L22.8 18" />
      <path d="M26 10.5 L29.2 18" />
      <path d="M22.8 18 A3.2 3.2 0 0 0 29.2 18" />
      <circle cx="16" cy="5.6" r="1.7" />
    </svg>
  );
}
