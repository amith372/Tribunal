/**
 * A catalogue of finished runs, in the shapes that get described differently.
 *
 * Built by running the real pipeline against scripted callers rather than by writing record
 * objects out by hand, so every one of them is a record `aggregate` actually produced —
 * with the outcome, the tally, the totals and the `complete` flag worked out by the code
 * that works them out in a live run, not by the fixture's author.
 *
 * The shapes here are the ones where the panels and the exported file have to *say*
 * something different: a bench that split two to one, a bench that agreed, a seat that
 * returned nothing, an advocate that never spoke, a hung bench, a lone surviving verdict,
 * a run abandoned before judging, and a run where one model served every seat. Between
 * them they reach every branch of the closing text.
 *
 * Used by `summary-mirror.test.ts`, which is the point: a catalogue that only held the
 * happy case would let the two copies of the derivation drift everywhere else.
 */

import { aggregate, type RunRecord } from "../aggregate.js";
import { resolveRunModels } from "../casting.js";
import { loadData } from "../data.js";
import { runJudging } from "../judging.js";
import { preflight, type ValidRun } from "../preflight.js";
import { runStatements, toDeliveredStatements } from "../statements.js";
import type { ErrorKind } from "../openrouter.js";
import type { Mode } from "../casting.js";
import { scriptedCaller } from "./fake-caller.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";

const data = loadData();

const GUILTY = '{"verdict": "guilty", "reasoning": "He swore an oath to her, and he broke it himself."}';
const NOT_GUILTY =
  '{"verdict": "not_guilty", "reasoning": "Necessity was made out. No lawful means remained to him."}';

type Reply = string | ErrorKind;

function part4Run(): ValidRun {
  const result = preflight(
    { chargeSheet: PART_4_CHARGE_SHEET, defendant: "jon-snow", advocates: PART_4_CAST },
    data,
  );
  if (!result.ok) throw new Error("Part 4's case must pass pre-flight");
  return result.run;
}

const SPOKE: readonly Reply[] = [
  "The realm was already burning when he acted, and the sheet says as much.",
  "He removed a rival of mine. I will not pretend that troubles me greatly.",
  "He was sworn to me, and he came to me as kin before he came with a knife.",
  "He said the words. He stood close to her. This is not a battle, it is a killing.",
];

async function build(options: {
  advocates?: readonly Reply[];
  judges: readonly [Reply, Reply, Reply];
  mode?: Mode;
}): Promise<RunRecord> {
  const run = part4Run();
  const mode: Mode = options.mode ?? "per-role";
  const models = resolveRunModels(mode);
  const replies = options.advocates ?? SPOKE;

  const script: Record<string, readonly Reply[]> = {};
  run.advocates.forEach((advocate, i) => {
    script[`advocate:${advocate.character.id}`] = [replies[i]];
  });
  data.judges.forEach((judge, i) => {
    script[`judge:${judge.id}`] = [options.judges[i]];
  });

  const caller = scriptedCaller(script);
  const statements = await runStatements({
    run,
    data,
    mode,
    models: models.advocates,
    call: caller.call,
  });
  const judging = statements.abort
    ? null
    : await runJudging({
        run,
        data,
        mode,
        models: models.judges,
        statements: toDeliveredStatements(statements),
        call: caller.call,
      });

  return aggregate({
    run,
    models,
    statements,
    judging,
    startedAt: new Date("2026-08-21T10:00:00.000Z"),
    finishedAt: new Date("2026-08-21T10:00:14.000Z"),
  });
}

export interface RecordCase {
  readonly name: string;
  readonly record: RunRecord;
}

interface CaseSpec {
  readonly name: string;
  readonly judges: readonly [Reply, Reply, Reply];
  readonly advocates?: readonly Reply[];
  readonly mode?: Mode;
}

/**
 * Awaited at module load, so the tests read a plain array.
 *
 * Vitest loads a test file's imports before it collects, which is what makes a top-level
 * await usable here — and what the alternative would cost is worse: every test in the
 * mirror suite building its own record, seven times over, for records that are the same
 * every time because the pipeline is deterministic under a scripted caller.
 */
export const CATALOGUE: readonly RecordCase[] = await Promise.all(
  ([
    { name: "a bench that split two to one", judges: [GUILTY, NOT_GUILTY, GUILTY] },
    { name: "a bench that agreed", judges: [GUILTY, GUILTY, GUILTY] },
    { name: "a bench that acquitted", judges: [NOT_GUILTY, NOT_GUILTY, NOT_GUILTY] },
    { name: "a seat that returned nothing", judges: [GUILTY, GUILTY, "server_error"] },
    { name: "a hung bench", judges: [GUILTY, NOT_GUILTY, "server_error"] },
    {
      name: "one lone surviving verdict",
      judges: [GUILTY, "server_error", "server_error"],
    },
    {
      name: "an advocate who never spoke",
      advocates: [SPOKE[0], SPOKE[1], "server_error", SPOKE[3]],
      judges: [GUILTY, GUILTY, NOT_GUILTY],
    },
    {
      name: "a trial abandoned before the bench sat",
      advocates: [SPOKE[0], SPOKE[1], "server_error", "server_error"],
      judges: [GUILTY, GUILTY, GUILTY],
    },
    { name: "one model in every seat", judges: [GUILTY, GUILTY, NOT_GUILTY], mode: "solo" },
  ] satisfies readonly CaseSpec[]).map(async (spec) => ({
    name: spec.name,
    record: await build({
      judges: spec.judges,
      ...(spec.advocates ? { advocates: spec.advocates } : {}),
      ...(spec.mode ? { mode: spec.mode } : {}),
    }),
  })),
).then((cases) => [
  ...cases,
  /**
   * A bench where two seats ended up on one maker.
   *
   * The casting never does this and the fallback avoids it, so it cannot be provoked
   * through the pipeline with a scripted caller — but the record has a field for it and
   * both renderings have a sentence for it, which makes it exactly the kind of branch that
   * rots unnoticed. The disclosure is spliced onto a real record rather than invented
   * around one.
   */
  {
    name: "two judges on one maker",
    record: {
      ...cases[0].record,
      benchLineage: [{ maker: "nvidia", judges: ["barak", "shamgar"] }],
    },
  },
]);
