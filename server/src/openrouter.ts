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

import { noteFailure, noteSuccess } from "./model-health.js";
import {
  EXCLUDED_MODELS,
  MAX_ATTEMPTS_PER_CALL,
  ModelPolicyError,
  assertAllowedModel,
  getServerConfig,
  requireApiKey,
} from "./config.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * specs.md Part 5 warns a call may time out but sets no value.
 *
 * **Ninety seconds, raised from sixty on measurement.** Free models are slow: across three
 * live runs the successful calls took up to 41 seconds, and one advocate was cut off at
 * exactly 60 — not hung, just still writing. A timeout that fires on a model which was
 * going to answer is the most expensive kind of failure there is, because it costs the
 * wait *and* a retry, and the retry is usually just as slow. The ceiling is set above the
 * slowest observed answer with room, so that what it catches is a model that has genuinely
 * stopped rather than one that is merely deliberate.
 */
export const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * At most three requests per logical call. This bounds a run at ~21 requests, inside
 * OpenRouter's 20-per-minute free limit for the waves as they are actually issued, and
 * bounds the worst case at two waves x three attempts x 60s.
 *
 * Where each request goes is not simply "the next model" — see `sameModelMayClear`.
 *
 * Defined in `config.ts` because `fallbackChainFor` must build a chain no longer than
 * this, and that module cannot import this one without the two importing each other.
 */
export const DEFAULT_MAX_ATTEMPTS = MAX_ATTEMPTS_PER_CALL;

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

/**
 * The useful half of an error body. OpenRouter's own `message` is often just "Provider
 * returned error"; what the failure actually *was* sits in `metadata`, which names the
 * upstream provider and — for a 429 — whether the limit belongs to this account or to a
 * pool shared with every other free user. Those are different problems with different
 * answers, and the record should say which one it hit.
 */
export interface OpenRouterErrorMetadata {
  /** The upstream provider's own message, e.g. "rate-limited upstream". */
  raw?: string;
  provider_name?: string;
  /** e.g. `upstream_provider_shared_pool` — not this account's quota at all. */
  limit_source?: string;
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
  error?: { code?: number | string; message?: string; metadata?: OpenRouterErrorMetadata };
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
  /** This key may not use *this model* — the key itself is fine. Falls over. */
  | "model_forbidden"
  /** The router resolved to a model this app has measured and will not seat. */
  | "model_excluded"
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
  /**
   * How many requests this logical call has already made, when a caller re-enters with a
   * fresh chain — a judge asking again at temperature 0, or an advocate re-asked after a
   * refused reply. Both start a new walk, so without this their rows would restart at
   * attempt 1 and report `isRetry: false`, and the token table would show a retry as if
   * it were a first attempt. Measured live on 2026-08-22: a judge's three rows read 1, 2,
   * 1. The count continues instead, which is what makes "every attempt is its own row,
   * marked as a retry" true rather than nearly true.
   */
  readonly priorAttempts?: number;
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

/** Which failures are worth spending another request on at all. */
function isRetryable(kind: ErrorKind): boolean {
  return (
    kind === "timeout" ||
    kind === "rate_limited" ||
    kind === "model_forbidden" ||
    kind === "model_excluded" ||
    kind === "model_unavailable" ||
    kind === "server_error" ||
    kind === "network" ||
    kind === "bad_response"
  );
}

/**
 * Which failures are worth asking the *same* model about a second time.
 *
 * The four below are accidents of a moment — a request that took too long, a provider
 * five-hundred, a connection that dropped, a body that came back malformed. Asking again
 * is the cheapest thing that can clear them, and it keeps the role on the model it was
 * cast with rather than spending a vetted spare on a hiccup.
 *
 * The others are not accidents. A rate limit that was hitting a second ago is hitting
 * still — specs.md Part 5 makes exactly this argument about a judge's retry — and a
 * delisted or gated model does not change its mind between two requests. Asking any of
 * them again spends a request from an allowance rationed in requests to be told the same
 * thing. Measured on 2026-08-22: all four failures in a seven-call run were of those kinds,
 * so a blanket same-model retry would have cost four extra requests and bought nothing.
 *
 * **`bad_response` is excluded too, and that was learned the hard way.** A reply that
 * arrived carrying no usable content is a disposition rather than a hiccup: it is how a
 * particular model behaves on a particular kind of prompt. `statements.ts` already reasons
 * this way about a reply that talks about the task instead of the case — "a behavioural
 * tendency, and asking again mostly returns another one" — and the bench proved the same
 * thing on 2026-08-22, when a model returned empty content twice in a row and burned the
 * call's last attempt on a repeat instead of moving to a model that could answer.
 */
function sameModelMayClear(kind: ErrorKind): boolean {
  return kind === "timeout" || kind === "server_error" || kind === "network";
}

function classifyStatus(status: number, message: string): ErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 402) return "unauthorized";
  // **403 is about the model, not the key.** A rejected key is a 401; a 403 means this
  // key may not use this particular model — OpenRouter returns it for models gated to
  // agentic harnesses, and for a moderation flag. Measured 2026-08-22: two models the
  // public roster lists as free answered every request with "only available on agentic
  // harnesses", and because a 403 was read as a bad key it was treated as fatal, so two
  // roles died on the spot with vetted spares still untried and five other calls in the
  // same run succeeding on the very same key. The key is not the problem; the model is.
  if (status === 403) return "model_forbidden";
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
    case "model_forbidden":
      return `This app is not permitted to use ${model} (${detail}). The API key is fine; the model is gated.`;
    case "model_excluded":
      return `The free router resolved to ${detail}, which this app does not seat. Moving on.`;
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

