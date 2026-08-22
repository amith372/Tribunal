/**
 * The failure taxonomy at the call boundary (specs.md Part 5).
 *
 * The case these tests exist for: **a 429 is two different failures wearing one status
 * code.** One model rate-limiting is exactly what the fallback chain is for. The
 * account's daily free-model allowance running out is not — every free model is
 * refused at once, so failing over spends more requests against a limit that has
 * already gone, on a tier that rations requests rather than tokens.
 *
 * `fetch` is stubbed, so nothing here touches the network or needs a key that works.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterError, callChat } from "../openrouter.js";
import { FALLBACK_ROUTER, getModelRegistry, resetModelRegistry } from "../config.js";

const realFetch = globalThis.fetch;
const realKey = process.env.OPENROUTER_API_KEY;

/** Every call needs a key present; these tests never let a request reach the wire. */
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test-key-not-real";
  resetModelRegistry();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = realKey;
  resetModelRegistry();
  vi.restoreAllMocks();
});

/** One JSON response, as OpenRouter would send it. */
const respond = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const errorBody = (message: string) => ({ error: { message, code: 429 } });

const okBody = (model: string) => ({
  model,
  choices: [{ message: { content: "A statement." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0 },
});

const chain = (): string[] => {
  const { judgePool } = getModelRegistry();
  return [judgePool[0] as string, FALLBACK_ROUTER];
};

const call = (models: readonly string[]) =>
  callChat({
    models,
    messages: [{ role: "user", content: "Make your statement." }],
    maxTokens: 1000,
    label: "judge:test",
  });

describe("a 429 that names one model", () => {
  it("fails over to the next model in the chain", async () => {
    const models = chain();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(429, errorBody("Rate limit exceeded: 20 requests per minute")))
      .mockResolvedValueOnce(respond(200, okBody(models[1] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await call(models);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.errorKind).toBe("rate_limited");
    // The router is the last entry and it is genuinely reached, not merely listed.
    expect(result.model).toBe(FALLBACK_ROUTER);
  });
});

describe("a 429 that means the day's free requests are gone", () => {
  it("stops the run instead of spending the rest of the chain on it", async () => {
    const models = chain();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        respond(429, errorBody("Rate limit exceeded: free-models-per-day. Add credits to continue.")),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(call(models)).rejects.toThrow(OpenRouterError);

    // The point of the test: one request, not two. Failing over would burn a second
    // request against an allowance that is already exhausted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is classified as daily_limit and says so in words a user can act on", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(respond(429, errorBody("Daily quota exceeded for free models"))) as unknown as typeof fetch;

    const error = await call(chain()).catch((e: unknown) => e as OpenRouterError);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect((error as OpenRouterError).kind).toBe("daily_limit");
    // "Try again in a moment" would be wrong advice; the answer is tomorrow.
    expect((error as OpenRouterError).message).toMatch(/tomorrow/i);
  });
});

describe("the two are told apart by the message, not the status", () => {
  it("reads the same 429 as either kind depending on what it says", async () => {
    const cases: readonly (readonly [string, string])[] = [
      ["Rate limit exceeded: 20 requests per minute", "rate_limited"],
      ["free-models-per-day limit reached", "daily_limit"],
      ["You have exceeded your daily quota", "daily_limit"],
      ["Too many requests, slow down", "rate_limited"],
    ];

    for (const [message, expected] of cases) {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(respond(429, errorBody(message))) as unknown as typeof fetch;

      const error = (await call([chain()[0] as string]).catch((e: unknown) => e)) as OpenRouterError;
      expect(error.attempts[0]?.errorKind, message).toBe(expected);
    }
  });
});

describe("a reply that arrived but carries no answer", () => {
  /**
   * The failure measured on 2026-08-21: a reasoning model spends its whole budget
   * thinking and returns empty content with `finish_reason: length`. It must fail over
   * rather than be treated as an answer — a role that "succeeded" with nothing in it
   * would put an empty statement in front of the judges and into the export.
   */
  it("is a retryable failure, not a successful empty answer", async () => {
    const models = chain();
    const empty = {
      model: models[0] as string,
      choices: [{ message: { content: "   " }, finish_reason: "length" }],
      usage: { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500, cost: 0 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, empty))
      .mockResolvedValueOnce(respond(200, okBody(models[1] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await call(models);

    expect(result.attempts[0]?.ok).toBe(false);
    expect(result.attempts[0]?.errorKind).toBe("bad_response");
    // The tokens were really spent and stay in the table (specs.md Part 5).
    expect(result.attempts[0]?.usage.totalTokens).toBe(500);
    expect(result.text).toBe("A statement.");
  });
});

describe("the model that answered", () => {
  /**
   * specs.md Part 5: the free router resolves to a different model at call time, so the
   * results report the model named in the response, never the one requested. This is
   * what makes the router safe to put at the end of every chain.
   */
  it("is read from the response, not from what was asked for", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(respond(200, okBody("someone/else-entirely:free"))) as unknown as typeof fetch;

    const result = await call([FALLBACK_ROUTER]);

    expect(result.model).toBe("someone/else-entirely:free");
    expect(result.attempts[0]?.requestedModel).toBe(FALLBACK_ROUTER);
    expect(result.attempts[0]?.respondedModel).toBe("someone/else-entirely:free");
  });

  it("falls back to the requested identifier when the response names none", async () => {
    const models = chain();
    const noModel = {
      choices: [{ message: { content: "A statement." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(respond(200, noModel)) as unknown as typeof fetch;

    const result = await call(models);
    expect(result.model).toBe(models[0]);
  });
});

describe("an error hiding inside a 200", () => {
  it("is classified by the code in the body, not by the HTTP status", async () => {
    // OpenRouter can answer 200 and put the failure in the payload.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(respond(200, errorBody("free-models-per-day limit reached"))) as unknown as typeof fetch;

    const error = (await call(chain()).catch((e: unknown) => e)) as OpenRouterError;

    expect(error.kind).toBe("daily_limit");
    expect(error.attempts[0]?.httpStatus).toBe(200);
  });
});

/**
 * **Where the next request goes depends on why the last one failed.**
 *
 * A run gets roughly fifty free requests a day and spends seven on a good one, so a
 * wasted request is not free. Four of the seven seats failed in the live run of
 * 2026-08-22 and every one of them was rate-limited or delisted — kinds where asking the
 * same model again is guaranteed to be told the same thing. A timeout or a provider
 * five-hundred is the opposite case: momentary, and the cheapest fix is to ask again.
 */
describe("choosing where the next request goes", () => {
  /** The `model` each request actually named, in the order they were sent. */
  const modelsAsked = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
    fetchMock.mock.calls.map(
      (args) => (JSON.parse((args[1] as RequestInit).body as string) as { model: string }).model,
    );

  const threeDeep = (): string[] => {
    const { judgePool } = getModelRegistry();
    return [judgePool[0] as string, judgePool[1] as string, FALLBACK_ROUTER];
  };

  it("asks the same model again after a provider error, then moves on", async () => {
    const models = threeDeep();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(500, errorBody("upstream exploded")))
      .mockResolvedValueOnce(respond(500, errorBody("upstream exploded again")))
      .mockResolvedValueOnce(respond(200, okBody(models[1] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await call(models);

    // Own model twice, and only then the spare — the accident got its second chance
    // before the role gave up the model it was cast with.
    expect(modelsAsked(fetchMock)).toEqual([models[0], models[0], models[1]]);
    expect(result.attempts).toHaveLength(3);
  });

  it("asks the same model again after a timeout, and takes the answer", async () => {
    const models = threeDeep();
    const timeout = Object.assign(new Error("The operation timed out."), {
      name: "TimeoutError",
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(respond(200, okBody(models[0] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await call(models);

    expect(modelsAsked(fetchMock)).toEqual([models[0], models[0]]);
    expect(result.attempts[0]?.errorKind).toBe("timeout");
    expect(result.model).toBe(models[0]);
  });

  it("never asks a rate-limited model again — it skips straight to the next", async () => {
    const models = threeDeep();
    const limited = errorBody("Rate limit exceeded: 20 requests per minute");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(429, limited))
      .mockResolvedValueOnce(respond(429, limited))
      .mockResolvedValueOnce(respond(200, okBody(models[2] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await call(models);

    // Three different models, no repeats: a limit that was hitting a second ago is
    // hitting still, so the second ask would spend a request to learn nothing.
    expect(modelsAsked(fetchMock)).toEqual(models);
  });

  it("never asks a delisted model again either", async () => {
    const models = threeDeep();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(404, { error: { message: "No endpoints found", code: 404 } }))
      .mockResolvedValueOnce(respond(200, okBody(models[1] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await call(models);

    expect(modelsAsked(fetchMock)).toEqual([models[0], models[1]]);
  });

  it("spends at most three requests however the failures fall", async () => {
    const models = threeDeep();
    // A fresh Response per call: a body can only be read once, so a single shared one
    // would fail on the second request for a reason that has nothing to do with the code.
    const fetchMock = vi.fn().mockImplementation(() => respond(500, errorBody("still broken")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(call(models)).rejects.toBeInstanceOf(OpenRouterError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives the same model at most one second ask, never two", async () => {
    const models = threeDeep();
    const fetchMock = vi.fn().mockImplementation(() => respond(500, errorBody("still broken")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(call(models)).rejects.toBeInstanceOf(OpenRouterError);

    // own, own, spare — a fault that survives a second request is not the momentary kind
    // the repeat exists for, so the third request moves on rather than asking a third time.
    expect(modelsAsked(fetchMock)).toEqual([models[0], models[0], models[1]]);
  });

  it("still stops dead on the daily cap, without asking anything twice", async () => {
    const models = threeDeep();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => respond(429, errorBody("free-models-per-day limit reached")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(call(models)).rejects.toMatchObject({ kind: "daily_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The abort signal covers the whole exchange, so a model that answers its headers fast
   * and then generates slowly hits the deadline while the *body* is being read. That read
   * was unguarded until 2026-08-22, and the throw escaped the client entirely — no attempt
   * row, no `ErrorKind`, and no retry, because what came out was not an `OpenRouterError`.
   * A run lost an advocate to it at exactly 60.1s with nothing in the record to explain it.
   */
  it("records a timeout that lands while the body is being read, and retries it", async () => {
    const models = threeDeep();
    const slowBody = (): Response => {
      const response = respond(200, okBody(models[0] as string));
      Object.defineProperty(response, "text", {
        value: () =>
          Promise.reject(
            Object.assign(new Error("The operation was aborted due to timeout"), {
              name: "TimeoutError",
            }),
          ),
      });
      return response;
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(slowBody)
      .mockImplementationOnce(() => respond(200, okBody(models[0] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await call(models);

    // The lost attempt is a row like any other, classified, and it bought the same-model
    // retry that a timeout is supposed to buy.
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.errorKind).toBe("timeout");
    expect(modelsAsked(fetchMock)).toEqual([models[0], models[0]]);
  });

  it("moves to the next model when a reply arrives carrying nothing", async () => {
    const models = threeDeep();
    const empty = (model: string) => ({
      model,
      choices: [{ message: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, cost: 0 },
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => respond(200, empty(models[0] as string)))
      .mockImplementationOnce(() => respond(200, okBody(models[1] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await call(models);

    // Empty content is how a model behaves on a prompt, not a hiccup it recovers from —
    // measured 2026-08-22, when one returned nothing twice and burned the call's last
    // attempt on the repeat instead of reaching a model that could answer.
    expect(result.attempts[0]?.errorKind).toBe("bad_response");
    expect(modelsAsked(fetchMock)).toEqual([models[0], models[1]]);
  });

  it("marks every request after the first as a retry, numbered in sequence", async () => {
    const models = threeDeep();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(500, errorBody("upstream exploded")))
      .mockResolvedValueOnce(respond(500, errorBody("upstream exploded again")))
      .mockResolvedValueOnce(respond(200, okBody(models[1] as string)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await call(models);

    // The token table has to be able to show a retry as a retry (Part 2's "real numbers").
    expect(result.attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
    expect(result.attempts.map((a) => a.isRetry)).toEqual([false, true, true]);
  });
});
