import { useEffect, useState } from "react";

/**
 * Stage 1 scaffold. This screen exists only to prove the frontend reaches the API and
 * that the server parsed `data/`. The real screens — Setup, Side Select, Run, Results —
 * arrive in Stages 6 to 8, on the shared design tokens fixed at the start of Stage 6.
 * Deliberately unstyled: anything styled now would have to be thrown away then.
 */

interface Health {
  ok: boolean;
  characters: string[];
  judges: string[];
  relations: number;
  apiKeyConfigured: boolean;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "40rem" }}>
      <h1>The Tribunal</h1>
      <p>Stage 1 — backend scaffold and OpenRouter client.</p>

      {error && <p style={{ color: "crimson" }}>Could not reach the API: {error}</p>}
      {!health && !error && <p>Checking the server…</p>}

      {health && (
        <dl>
          <dt>
            <strong>Characters ({health.characters.length})</strong>
          </dt>
          <dd>{health.characters.join(", ")}</dd>
          <dt>
            <strong>Judges ({health.judges.length})</strong>
          </dt>
          <dd>{health.judges.join(", ")}</dd>
          <dt>
            <strong>Relations</strong>
          </dt>
          <dd>{health.relations}</dd>
          <dt>
            <strong>OPENROUTER_API_KEY</strong>
          </dt>
          <dd>
            {health.apiKeyConfigured
              ? "set — model calls can run"
              : "not set — model calls will refuse, everything else works"}
          </dd>
        </dl>
      )}
    </main>
  );
}
