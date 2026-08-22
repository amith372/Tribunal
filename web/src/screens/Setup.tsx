import { AppFrame } from "../components/AppFrame.js";
import { Button } from "../components/Button.js";
import { CharacterTile } from "../components/CharacterTile.js";
import { Masthead } from "../components/Masthead.js";
import { Panel } from "../components/Panel.js";
import type { Character, Mode, ModelsView, PreflightRules } from "../api.js";
import {
  chargeIsReady,
  lengthState,
  setupChecks,
  type Check,
  type SetupDraft,
} from "../preflight-mirror.js";
import "./Setup.css";

/**
 * Step 1: the charge sheet, the defendant, and the mode.
 *
 * Three things this screen is responsible for, all of them from specs.md Part 1:
 *   · the charge sheet is 10–200 words and must state a charge — shown live, because the
 *     alternative is a user pressing Run and being refused;
 *   · the defendant is one of the five characters in `data/`, chosen here and never typed;
 *   · the mode toggle chooses **a mode and nothing else** — there is no model input on
 *     this screen or anywhere else, and the identifiers below are read-only text served
 *     by `/api/models`.
 *
 * The casting is deliberately not here. It is the next screen, and the pre-flight panel
 * says so rather than leaving it as a surprise.
 */

/**
 * specs.md Part 4's validation case, the same text as the server's `PART_4_CHARGE_SHEET`.
 * It is duplicated rather than served because it is example *content*, not a rule: a copy
 * that drifts costs a demo its wording, not its correctness.
 */
const EXAMPLE_CASE = {
  defendantId: "jon-snow",
  chargeSheet:
    "Jon Snow is charged with regicide and treason: that he killed Queen Daenerys Targaryen " +
    "in the throne room at King's Landing, by his own hand, after swearing her his loyalty. " +
    "The tribunal must decide whether that killing was murder or the prevention of a greater " +
    "slaughter.",
};

export function Setup({
  characters,
  rules,
  models,
  draft,
  mode,
  onChargeSheet,
  onDefendant,
  onMode,
  onLoadExample,
  onNext,
}: {
  characters: readonly Character[];
  rules: PreflightRules;
  /** Null until `/api/models` answers. The screen works without it; it just says less. */
  models: ModelsView | null;
  draft: SetupDraft;
  mode: Mode;
  onChargeSheet: (text: string) => void;
  onDefendant: (id: string) => void;
  onMode: (mode: Mode) => void;
  onLoadExample: (chargeSheet: string, defendantId: string) => void;
  onNext: () => void;
}) {
  const length = lengthState(draft.chargeSheet, rules);
  const checks = setupChecks(draft, rules, characters);
  const ready = chargeIsReady(draft, rules, characters);
  const meter = Math.min(length.words / rules.maxChargeSheetWords, 1) * 100;

  return (
    <AppFrame
      footer={
        <>
          <div className="app-sheet-footer-status">
            <span className="mono setup-cost">
              7 model calls per run · $0 while the roster stays free
            </span>
          </div>
          <div className="app-sheet-footer-actions">
            <Button onClick={() => onLoadExample(EXAMPLE_CASE.chargeSheet, EXAMPLE_CASE.defendantId)}>
              Load the Jon Snow case
            </Button>
            <Button
              variant="primary"
              trailingArrow
              disabled={!ready}
              onClick={onNext}
              title={ready ? undefined : "The charge sheet is not ready yet — see the pre-flight."}
            >
              Cast the advocates
            </Button>
          </div>
        </>
      }
    >
      <Masthead subtitle="A charge sheet in. Four advocates. Three judges. One record out." step={1} />

      <div className="setup">
        <section className="setup-column">
          <h2 className="section-heading">The Charge Sheet</h2>

          <Panel sunken className="setup-sheet-panel">
            <textarea
              className="setup-sheet"
              value={draft.chargeSheet}
              onChange={(event) => onChargeSheet(event.target.value)}
              placeholder="Name the accused, say what they are charged with, and put the question the tribunal has to answer."
              aria-label="Charge sheet"
              spellCheck
            />
          </Panel>

          <div className="setup-counter-row">
            <div className="setup-counter-left">
              <span className={`mono setup-count${length.status === "fail" ? " is-over" : ""}`}>
                {length.words} {length.words === 1 ? "word" : "words"}
              </span>
              <span className="mono setup-count-range">
                {rules.minChargeSheetWords} – {rules.maxChargeSheetWords} allowed
              </span>
            </div>
            <div
              className="setup-meter"
              role="presentation"
              aria-hidden="true"
              title={`${length.words} of ${rules.maxChargeSheetWords} words`}
            >
              <div
                className={`setup-meter-fill${length.status === "fail" ? " is-over" : ""}`}
                style={{ width: `${meter}%` }}
              />
            </div>
          </div>

          {length.message !== null && <p className="setup-length-message">{length.message}</p>}

          <h2 className="section-heading setup-spaced">Pre-flight</h2>
          <Panel sunken className="setup-checks">
            {checks.map((check) => (
              <CheckLine key={check.id} check={check} />
            ))}
            <div className="mono setup-checks-note">
              Checked before a single model call is spent.
            </div>
          </Panel>
        </section>

        <section className="setup-column">
          <div className="setup-column-head">
            <h2 className="section-heading">The Defendant</h2>
            <span className="caption">choose one of five</span>
          </div>

          <div className="setup-picker" role="radiogroup" aria-label="The defendant">
            {characters.map((character) => {
              const chosen = character.id === draft.defendantId;
              return (
                <button
                  key={character.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  className={`setup-pick${chosen ? " is-chosen" : ""}`}
                  onClick={() => onDefendant(character.id)}
                >
                  <CharacterTile
                    characterId={character.id}
                    name={character.name}
                    size={50}
                    tone={chosen ? "accused" : "neutral"}
                  />
                  <span className="setup-pick-text">
                    <span className={`display setup-pick-name${chosen ? " is-chosen" : ""}`}>
                      {character.name}
                    </span>
                    <span className="setup-pick-blurb">{blurb(character.description)}</span>
                  </span>
                  {chosen && <span className="mono setup-pick-badge">Accused</span>}
                </button>
              );
            })}
          </div>

          <h2 className="section-heading setup-spaced">Models</h2>

          <div className="setup-modes" role="radiogroup" aria-label="How many models a run uses">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "solo"}
              className={`setup-mode${mode === "solo" ? " is-chosen" : ""}`}
              onClick={() => onMode("solo")}
            >
              One model, all seven roles
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "per-role"}
              className={`setup-mode${mode === "per-role" ? " is-chosen" : ""}`}
              onClick={() => onMode("per-role")}
            >
              A different model per role
            </button>
          </div>

          <ModelReadout models={models} mode={mode} />

          <p className="setup-models-note">
            Free models only. The identifiers are fixed on the server and shuffled per run —
            nothing here can name one.
          </p>
        </section>
      </div>
    </AppFrame>
  );
}

