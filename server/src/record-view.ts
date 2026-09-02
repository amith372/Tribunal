/**
 * record-view.ts — trims a finished `RunRecord` down to what the browser is allowed to
 * see, for the one path a record reaches the browser by: the `done` SSE frame and the
 * `GET /api/archive/:id` JSON response share this so a run looks the same read live or
 * read back from the archive.
 *
 * The full `RunRecord` — raw response bodies included — is still what `buildExportHtml`,
 * `runs-log.ts` and the archive store see; the export shows the raw body per attempt and
 * the retry reason per judge, which is exactly why those must stay out of the network
 * response instead of being stripped upstream of everything.
 *
 * **`problem` crosses, and it is the one of those four that must.** A seat that returned
 * nothing now says on the bench panel *what kind* of nothing came back — the reply was cut
 * off, or carried no verdict, or supported both at once — and that is read off this field
 * (`summary.ts`, `judgeNoAnswer`). It is a four-value enum describing this run's own
 * outcome: it names no model, quotes no reply and carries nothing of the key or the
 * prompts, which is why it can cross where `rawText` and `route` cannot.
 */

import type { RunRecord } from "./aggregate.js";
import type { Attempt } from "./openrouter.js";
import type { JudgeOutcome } from "./judging.js";
import type { StatementOutcome } from "./statements.js";

export type AttemptView = Omit<Attempt, "raw" | "httpStatus" | "finishReason">;
export type StatementOutcomeView = Omit<StatementOutcome, "attempts"> & {
  readonly attempts: readonly AttemptView[];
};
export type JudgeOutcomeView = Omit<JudgeOutcome, "attempts" | "rawText" | "route" | "retryReason"> & {
  readonly attempts: readonly AttemptView[];
};
export type RunRecordView = Omit<RunRecord, "statements" | "judges" | "attempts"> & {
  readonly statements: readonly StatementOutcomeView[];
  readonly judges: readonly JudgeOutcomeView[];
  readonly attempts: readonly AttemptView[];
};

function trimAttempt({ raw: _raw, httpStatus: _httpStatus, finishReason: _finishReason, ...rest }: Attempt): AttemptView {
  return rest;
}

export function toRunRecordView(record: RunRecord): RunRecordView {
  return {
    ...record,
    statements: record.statements.map((statement) => ({
      ...statement,
      attempts: statement.attempts.map(trimAttempt),
    })),
    judges: record.judges.map(
      ({ rawText: _rawText, route: _route, retryReason: _retryReason, attempts, ...rest }) => ({
        ...rest,
        attempts: attempts.map(trimAttempt),
      }),
    ),
    attempts: record.attempts.map(trimAttempt),
  };
}
