import { AppFrame } from "../components/AppFrame.js";
import { Button } from "../components/Button.js";
import { CharacterTile } from "../components/CharacterTile.js";
import { Masthead } from "../components/Masthead.js";
import { Panel, SectionBar } from "../components/Panel.js";
import type { Character, Side } from "../api.js";
import { castingIsReady, countSide, type SetupDraft } from "../preflight-mirror.js";
import "./SideSelect.css";

/**
 * Step 2: who defends and who prosecutes.
 *
 * specs.md Part 1: "The user casts the sides … The Side Select screen holds each side to
 * two, so an invalid split is hard even to express; the server still checks the split
 * independently of what the screen allowed." Both halves matter. This screen makes a 3–1
 * split unreachable — an arrow into a full side does not move anything — and the server
 * re-runs the whole pre-flight regardless, so the rule is not enforced by a screen.
 *
 * **The track reads defense ← middle → prosecution, defense on the left.** The choice was
 * arbitrary and made for one reason: the result panels list defense first, so putting it
 * left costs nothing and gives the app one left-to-right order on every screen.
 *
 * **Every card keeps both arrows, in every position.** An arrow whose destination is full
 * — or that would run off the end of the track — is dimmed, never removed. Hiding it
 * would shift the layout and take the reason with it, and a character whose controls
 * disappeared would read as locked in when in fact nothing is settled until the trial
 * opens.
 *
 * **The primary action here is the expensive one.** Pressing it posts the run and spends
 * seven requests out of a daily allowance rationed in requests, so it is reachable only
 * from a complete casting — and it disables itself the moment it is pressed, because a
 * double-press would spend fourteen.
 */

/** The three positions on the track, left to right. `null` is the middle: uncast. */
type Position = Side | null;

