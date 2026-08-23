import { useEffect, useState } from "react";

import { AppFrame } from "./components/AppFrame.js";
import { Masthead } from "./components/Masthead.js";
import { Panel } from "./components/Panel.js";
import { Run } from "./screens/Run.js";
import { Setup } from "./screens/Setup.js";
import { SideSelect } from "./screens/SideSelect.js";
import {
  getHealth,
  getModels,
  type Health,
  type Mode,
  type ModelsView,
  type RunRequest,
  type Side,
} from "./api.js";
import { rememberRun } from "./run-memory.js";
import { inheritedRunSession, startRunSession, type RunSession } from "./run-session.js";
import { advocatesOf, chargeIsReady, type SetupDraft } from "./preflight-mirror.js";
import "./styles/tokens.css";

/**
 * The three screens of a run, and the one draft they are three views of.
 *
 * **The draft lives here rather than in either setup screen**, because those two are two
 * views of one run being prepared — Side Select needs the defendant the charge screen
 * chose, and going back must not throw the casting away. It is held in memory and nowhere
 * else: specs.md Part 3, there is no database, and nothing about a run is stored until the
 * user exports one.
 *
 * **The run is started here, by the click, and not by the screen that shows it.** It costs
 * seven requests out of a rationed daily allowance, so it must happen exactly once — and an
 * effect cannot promise that, since React deliberately runs effects twice in development to
 * catch effects that are not idempotent. So `startRunSession` is called from the handler,
 * the session lives outside React entirely, and the trial screen only subscribes to it.
 * Starting a run and rejoining one already in flight then differ in one argument and
 * nowhere else.
 */

type Screen = "setup" | "sides" | "run";

interface ActiveRun {
  readonly session: RunSession;
  /** What was posted. Null on a rejoin — that run's request was made in another page load. */
  readonly request: RunRequest | null;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [models, setModels] = useState<ModelsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * A run left behind by a previous page load is rejoined rather than re-run — resolved
   * before the first render rather than assigned from an effect afterwards, so the app
   * never draws a charge sheet for a moment and then jumps to a trial already in progress.
   * `inheritedRunSession` memoises, so asking twice costs nothing and opens nothing twice.
   */
  const [screen, setScreen] = useState<Screen>(() =>
    inheritedRunSession() === null ? "setup" : "run",
  );
  const [mode, setMode] = useState<Mode>("per-role");
  const [chargeSheet, setChargeSheet] = useState("");
  const [defendantId, setDefendantId] = useState<string | null>(null);
  const [sides, setSides] = useState<Record<string, Side | null>>({});
  const [run, setRun] = useState<ActiveRun | null>(() => {
    const session = inheritedRunSession();
    // No request: that run was posted in a page load this one knows nothing about.
    return session === null ? null : { session, request: null };
  });

  useEffect(() => {
    // The roster and the pre-flight's rules are needed before anything can be drawn; the
    // model list is not, so a slow answer there costs the reading, not the screen.
    getHealth().then(setHealth).catch((err: Error) => setError(err.message));
    getModels()
      .then(setModels)
      .catch(() => setModels(null));
  }, []);

  if (error !== null) {
    return (
      <AppFrame>
        <Masthead subtitle="A charge sheet in. Four advocates. Three judges. One record out." step={1} />
        <div className="app-message">
          <Panel sunken className="app-message-panel">
            <h2 className="section-heading">The server is not answering</h2>
            <p>
              {error}. Nothing was sent and nothing was spent. Start the server and reload —
              locally that is <span className="mono">npm run dev</span>.
            </p>
          </Panel>
        </div>
      </AppFrame>
    );
  }

  if (health === null) {
    return (
      <AppFrame>
        <Masthead subtitle="A charge sheet in. Four advocates. Three judges. One record out." step={1} />
        <div className="app-message">
          <p className="mono app-loading">Opening the case file…</p>
        </div>
      </AppFrame>
    );
  }

  const draft: SetupDraft = { chargeSheet, defendantId, sides };
  const characters = health.characters;
  const advocates = advocatesOf(characters, defendantId);
  const defendant = characters.find((character) => character.id === defendantId);

  /**
   * Choosing a defendant clears the casting.
   *
   * The advocates are "the other four" (specs.md Part 1), so changing who is on trial
   * changes who the four *are* — keeping the old placements would silently leave the new
   * defendant holding a side, which is the one thing this screen must never allow.
   */
  const chooseDefendant = (id: string) => {
    setDefendantId(id);
    setSides({});
  };

  if (screen === "run" && run !== null) {
    return (
      <Run
        session={run.session}
        characters={characters}
        judgeNames={health.judges}
        request={run.request}
        onNewCase={() => {
          // The id is dropped first: leaving this screen means the tab is no longer
          // watching that run, and a stale id would pull the next reload back into it.
          rememberRun(null);
          run.session.close();
          setRun(null);
          setScreen("setup");
        }}
      />
    );
  }

  if (screen === "sides" && defendant) {
    return (
      <SideSelect
        advocates={advocates}
        defendant={defendant}
        draft={draft}
        onMove={(characterId, position) =>
          setSides((current) => ({ ...current, [characterId]: position }))
        }
        onBack={() => setScreen("setup")}
        /**
         * The expensive step. The casting is complete or the button is disabled — the
         * server re-runs the whole pre-flight regardless, and refuses before spending a
         * single call if this screen let something through.
         */
        onRun={() => {
          if (defendantId === null) return;
          const request: RunRequest = {
            chargeSheet,
            defendant: defendantId,
            // Only the four advocates, each with the side it was pushed to. There is no
            // model field here, and there is nowhere in the app to type one.
            advocates: advocates.map((advocate) => ({
              id: advocate.id,
              side: (sides[advocate.id] ?? "for"),
            })),
            mode,
          };
          // The one line in the app that spends anything. It runs on a click, once.
          setRun({ session: startRunSession({ kind: "start", request }), request });
          setScreen("run");
        }}
      />
    );
  }

  return (
    <Setup
      characters={characters}
      rules={health.preflight}
      models={models}
      draft={draft}
      mode={mode}
      onChargeSheet={setChargeSheet}
      onDefendant={chooseDefendant}
      onMode={setMode}
      onLoadExample={(text, id) => {
        setChargeSheet(text);
        setDefendantId(id);
        setSides({});
      }}
      // Guarded here as well as by the button being disabled: the screen's own check is
      // what the user sees, and this is what makes it true rather than merely displayed.
      onNext={() => {
        if (chargeIsReady(draft, health.preflight, characters)) setScreen("sides");
      }}
    />
  );
}
