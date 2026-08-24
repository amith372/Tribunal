/**
 * results-model.ts — everything the five panels say, worked out once and away from React.
 *
 * **Nothing here computes a number.** specs.md Part 3: one run produces one record, and the
 * panels, the stream's closing message and the exported file are three renderings of that
 * one object rather than three places that each work the numbers out. So this module reads
 * the record and arranges it — it sums attempts the record already contains, it picks
 * labels, it orders sides — and there is no branch in it that could produce a token count,
 * a price or a verdict the server did not send. That is what makes "the export's numbers
 * match what the app showed" true by construction rather than by coincidence.
 *
 * It is a plain module rather than hooks or components for one reason: the sentences these
 * functions build are the claims the app makes about a run — how many judges agreed, who
 * dissented, whether the trial was complete — and those are worth testing directly, against
 * a hung bench and an abandoned run as well as a clean one, without rendering anything.
 *
 * **Defense reads left, prosecution right**, here as on Side Select and the trial screen.
 * The order is arbitrary and was fixed once so that a side sits in one place across the
 * whole app; `bySide` is the single function that holds it.
 *
 * **This is a mirror of `server/src/summary.ts`, and it is checked against it.** The
 * exported file carries the same five sections in the same order as these panels, so a
 * reader can hold one against the other — which only means anything if the two say the
 * same words. `server/src/__tests__/summary-mirror.test.ts` runs both over a catalogue of
 * records and fails on the first sentence that differs. The test lives in the server's
 * suite for the same reason `preflight-mirror.ts`'s does: what is being checked is
 * *agreement*, and a test beside only one of the two cannot check it.
 */

import type {
  Attempt,
  JudgeView,
  RunRecordView,
  Side,
  StatementView,
  Verdict,
} from "./api.js";

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

/** Clamped rather than wrapped: the first panel has no "previous" and the last no "next". */
export function stepPanel(current: number, by: number): number {
  return Math.min(PANELS.length - 1, Math.max(0, current + by));
}

/* ---- labels --------------------------------------------------------------------------- */

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

/**
 * The masthead's one line on this screen: who was tried, when, and how it was cast.
 *
 * Rendered in UTC, exactly as the exported file renders it, so the record a reader
 * downloads and the screen they downloaded it from do not disagree about the date.
 */
export function runSubtitle(record: RunRecordView): string {
  const at = new Date(record.startedAt);
  const when = Number.isNaN(at.getTime())
    ? record.startedAt
    : `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
  return `${record.defendant.name}, defendant · ${when} · ${MODE_LABEL[record.mode] ?? record.mode}`;
}

/* ---- panel 1: the finding -------------------------------------------------------------- */

export interface Headline {
  readonly title: string;
  readonly detail: string;
  readonly tone: "guilty" | "acquitted" | "unresolved";
}

/**
 * How the run ended, as the words the panel prints.
 *
 * The outcome is a shape rather than a verdict with a flag (Part 3), so each kind is
 * written out on its own: there is no branch here in which a verdict could be printed for
 * a run that never reached one, because three of the four cases have no verdict field at
 * all to print from.
 */
export function headline(record: RunRecordView): Headline {
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

/* ---- sides ------------------------------------------------------------------------------ */

/** The two columns, defense first. Casting order is kept inside each. */
export function bySide<T extends { readonly side: Side }>(
  rows: readonly T[],
): { readonly defense: readonly T[]; readonly prosecution: readonly T[] } {
  return {
    defense: rows.filter((row) => row.side === "for"),
    prosecution: rows.filter((row) => row.side === "against"),
  };
}

/* ---- panel 4: what it spent -------------------------------------------------------------- */

/**
 * Tokens and time for a set of attempts, summed — retries and fallbacks included, because
 * those were really spent too.
 *
 * `tokens` is `null` where no attempt reported usage at all. A zero there would read as
 * "this was free", which is a different claim from "the model did not say".
 */
export function usageOf(attempts: readonly Attempt[]): {
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
  readonly attempts: readonly Attempt[];
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
 * The plan asks this panel for the numbers "per call **and per stage**", and the stage is
 * the honest unit for the elapsed time: the four advocates are asked all at once, so their
 * times overlap and adding them up would claim the wave took longer than it did. The
 * caption says which it is, and the run's own `totals.elapsedMs` — the wall clock the
 * server measured — is what the final row reports.
 *
 * The wave is read from the attempt's label (`advocate:tyrion`, `judge:barak`), which is
 * the same string the record's per-call table prints, so a row cannot land under a heading
 * that disagrees with its own name.
 */
export function stages(record: RunRecordView): readonly StageRollup[] {
  const groups: { stage: "advocate" | "judge"; caption: string }[] = [
    { stage: "advocate", caption: "The advocates — asked together" },
    { stage: "judge", caption: "The bench — asked together, after the statements" },
  ];

  return groups
    .map(({ stage, caption }) => {
      const attempts = record.attempts.filter((attempt) => attempt.label.startsWith(`${stage}:`));
      const sum = (read: (attempt: Attempt) => number | null): number =>
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

/* ---- panel 5: in closing ----------------------------------------------------------------- */

export interface SummaryRow {
  readonly label: string;
  readonly value: string;
  /** Set only on the finding, so the one coloured value on the slide is the verdict. */
  readonly tone?: "guilty" | "acquitted" | "unresolved";
}

const names = (rows: readonly { readonly name: string }[]): string =>
  rows.length === 0 ? "—" : rows.map((row) => row.name).join(" · ");

const number = (n: number): string => n.toLocaleString("en-US");

/** $0 while only free models are used — read from the record, never asserted (Part 2). */
export const price = (usd: number): string => (usd === 0 ? "$0" : `$${usd.toFixed(6)}`);

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

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
 * The closing slide's two sentences.
 *
 * They are assembled from counts the record already holds — how many advocates delivered,
 * how many judges ruled which way — and never from a reading of what anybody argued. The
 * app does not summarise a judge's reasoning; the reasoning is on panel 2 in the judge's
 * own words, and paraphrasing it here would be the app writing part of the record.
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
    (judge) => judge.verdict !== null && judge.verdict !== outcome.verdict,
  );
  const silent = record.judges.filter((judge) => judge.verdict === null);

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

/* ---- shared bits the panels need ---------------------------------------------------------- */

/** The count of roles that reported, out of the seven a run makes. */
export function rolesAnswered(record: RunRecordView): { answered: number; of: number } {
  const statements = record.statements.filter((statement: StatementView) => statement.ok).length;
  const judges = record.judges.filter((judge: JudgeView) => judge.verdict !== null).length;
  return { answered: statements + judges, of: record.statements.length + record.judges.length };
}

export { number };
