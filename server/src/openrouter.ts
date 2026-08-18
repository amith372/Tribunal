/**
 * openrouter.ts — the single OpenRouter client. Every model call in the app goes
 * through `callChat`.
 *
 * specs.md Part 3: all models are reached through one client, which is also the one
 * place the free-model rule is enforced. `assertAllowedModel` runs over the whole
 * fallback chain before the first request leaves the server, so a disallowed model is
 * a thrown error, never a request.
 *
 * Token and price numbers are read from the API response and never computed here —
 * `usage: { include: true }` asks OpenRouter to account for the call, and whatever it
 * reports is what the run reports. An attempt whose usage came back absent records
 * nulls rather than a guessed zero.
 *
 * Every attempt is returned, including failed ones and fallbacks, because those tokens
 * were really spent and the results table has to be able to show them.
 */

import {
  ModelPolicyError,
  assertAllowedModel,
  getServerConfig,
  requireApiKey,
} from "./config.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** specs.md Part 5 warns a call may time out but sets no value; 60s per call. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * At most two attempts per call, walking down the fallback chain. This bounds a run at
 * ~14 requests, inside OpenRouter's 20/min free limit, and bounds the worst case at
 * two waves x two attempts x 60s.
 */
export const DEFAULT_MAX_ATTEMPTS = 2;

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

/**
 * OpenRouter's reasoning control. The strongest free models think at length by
 * default, which inflates the token table, slows the run, and can push a judge's reply
 * past its word cap. Effort is capped low and the reasoning text is excluded from the
 * returned content, so the parser reads only the answer. The reasoning tokens `usage`
 * reports are still counted — they were really spent.
 */
const REASONING = { effort: "low", exclude: true } as const;

export interface OpenRouterRequest {
  model: string;
  messages: readonly ChatMessage[];
  max_tokens: number;
  temperature?: number;
  reasoning: typeof REASONING;
  usage: { include: true };
}

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** OpenRouter's own accounting, in USD. Read, never computed. */
  cost?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface OpenRouterResponse {
  id?: string;
  /** The model that actually served the call — `openrouter/free` resolves at call time. */
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string | null; reasoning?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: OpenRouterUsage;
  error?: { code?: number | string; message?: string };
}

export interface Usage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
  /** USD, as reported by OpenRouter. `null` means it reported none. */
  readonly costUsd: number | null;
}

/** One request. A retry or a fallback is its own attempt, and its own row in the table. */
export interface Attempt {
  /** Which role this call served, e.g. "advocate:tyrion" or "judge:barak". */
  readonly label: string;
  /** Position in the chain, 1-based. Anything above 1 is a retry or a fallback. */
  readonly attempt: number;
  readonly isRetry: boolean;
  /** The identifier we asked for. */
  readonly requestedModel: string;
  /** The identifier that answered. Differs when the fallback router resolves. */
  readonly respondedModel: string | null;
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly finishReason: string | null;
  readonly errorKind: ErrorKind | null;
  readonly errorMessage: string | null;
  readonly usage: Usage;
  readonly elapsedMs: number;
  /** The response body exactly as received, for the run record. */
  readonly raw: unknown;
}

export type ErrorKind =
  | "timeout"
  | "rate_limited"
  | "daily_limit"
  | "unauthorized"
  | "model_unavailable"
  | "server_error"
  | "network"
  | "bad_response";

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly attempts: readonly Attempt[],
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export interface CallOptions {
  /** The fallback chain, most-preferred first. Built by `fallbackChainFor`. */
  readonly models: readonly string[];
  readonly messages: readonly ChatMessage[];
  /** Set above the word cap so a reply never truncates mid-form (specs.md Part 5). */
  readonly maxTokens: number;
  readonly label: string;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

export interface CallResult {
  readonly label: string;
  /** The assistant text, with reasoning already excluded. */
  readonly text: string;
  /** The model that actually answered. */
  readonly model: string;
  readonly finishReason: string | null;
  readonly usage: Usage;
  /** Every attempt made, in order. The last one is the success. */
  readonly attempts: readonly Attempt[];
}

const EMPTY_USAGE: Usage = {
  promptTokens: null,
  completionTokens: null,
  reasoningTokens: null,
  totalTokens: null,
  costUsd: null,
};

function readUsage(usage: OpenRouterUsage | undefined): Usage {
  if (!usage) return EMPTY_USAGE;
  const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
  return {
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    reasoningTokens: num(usage.completion_tokens_details?.reasoning_tokens),
    totalTokens: num(usage.total_tokens),
    costUsd: num(usage.cost),
  };
}

/** Which failures are worth trying the next model in the chain for. */
function isRetryable(kind: ErrorKind): boolean {
  return (
    kind === "timeout" ||
    kind === "rate_limited" ||
    kind === "model_unavailable" ||
    kind === "server_error" ||
    kind === "network" ||
    kind === "bad_response"
  );
}

function classifyStatus(status: number, message: string): ErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "unauthorized";
  if (status === 404) return "model_unavailable";
  if (status === 408) return "timeout";
  if (status === 429) {
    // OpenRouter's free tier caps both requests/minute and requests/day. The daily cap
    // is worth naming separately — it is reachable by demoing repeatedly, and "try
    // again in a moment" would be wrong advice.
    return /per\s*day|daily|free-models-per-day/i.test(message) ? "daily_limit" : "rate_limited";
  }
  if (status >= 500) return "server_error";
  return "bad_response";
}

