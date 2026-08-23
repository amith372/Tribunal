import { Portrait } from "./Portrait.js";
import { JUDGE_DONE, JUDGE_UNDONE } from "./avatars.js";
import "./JudgePortrait.css";

/**
 * A seat on the bench.
 *
 * **All three judges share one portrait, in two states**, which is what the available art
 * allows and what specs.md Part 1 states outright: "one judge portrait in two states — so
 * the three judges are told apart by the name beside the portrait rather than by the
 * face". That makes the name beside this component load-bearing rather than decorative,
 * and it is why the portrait itself carries the judge's name as its alt text: three
 * identical faces with no names would be three unlabelled circles.
 *
 * The two states are the whole vocabulary: `undone_judge` while a seat has not ruled, and
 * `judge` once it has. A seat that failed keeps the undone portrait — there is no verdict,
 * so there is nothing to resolve into, and inventing one is the thing this app most
 * carefully does not do.
 */

export type BenchPhase = "waiting" | "deliberating" | "ruled" | "failed";

export function JudgePortrait({
  name,
  phase,
  size = 52,
}: {
  name: string;
  phase: BenchPhase;
  size?: number;
}) {
  return (
    <Portrait
      src={phase === "ruled" ? JUDGE_DONE : JUDGE_UNDONE}
      alt={name}
      size={size}
      // Bobbing with a glow while deliberating, one bounce as the verdict lands, still
      // otherwise. A seat that has not been asked anything yet is not thinking.
      motion={phase === "deliberating" ? "thinking" : phase === "ruled" ? "happy" : "none"}
      imageClassName={`judge-portrait phase-${phase}`}
      fallback={name.slice(0, 1)}
    />
  );
}
