import { useEffect, useState } from "react";

import { AppFrame } from "./components/AppFrame.js";
import { Masthead } from "./components/Masthead.js";
import { Panel } from "./components/Panel.js";
import { Setup } from "./screens/Setup.js";
import { SideSelect } from "./screens/SideSelect.js";
import { getHealth, getModels, type Health, type Mode, type ModelsView, type Side } from "./api.js";
import { advocatesOf, chargeIsReady, type SetupDraft } from "./preflight-mirror.js";
import "./styles/tokens.css";

/**
 * The setup half of the app: the charge sheet, and the casting.
 *
 * **The draft lives here rather than in either screen**, because the two screens are two
 * views of one run being prepared — Side Select needs the defendant the charge screen
 * chose, and going back must not throw the casting away. It is held in memory and nowhere
 * else: specs.md Part 3, there is no database, and nothing about a run is stored until the
 * user exports one.
 *
 * The run itself is not wired yet — see `SideSelect` on why the primary action does not
 * call `POST /api/run` at this stage.
 */

type Screen = "setup" | "sides";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [models, setModels] = useState<ModelsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [screen, setScreen] = useState<Screen>("setup");
  const [mode, setMode] = useState<Mode>("per-role");
  const [chargeSheet, setChargeSheet] = useState("");
  const [defendantId, setDefendantId] = useState<string | null>(null);
  const [sides, setSides] = useState<Record<string, Side | null>>({});

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