function humanMessage(kind: ErrorKind, model: string, detail: string): string {
  switch (kind) {
    case "unauthorized":
      return `OpenRouter rejected the API key (${detail}). Check OPENROUTER_API_KEY.`;
    case "daily_limit":
      return "OpenRouter's daily free-model limit has been reached. Free runs resume tomorrow.";
    case "rate_limited":
      return `${model} is rate-limited right now (${detail}).`;
    case "model_unavailable":
      return `${model} is not available — it may have been delisted (${detail}).`;
    case "timeout":
      return `${model} did not respond in time.`;
    case "server_error":
      return `OpenRouter returned a server error for ${model} (${detail}).`;
    case "network":
      return `Could not reach OpenRouter for ${model} (${detail}).`;
    case "bad_response":
      return `${model} returned a response this app could not read (${detail}).`;
  }
}

interface AttemptOutcome {
  readonly attempt: Attempt;
  readonly result: CallResult | null;
}

async function attemptOnce(
  model: string,
  index: number,
  options: CallOptions,
  apiKey: string,
): Promise<AttemptOutcome> {
  const { appUrl } = getServerConfig();
  const startedAt = Date.now();

  const body: OpenRouterRequest = {
    model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    reasoning: REASONING,
    usage: { include: true },
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;

  const base = {
    label: options.label,
    attempt: index + 1,
    isRetry: index > 0,
    requestedModel: model,
  };

  const fail = (
    kind: ErrorKind,
    detail: string,
    extras: { httpStatus?: number | null; raw?: unknown; usage?: Usage; respondedModel?: string | null } = {},
  ): AttemptOutcome => ({
    attempt: {
      ...base,
      respondedModel: extras.respondedModel ?? null,
      ok: false,
      httpStatus: extras.httpStatus ?? null,
      finishReason: null,
      errorKind: kind,
      errorMessage: humanMessage(kind, model, detail),
      usage: extras.usage ?? EMPTY_USAGE,
      elapsedMs: Date.now() - startedAt,
      raw: extras.raw ?? null,
    },
    result: null,
  });

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter uses these for attribution on its free tier.
        "HTTP-Referer": appUrl,
        "X-Title": "The Tribunal",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const err = error as Error;
    const kind: ErrorKind = err.name === "TimeoutError" || err.name === "AbortError" ? "timeout" : "network";
    return fail(kind, err.message);
  }

  const text = await response.text();
  let parsed: OpenRouterResponse;
  try {
    parsed = JSON.parse(text) as OpenRouterResponse;
  } catch {
    return fail("bad_response", "the body was not JSON", {
      httpStatus: response.status,
      raw: text.slice(0, 2000),
    });
  }

  const usage = readUsage(parsed.usage);

  if (!response.ok || parsed.error) {
    const detail = parsed.error?.message ?? `HTTP ${response.status}`;
    const status = response.ok ? Number(parsed.error?.code ?? 0) || 200 : response.status;
    return fail(classifyStatus(status, detail), detail, {
      httpStatus: response.status,
      raw: parsed,
      usage,
      respondedModel: parsed.model ?? null,
    });
  }

  const choice = parsed.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (typeof content !== "string" || content.trim().length === 0) {
    return fail("bad_response", "no assistant content", {
      httpStatus: response.status,
      raw: parsed,
      usage,
      respondedModel: parsed.model ?? null,
    });
  }

  // specs.md Part 5: the results report the model named in the response, never the one
  // requested — `openrouter/free` resolves to a different model at call time.
  const respondedModel = parsed.model ?? model;
  const attempt: Attempt = {
    ...base,
    respondedModel,
    ok: true,
    httpStatus: response.status,
    finishReason: choice?.finish_reason ?? null,
    errorKind: null,
    errorMessage: null,
    usage,
    elapsedMs: Date.now() - startedAt,
    raw: parsed,
  };

  return {
    attempt,
    result: {
      label: options.label,
      text: content.trim(),
      model: respondedModel,
      finishReason: attempt.finishReason,
      usage,
      attempts: [],
    },
  };
}

/**
 * Makes one logical model call, walking the fallback chain on a retryable failure.
 *
 * Throws before any request if the chain names a model outside the free allowlist, if
 * the chain is empty, or if the API key is missing. Throws an `OpenRouterError`
 * carrying every attempt if the whole chain fails.
 */
export async function callChat(options: CallOptions): Promise<CallResult> {
  if (options.models.length === 0) {
    throw new ModelPolicyError(`No models given for ${options.label}.`);
  }
  // Guard the entire chain up front, so a disallowed model can never be reached by
  // failing over into it mid-run.
  for (const model of options.models) assertAllowedModel(model);

  const apiKey = requireApiKey();
  const limit = Math.min(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, options.models.length);
  const attempts: Attempt[] = [];

  for (let i = 0; i < limit; i++) {
    const model = options.models[i] as string;
    const { attempt, result } = await attemptOnce(model, i, options, apiKey);
    attempts.push(attempt);

    if (result) return { ...result, attempts };

    const kind = attempt.errorKind as ErrorKind;
    // An auth failure or an exhausted daily quota will not resolve by trying another
    // free model, so stop rather than burning the rest of the chain.
    if (!isRetryable(kind)) {
      throw new OpenRouterError(attempt.errorMessage ?? "Model call failed.", kind, attempts);
    }
  }

  const last = attempts[attempts.length - 1] as Attempt;
  throw new OpenRouterError(
    `${options.label} failed after ${attempts.length} attempt(s): ${last.errorMessage}`,
    last.errorKind ?? "bad_response",
    attempts,
  );
}