/** A timeout and a dropped connection look alike until you read the error's name. */
function abortedKind(error: unknown): ErrorKind {
  const name = (error as Error).name;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
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

  const prior = options.priorAttempts ?? 0;
  const base = {
    label: options.label,
    attempt: prior + index + 1,
    isRetry: prior + index > 0,
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
    return fail(abortedKind(error), (error as Error).message);
  }

  /**
   * **Reading the body is inside the timeout, so reading it can throw.** The abort signal
   * covers the whole exchange, not just the headers, and a model that answers its headers
   * quickly and then generates slowly hits the deadline here rather than above. This was
   * unguarded until 2026-08-22, and the consequence was worse than a lost call: the throw
   * escaped `attemptOnce` and `callChat` entirely, so the attempt never became a row in the
   * token table, the failure never got an `ErrorKind`, and — because it was no longer an
   * `OpenRouterError` — none of the retry logic above ever saw it. A run measured that day
   * lost an advocate at exactly 60.1s to a single unretried attempt that the record could
   * not account for.
   */
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return fail(abortedKind(error), (error as Error).message, { httpStatus: response.status });
  }

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
    // Prefer what the upstream provider said over OpenRouter's generic wrapper, and name
    // the provider — "rate-limited upstream in a shared pool" is a diagnosis, where
    // "Provider returned error" is only an assertion that something went wrong.
    const meta = parsed.error?.metadata;
    const upstream = meta?.raw
      ? `${meta.raw}${meta.provider_name ? ` [${meta.provider_name}` : ""}${
          meta.provider_name && meta.limit_source ? `, ${meta.limit_source}` : ""
        }${meta.provider_name ? "]" : ""}`
      : null;
    const detail = upstream ?? parsed.error?.message ?? `HTTP ${response.status}`;
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

  // **The one guard that has to read the response rather than the request.** Everything
  // else is checked before a request leaves, but the router is permitted by name and
  // resolves to whatever it likes, so a model this app has measured and rejected can only
  // be caught here. The request is already spent; what is refused is the seat.
  const excluded = EXCLUDED_MODELS.get(respondedModel);
  if (excluded) {
    return fail("model_excluded", `${respondedModel} (${excluded})`, {
      httpStatus: response.status,
      raw: parsed,
      usage,
      respondedModel,
    });
  }
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
  const limit = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attempts: Attempt[] = [];

  // **Where the next request goes depends on why the last one failed**, so the walk is a
  // while loop over two counters rather than a for loop over the chain: `index` is which
  // model, and `attempts.length` is how many requests have been spent. They are no longer
  // the same number, because a transient failure buys one more ask of the same model.
  let index = 0;
  let repeated = false;

  while (attempts.length < limit && index < options.models.length) {
    const model = options.models[index] as string;
    const { attempt, result } = await attemptOnce(model, attempts.length, options, apiKey);
    attempts.push(attempt);

    if (result) {
      noteSuccess(model);
      return { ...result, attempts };
    }

    const kind = attempt.errorKind as ErrorKind;
    // What this request just taught us about the model, so the rest of the run — and the
    // next one — does not have to learn it again at a request apiece.
    noteFailure(model, kind);
    // An auth failure or an exhausted daily quota will not resolve by trying another
    // free model, so stop rather than burning the rest of the chain.
    if (!isRetryable(kind)) {
      throw new OpenRouterError(attempt.errorMessage ?? "Model call failed.", kind, attempts);
    }

    if (sameModelMayClear(kind) && !repeated) {
      // One more ask of the same model, and only one — a fault that survives a second
      // request is not the momentary kind this exists for.
      repeated = true;
    } else {
      index++;
      repeated = false;
    }
  }

  const last = attempts[attempts.length - 1] as Attempt;
  throw new OpenRouterError(
    `${options.label} failed after ${attempts.length} attempt(s): ${last.errorMessage}`,
    last.errorKind ?? "bad_response",
    attempts,
  );
}
