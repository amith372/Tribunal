/**
 * summary.ts — the sentences a finished run is described in, worked out once.
 *
 * specs.md Part 3: one run produces one record, and the panels, the stream's closing
 * message and the exported file are **three renderings of that one object**. Stage 8 made
 * the exported file carry the same five sections as the results panels, in the same order
 * — which is what lets a reader check one against the other line by line. That only works
 * if the two say the same words: a file whose closing paragraph is a near-miss of the
 * screen's reads as a different account of the same run, which is precisely the doubt the
 * record exists to remove.
 *
 * So the derivations live here and the browser reads them, through the `@record` alias
 * `web/vite.config.ts` sets up. **There is one copy, not two agreeing copies.** For a
 * while there were two — `web/src/results-model.ts` mirrored this file line for line, held
 * against it by `summary-mirror.test.ts` — and the argument for that arrangement was that
 * the workspaces compile separately. They do; it was not a good enough reason, because a
 * copy nothing checks is a copy that drifts and a copy something checks is a test whose
 * whole job is guarding a copy. The mirror went, and the assertions stayed as
 * `summary.test.ts`.
 *
 * `web/src/setup-checks.ts` reads the pre-flight's predicates the same way and for the
 * same reason. Nothing crosses that alias but pure functions: every import in this file is
 * `import type`, so no Node built-in, no model identifier and no key can reach the browser
 * through it.
 *
 * **Nothing here computes a number.** Every figure is read off the record the server
 * already folded; these functions choose labels, order sides and count things the record
 * carries. There is no branch that could produce a token count, a price or a verdict that
 * the run did not actually reach.
 */

import type { AttemptView, JudgeOutcomeView, RunRecordView } from "./record-view.js";
import type { Verdict } from "./judge-parser.js";
import type { Side } from "./preflight.js";

export const VERDICT_LABEL: Record<Verdict, string> = {
  guilty: "Guilty",
  not_guilty: "Not guilty",
};

export const SIDE_LABEL: Record<Side, string> = {
  for: "For the defense",
  against: "For the prosecution",
};

/** The class suffix a side uses everywhere: green for the defense, crimson against. */
export const sideTone = (side: Side): "defense" | "prosecution" =>
  side === "for" ? "defense" : "prosecution";