/**
 * One pre-flight line. Three states: a green tick, a crimson cross, and an open circle for
 * a check that cannot be answered yet — see `preflight-mirror.ts` on why pending is not a
 * quiet failure.
 */
function CheckLine({ check }: { check: Check }) {
  return (
    <div className={`setup-check is-${check.status}`}>
      <span className="setup-check-mark" aria-hidden="true">
        {check.status === "pass" && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5 L6.5 12 L13 4.5" />
          </svg>
        )}
        {check.status === "fail" && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4 L12 12" />
            <path d="M12 4 L4 12" />
          </svg>
        )}
        {check.status === "pending" && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="8" cy="8" r="5.5" />
          </svg>
        )}
      </span>
      <span className="setup-check-text">{check.text}</span>
    </div>
  );
}

/**
 * The models, read-only.
 *
 * It names what this server actually holds, so a slot changed on the host changes this
 * text with no edit anywhere — and it is text, not a field. There is nothing here to type
 * into, which is the point: specs.md Part 5 calls a user-editable model a cost hole.
 */
function ModelReadout({ models, mode }: { models: ModelsView | null; mode: Mode }) {
  if (models === null) {
    return (
      <div className="mono setup-models-loading">Reading the server's roster…</div>
    );
  }

  if (mode === "solo") {
    return (
      <div className="setup-models">
        <div className="setup-models-group">
          <div className="mono setup-models-label">
            All {models.solo.seats} roles · one model
          </div>
          <ul className="setup-models-list">
            <li className="mono setup-model">{models.solo.model}</li>
          </ul>
        </div>
        <div className="mono setup-models-fallback">
          If it is refused mid-run: {models.fallbackRouter}
        </div>
      </div>
    );
  }

  return (
    <div className="setup-models">
      <ModelGroup
        title="Judges"
        seats={models.perRole.judges.seats}
        pool={models.perRole.judges.pool}
      />
      <ModelGroup
        title="Advocates"
        seats={models.perRole.advocates.seats}
        pool={models.perRole.advocates.pool}
      />
      <div className="mono setup-models-fallback">
        Last resort if a pool runs out: {models.fallbackRouter}
      </div>
    </div>
  );
}

function ModelGroup({
  title,
  seats,
  pool,
}: {
  title: string;
  seats: number;
  pool: readonly string[];
}) {
  return (
    <div className="setup-models-group">
      <div className="mono setup-models-label">
        {title} · {seats} {seats === 1 ? "seat" : "seats"} drawn from {pool.length}
      </div>
      <ul className="setup-models-list">
        {pool.map((id) => (
          <li key={id} className="mono setup-model">
            {id}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The one line shown under a character's name in the picker.
 *
 * `data/characters.md` is the only source of character facts, and its descriptions run to
 * several sentences — too long for a row. The sentence beginning "Argues" is the one that
 * says how this character would advocate, which is exactly what a user choosing a
 * defendant is weighing, so it is preferred; otherwise the first sentence stands. Nothing
 * is invented and nothing is rewritten.
 */
function blurb(description: string): string {
  const sentences = description.split(/(?<=\.)\s+/);
  return (sentences.find((sentence) => sentence.startsWith("Argues")) ?? sentences[0] ?? "").trim();
}
