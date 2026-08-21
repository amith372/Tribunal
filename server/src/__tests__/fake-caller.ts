/**
 * A stand-in for `callChat`, so the statement wave and the judging ladder can be tested
 * whole — parallelism, failures, retries, the abort rule — with no API key, no network,
 * and no model calls. Stage 3 makes zero of those by design.
 *
 * Every fake reply still carries an `Attempt`, because both waves are expected to hand
 * their attempts to the token table and that plumbing is worth asserting.
 */

import type { Attempt, CallOptions, CallResult, Usage } from "../openrouter.js";
import { OpenRouterError, type ErrorKind } from "../openrouter.js";

const USAGE: Usage = {
  promptTokens: 400,
  completionTokens: 90,
  reasoningTokens: 20,
  totalTokens: 510,
  costUsd: 0,
};

export function fakeAttempt(label: string, model: string, ok = true): Attempt {
  return {
    label,
    attempt: 1,
    isRetry: false,
    requestedModel: model,
    respondedModel: ok ? model : null,
    ok,
    httpStatus: ok ? 200 : 503,
    finishReason: ok ? "stop" : null,
    errorKind: ok ? null : "server_error",
    errorMessage: ok ? null : "fake failure",
    usage: USAGE,
    elapsedMs: 1234,
    raw: null,
  };
}

export function fakeResult(options: CallOptions, text: string): CallResult {
  const model = options.models[0] as string;
  return {
    label: options.label,
    text,
    model,
    finishReason: "stop",
    usage: USAGE,
    attempts: [fakeAttempt(options.label, model)],
  };
}

export function fakeError(options: CallOptions, kind: ErrorKind = "server_error"): OpenRouterError {
  const model = options.models[0] as string;
  return new OpenRouterError(`${options.label} failed after 2 attempt(s): fake failure`, kind, [
    fakeAttempt(options.label, model, false),
  ]);
}

export interface RecordedCall {
  readonly options: CallOptions;
}

/**
 * A caller driven by a per-label script. Each label's replies are consumed in order, so
 * a judge's first and second attempt can be scripted independently. A reply may be a
 * string (answered) or an `ErrorKind` (thrown).
 */
export function scriptedCaller(script: Record<string, readonly (string | ErrorKind)[]>) {
  const calls: RecordedCall[] = [];
  const cursor = new Map<string, number>();

  const call = async (options: CallOptions): Promise<CallResult> => {
    calls.push({ options });
    const replies = script[options.label];
    if (!replies) throw new Error(`No scripted reply for "${options.label}"`);

    const index = cursor.get(options.label) ?? 0;
    cursor.set(options.label, index + 1);
    const reply = replies[Math.min(index, replies.length - 1)] as string | ErrorKind;

    if (isErrorKind(reply)) throw fakeError(options, reply);
    return fakeResult(options, reply);
  };

  return { call, calls };
}

const ERROR_KINDS: readonly string[] = [
  "timeout",
  "rate_limited",
  "daily_limit",
  "unauthorized",
  "model_unavailable",
  "server_error",
  "network",
  "bad_response",
];

function isErrorKind(reply: string): reply is ErrorKind {
  return ERROR_KINDS.includes(reply);
}
