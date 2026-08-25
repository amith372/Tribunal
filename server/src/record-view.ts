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
 */

import type { RunRecord } from "./aggregate.js";
import type { Attempt } from "./openrouter.js";
import type { JudgeOutcome } from "./judging.js";
import type { StatementOutcome } from "./statements.js";

type AttemptView = Omit<Attempt, "raw" | "httpStatus" | "finishReason">;
type StatementOutcomeView = Omit<StatementOutcome, "attempts"> & {
  readonly attempts: readonly AttemptView[];
};
type JudgeOutcomeView = Omit<JudgeOutcome, "attempts" | "rawText" | "route" | "problem" | "retryReason"> & {
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
      ({ rawText: _rawText, route: _route, problem: _problem, retryReason: _retryReason, attempts, ...rest }) => ({
        ...rest,
        attempts: attempts.map(trimAttempt),
      }),
    ),
    attempts: record.attempts.map(trimAttempt),
  };
}