export function SideSelect({
  advocates,
  defendant,
  draft,
  onMove,
  onBack,
  onRun,
}: {
  /** The four who are not on trial. The defendant is never among them (Part 1). */
  advocates: readonly Character[];
  defendant: Character;
  draft: SetupDraft;
  onMove: (characterId: string, position: Position) => void;
  onBack: () => void;
  /** Opens the trial: posts the run and hands the stream to the trial screen. */
  onRun: () => void;
}) {
  const defense = countSide(draft, "for");
  const prosecution = countSide(draft, "against");
  const unplaced = advocates.filter((advocate) => !draft.sides[advocate.id]).length;
  const ready = castingIsReady(draft, advocates);

  const positionOf = (id: string): Position => draft.sides[id] ?? null;


  return (
    <AppFrame
      footer={
        <>
          <div className="app-sheet-footer-status">
            {ready ? (
              <>
                <TickMark />
                <span className="sides-status is-ready">
                  Two defending, two prosecuting. The tribunal can open.
                </span>
              </>
            ) : (
              <>
                <WarnMark />
                <span className="sides-status is-warning">
                  {unplaced === 1
                    ? "One advocate is still in the middle. "
                    : `${unplaced} advocates are still in the middle. `}
                  The trial cannot open until each side holds exactly two.
                </span>
              </>
            )}
          </div>
          <div className="app-sheet-footer-actions">
            <Button onClick={onBack}>Back to the charge</Button>
            <Button
              variant="primary"
              trailingArrow
              disabled={!ready}
              title={ready ? undefined : "Each side holds exactly two before the trial opens."}
              onClick={onRun}
            >
              Open the trial
            </Button>
          </div>
        </>
      }
    >
      <Masthead subtitle="Push each advocate to a side. Two seats on each, no more." step={2} />

      <div className="sides">
        <div className="sides-track">
          <SectionBar>Side Select</SectionBar>

          <div className="sides-heads">
            <div className="sides-head">
              <Counter filled={defense} />
              <div className="display sides-head-label">The Defense</div>
            </div>

            <div className="sides-head sides-head-accused">
              {/* The accused sits above the track and never on it: specs.md Part 1's
                  non-negotiable, made structural rather than validated. */}
              <div className="sides-accused">
                <CharacterTile
                  characterId={defendant.id}
                  name={defendant.name}
                  size={34}
                  tone="accused"
                />
                <span className="mono sides-accused-label">
                  {defendant.name} — the accused, never argues
                </span>
              </div>
            </div>

            <div className="sides-head">
              <Counter filled={prosecution} />
              <div className="display sides-head-label">The Prosecution</div>
            </div>
          </div>

          <div className="sides-rows">
            {advocates.map((advocate) => {
              const position = positionOf(advocate.id);
              // One card, placed in the column its side names. The two empty columns are
              // still drawn, so every card sits on the same three-position track and a
              // move reads as travel across it rather than a card changing colour.
              const card = (
                <Card
                  advocate={advocate}
                  position={position}
                  defense={defense}
                  prosecution={prosecution}
                  onMove={onMove}
                />
              );
              return (
                <div className="sides-row" key={advocate.id}>
                  <div className="sides-slot">{position === "for" ? card : null}</div>
                  <div className="sides-slot">{position === null ? card : null}</div>
                  <div className="sides-slot">{position === "against" ? card : null}</div>
                </div>
              );
            })}

            <div className="sides-hint">
              <span className="mono">
                A dimmed arrow means that side is full, or the track ends there. Nobody is locked
                in until the trial opens.
              </span>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

/** `n / 2`, green once the side is full and amber while it is not. */
function Counter({ filled }: { filled: number }) {
  return (
    <div className={`display sides-counter${filled === 2 ? " is-full" : ""}`}>{filled} / 2</div>
  );
}

/**
 * One advocate: an arrow, the portrait, the name plaque, an arrow. The two arrows are
 * always rendered; whether they do anything is the only thing that changes.
 */
function Card({
  advocate,
  position,
  defense,
  prosecution,
  onMove,
}: {
  advocate: Character;
  position: Position;
  defense: number;
  prosecution: number;
  onMove: (characterId: string, position: Position) => void;
}) {
  // Left goes toward the defense, right toward the prosecution — the same order the
  // result panels read in.
  const leftTarget: Position | "end" =
    position === "against" ? null : position === null ? "for" : "end";
  const rightTarget: Position | "end" =
    position === "for" ? null : position === null ? "against" : "end";

  const leftBlocked = leftTarget === "end" || (leftTarget === "for" && defense >= 2);
  const rightBlocked = rightTarget === "end" || (rightTarget === "against" && prosecution >= 2);

  const tone = position === "for" ? "defense" : position === "against" ? "prosecution" : "neutral";

  const card = (
    <div className="sides-card">
      <Arrow
        direction="left"
        blocked={leftBlocked}
        label={arrowLabel(advocate.name, leftTarget, leftBlocked, "left")}
        // `leftBlocked` is already true for the end of the track, so what is left here is
        // a real destination.
        onClick={() => {
          if (!leftBlocked) onMove(advocate.id, leftTarget);
        }}
      />
      <div className="sides-card-body">
        <CharacterTile characterId={advocate.id} name={advocate.name} size={70} tone={tone} />
        <div className="display sides-plaque">{shortName(advocate.name)}</div>
      </div>
      <Arrow
        direction="right"
        blocked={rightBlocked}
        label={arrowLabel(advocate.name, rightTarget, rightBlocked, "right")}
        onClick={() => {
          if (!rightBlocked) onMove(advocate.id, rightTarget);
        }}
      />
    </div>
  );

  // An uncast advocate is raised off the track: it is the one still asking to be decided.
  return position === null ? <Panel tone="raised" className="sides-card-raised">{card}</Panel> : card;
}

function Arrow({
  direction,
  blocked,
  label,
  onClick,
}: {
  direction: "left" | "right";
  blocked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sides-arrow${blocked ? " is-blocked" : ""}`}
      // Dimmed and inert rather than gone — and `disabled` rather than a click that does
      // nothing, so a keyboard and a screen reader are told the same thing the dimming
      // tells an eye.
      disabled={blocked}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {direction === "left" ? (
          <>
            <path d="M16 10 H4" />
            <path d="M9 5 L4 10 L9 15" />
          </>
        ) : (
          <>
            <path d="M4 10 H16" />
            <path d="M11 5 L16 10 L11 15" />
          </>
        )}
      </svg>
    </button>
  );
}

/** Says where the arrow goes, or why it cannot — the dimming's reason, in words. */
function arrowLabel(
  name: string,
  target: Position | "end",
  blocked: boolean,
  direction: "left" | "right",
): string {
  if (target === "end") {
    return `${name} is already as far ${direction} as the track goes`;
  }
  if (target === null) {
    return `Take ${name} back to the middle`;
  }
  const side = target === "for" ? "defense" : "prosecution";
  return blocked ? `The ${side} already holds two` : `Move ${name} to the ${side}`;
}

/** The plaque takes the given name: at 12px, "Daenerys Targaryen" wraps and "Daenerys" reads. */
function shortName(name: string): string {
  return name === "Grey Worm" ? name : (name.split(" ")[0] ?? name);
}

function TickMark() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 18 18"
      fill="none"
      stroke="var(--acquitted)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 9.5 L7.5 13.5 L14.5 5" />
    </svg>
  );
}

function WarnMark() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 18 18"
      fill="none"
      stroke="var(--amber)"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="7" />
      <path d="M9 5 L9 9.5" />
      <path d="M9 12.5 L9 12.51" />
    </svg>
  );
}