const MODE_LABEL: Record<string, string> = {
  solo: "one model for all seven roles",
  "per-role": "a different model per role",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const number = (n: number): string => n.toLocaleString("en-US");

/** $0 while only free models are used — read from the record, never asserted (Part 2). */
export const price = (usd: number): string => (usd === 0 ? "$0" : `$${usd.toFixed(6)}`);

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * Who was tried, when, and how it was cast — the masthead's one line, and the exported
 * file's subtitle.
 *
 * Rendered in UTC rather than in the machine's zone, because the export must be a pure
 * function of the record: the same run has to produce the same bytes in the test suite, on
 * the developer's laptop and on the host, and a local-time format would quietly make three
 * different files. It also means the screen and the file never disagree about the date.
 */
export function runSubtitle(record: RunRecordView): string {
  const at = new Date(record.startedAt);
  const when = Number.isNaN(at.getTime())
    ? record.startedAt
    : `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
  return `${record.defendant.name}, defendant · ${when} · ${MODE_LABEL[record.mode] ?? record.mode}`;
}

/* ---- a role that never answered ------------------------------------------------------------ */

/**
 * What a seat says when its chain is spent, on screen and in the exported file alike.
 *
 * specs.md Part 5: the card states the outcome and points at the summary, because what the
 * provider actually returned — a status code, its name for its own shared pool, an error
 * kind with underscores in it — is written for whoever runs the server. On an advocate's
 * card it reads as a fault in this app rather than as a model declining to answer.
 *
 * **This hides nothing.** `stages()` still lists every attempt with its model, its error
 * kind and its elapsed time; the export still carries the raw body; the run is still
 * counted incomplete and the role is still a gap. Only the *place* a reader meets the
 * detail has changed.
 *
 * It is one sentence for both kinds of seat on purpose. An advocate that did not speak and
 * a judge that did not rule are the same event to a reader — a seat that was asked and did
 * not answer — and giving them two wordings would imply a distinction the record does not
 * make.
 */
export const NO_ANSWER = "Failed to give an answer (see summary at the end for more details).";

/* ---- the five sections, and the words that head them ------------------------------------- */

export interface PanelSpec {
  readonly id: "verdict" | "bench" | "advocates" | "spend" | "closing";
  /** What the footer calls it, on the dots and on the arrow either side of them. */
  readonly label: string;
  /** The heading the section carries, on screen and in the exported file alike. */
  readonly heading: string;
}

/**
 * The five, in order (specs.md Part 1) — and the exported record carries the same five,
 * under the same headings, in the same order, so a reader can hold one against the other.
 */
export const PANELS: readonly PanelSpec[] = [
  { id: "verdict", label: "The verdict", heading: "The Verdict" },
  { id: "bench", label: "The bench", heading: "The Bench — three verdicts, each with its reasoning" },
  { id: "advocates", label: "The advocates", heading: "The Advocates — two for, two against" },
  { id: "spend", label: "What it spent", heading: "Every Call This Run Made" },
  { id: "closing", label: "In closing", heading: "In Closing" },
];

/** Why the finding is what it is. Printed under the three seats. */
export const findingNote = (): string =>
  "The finding is the majority of the three verdicts above — counted, never inferred. A " +
  "split bench reads Hung, and a single surviving verdict reads Inconclusive.";

/** What a disagreement between the judges can and cannot be attributed to. */
export const benchNote = (mode: string): string =>
  mode === "solo"
    ? "All three judges ran on the same model this run, so a disagreement between them is a " +
      "difference of temperament rather than of model."
    : "Each judge ran on a different model, drawn at random for this run — so a disagreement " +
      "is a difference of temperament, not of who got the larger model.";

/** What the four statements are, and are not. */
export const advocatesNote = (): string =>
  "Each advocate spoke once and saw no other statement. Every claim is spun from the charge " +
  "sheet and the character files — anything missing is flagged as an assumption, never asserted.";

/* ---- section 1: the finding ------------------------------------------------------------- */

export interface Headline {
  readonly title: string;
  readonly detail: string;
  readonly tone: "guilty" | "acquitted" | "unresolved";
}

/**
 * How the run ended, as the words that get printed.
 *
 * The outcome is a shape rather than a verdict with a flag (Part 3), so each kind is
 * written out on its own: there is no branch here in which a verdict could be printed for
 * a run that never reached one, because three of the four cases have no verdict field at
 * all to print from.
 */
/*
 * Takes only the outcome, because that is all it reads. The archive screen holds a
 * summary rather than a whole record and still has to head it the same way — asking for
 * the whole record would force a caller to invent the rest of one to print two words.
 */
export function headline(record: Pick<RunRecordView, "outcome">): Headline {
  const outcome = record.outcome;
  switch (outcome.kind) {
    case "verdict":
      return {
        title: VERDICT_LABEL[outcome.verdict],
        detail: `${outcome.tally.guilty} – ${outcome.tally.notGuilty} on a bench of three`,
        tone: outcome.verdict === "guilty" ? "guilty" : "acquitted",
      };
    case "hung":
      return {
        title: "Hung",
        detail: "One against one, and no third verdict to break it.",
        tone: "unresolved",
      };
    case "inconclusive":
      return { title: "Inconclusive", detail: outcome.why, tone: "unresolved" };
    case "aborted":
      return { title: "Trial abandoned", detail: outcome.message, tone: "unresolved" };
  }
}

/* ---- sides -------------------------------------------------------------------------------- */

/** The two columns, defense first. Casting order is kept inside each. */
export function bySide<T extends { readonly side: Side }>(
  rows: readonly T[],
): { readonly defense: readonly T[]; readonly prosecution: readonly T[] } {
  return {
    defense: rows.filter((row) => row.side === "for"),
    prosecution: rows.filter((row) => row.side === "against"),
  };
}

/* ---- section 4: what it spent ------------------------------------------------------------- */

/**
 * Tokens and time for a set of attempts, summed — retries and fallbacks included, because
 * those were really spent too.
 *
 * `tokens` is `null` where no attempt reported usage at all. A zero there would read as
 * "this was free", which is a different claim from "the model did not say".
 */
export function usageOf(attempts: readonly AttemptView[]): {
  tokens: number | null;
  elapsedMs: number;
} {
  let tokens: number | null = null;
  let elapsedMs = 0;
  for (const attempt of attempts) {
    elapsedMs += attempt.elapsedMs;
    if (attempt.usage.totalTokens !== null) tokens = (tokens ?? 0) + attempt.usage.totalTokens;
  }
  return { tokens, elapsedMs };
}

export interface StageRollup {
  readonly stage: "advocate" | "judge";
  readonly caption: string;
  readonly attempts: readonly AttemptView[];
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly elapsedMs: number;
  readonly failed: number;
}

/**
 * The run's calls, grouped into its two waves.
 *
 * The stage is the honest unit for elapsed time: the four advocates are asked all at once,
 * so their times overlap and adding them up would claim the wave took longer than it did.
 * The caption says which it is, and the run's own `totals.elapsedMs` — the wall clock the
 * server measured — is what the final row reports.
 *
 * The wave is read from the attempt's label (`advocate:tyrion`, `judge:barak`), the same
 * string the per-call table prints, so a row cannot land under a heading that disagrees
 * with its own name.
 */
export function stages(record: RunRecordView): readonly StageRollup[] {
  const groups: { stage: "advocate" | "judge"; caption: string }[] = [
    { stage: "advocate", caption: "The advocates — asked together" },
    { stage: "judge", caption: "The bench — asked together, after the statements" },
  ];

  return groups
    .map(({ stage, caption }) => {
      const attempts = record.attempts.filter((attempt) => attempt.label.startsWith(`${stage}:`));
      const sum = (read: (attempt: AttemptView) => number | null): number =>
        attempts.reduce((total, attempt) => total + (read(attempt) ?? 0), 0);
      return {
        stage,
        caption,
        attempts,
        promptTokens: sum((a) => a.usage.promptTokens),
        completionTokens: sum((a) => a.usage.completionTokens),
        reasoningTokens: sum((a) => a.usage.reasoningTokens),
        totalTokens: sum((a) => a.usage.totalTokens),
        costUsd: sum((a) => a.usage.costUsd),
        elapsedMs: sum((a) => a.elapsedMs),
        failed: attempts.filter((attempt) => !attempt.ok).length,
      };
    })
    .filter((group) => group.attempts.length > 0);
}

/* ---- section 5: in closing ------------------------------------------------------------------ */

export interface SummaryRow {
  readonly label: string;
  readonly value: string;
  /** Set only on the finding, so the one coloured value is the verdict. */
  readonly tone?: "guilty" | "acquitted" | "unresolved";
}

const names = (rows: readonly { readonly name: string }[]): string =>
  rows.length === 0 ? "—" : rows.map((row) => row.name).join(" · ");

/** The eight facts of the run, at a glance. */
export function summaryRows(record: RunRecordView): readonly SummaryRow[] {
  const { defense, prosecution } = bySide(record.casting);
  const head = headline(record);
  const totals = record.totals;

  return [
    { label: "Defendant", value: record.defendant.name },
    { label: "Charge sheet", value: `${record.chargeSheetWords} words` },
    { label: "Defense", value: names(defense) },
    { label: "Prosecution", value: names(prosecution) },
    {
      label: "Finding",
      value:
        record.outcome.kind === "verdict"
          ? `${head.title}, ${head.detail.replace(" on a bench of three", "")}`
          : head.title,
      tone: head.tone,
    },
    { label: "Bench", value: names(record.judges) },
    {
      label: "Calls",
      value: `${totals.calls} · ${number(totals.totalTokens)} tokens${
        totals.usageMissing ? " (a floor)" : ""
      } · ${seconds(totals.elapsedMs)}`,
    },
    { label: "Price", value: price(totals.costUsd) },
  ];
}

const COUNT_WORD = ["none", "one", "two", "three", "four"] as const;

/** Small counts read better as words in a closing sentence; anything larger stays a digit. */
const countWord = (n: number): string => COUNT_WORD[n] ?? String(n);

/**
 * The closing section's two sentences.
 *
 * They are assembled from counts the record already holds — how many advocates delivered,
 * how many judges ruled which way — and never from a reading of what anybody argued. The
 * app does not summarise a judge's reasoning; the reasoning is printed in full a section
 * earlier, and paraphrasing it here would be the app writing part of the record.
 */
export function closingLines(record: RunRecordView): {
  readonly lead: string;
  readonly note: string;
} {
  const delivered = record.statements.filter((statement) => statement.ok).length;
  const ruled = record.judges.filter((judge) => judge.verdict !== null);
  const outcome = record.outcome;

  if (outcome.kind === "aborted") {
    return {
      lead:
        `${cap(countWord(delivered))} of the four advocates had spoken ` +
        "when the run stopped, and the bench was never asked.",
      note: outcome.message,
    };
  }

  const spoke =
    delivered === 4
      ? "Four advocates each spoke once, none of them hearing another."
      : `${cap(countWord(delivered))} of the four advocates delivered a ` +
        "statement, none of them hearing another, and the trial is recorded as incomplete.";

  const read =
    ruled.length === 3
      ? "Three judges read the same statements, labelled only by side"
      : `${cap(countWord(ruled.length))} of the three judges returned a ` +
        "readable verdict";

  if (outcome.kind === "verdict") {
    const agreed = outcome.verdict === "guilty" ? outcome.tally.guilty : outcome.tally.notGuilty;
    const word = VERDICT_LABEL[outcome.verdict].toLowerCase();
    return {
      lead: `${spoke} ${read}, and ${countWord(agreed)} of them found ${word}.`,
      note: dissentNote(record),
    };
  }

  return {
    lead: `${spoke} ${read}.`,
    note:
      outcome.kind === "hung"
        ? "One judge against one, with no third verdict to break it. No verdict was invented " +
          "to fill the gap."
        : outcome.why,
  };
}

/** Who, if anyone, went the other way — named, never characterised. */
function dissentNote(record: RunRecordView): string {
  const outcome = record.outcome;
  if (outcome.kind !== "verdict") return "";

  const dissenting = record.judges.filter(
    (judge: JudgeOutcomeView) => judge.verdict !== null && judge.verdict !== outcome.verdict,
  );
  const silent = record.judges.filter((judge: JudgeOutcomeView) => judge.verdict === null);

  const parts: string[] = [];
  if (dissenting.length === 0) {
    parts.push("The bench was unanimous among the judges who ruled.");
  } else if (dissenting.length === 1) {
    const alone = dissenting[0];
    const found = alone.verdict === null ? "" : VERDICT_LABEL[alone.verdict].toLowerCase();
    parts.push(
      `${alone.name} stood alone, finding ${found}. Their reasoning is with the bench, ` +
        "in their own words.",
    );
  } else {
    parts.push(`${names(dissenting)} went the other way.`);
  }
  if (silent.length > 0) {
    parts.push(
      `${names(silent)} returned nothing a verdict could be read from, so the majority is a ` +
        "majority of the seats that ruled.",
    );
  }
  if (record.benchLineage.length > 0) {
    parts.push(
      "Two seats answered on models from one maker — judges built from shared weights can " +
        "agree for reasons that are not judicial.",
    );
  }
  return parts.join(" ");
}

const cap = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** The count of roles that reported, out of the seven a run makes. */
export function rolesAnswered(record: RunRecordView): { answered: number; of: number } {
  const statements = record.statements.filter((statement) => statement.ok).length;
  const judges = record.judges.filter((judge) => judge.verdict !== null).length;
  return { answered: statements + judges, of: record.statements.length + record.judges.length };
}
