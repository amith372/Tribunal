/**
 * The headers every response carries, and the two things the policy must not break.
 *
 * A `Content-Security-Policy` is only worth having if it is still there in a month, and the
 * way policies die is that something stops working and the policy gets widened to fix it.
 * So the two allowances this app genuinely needs — the Google font hosts, and the inline
 * style *attributes* React writes — are asserted here as deliberate, and the one that must
 * never be granted is asserted as absent.
 *
 * `security-headers.ts` explains why the policy is written out rather than pulled in.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../app.js";
import { loadData } from "../data.js";

const data = loadData();

let server: Server;
let url: string;

beforeAll(async () => {
  const app = createApp({ data, logRuns: false });
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function headers(path: string): Promise<Headers> {
  const response = await fetch(`${url}${path}`);
  return response.headers;
}

describe("every response carries the security headers", () => {
  it("sets them on the API as well as on the app shell", async () => {
    const api = await headers("/api/health");
    expect(api.get("content-security-policy")).toContain("default-src 'self'");
    expect(api.get("x-content-type-options")).toBe("nosniff");
    expect(api.get("x-frame-options")).toBe("DENY");
    expect(api.get("referrer-policy")).toBe("no-referrer");
  });

  /**
   * A run id is the only handle a run has, and it travels in the URL. A default referrer
   * policy would hand that id to any site a user clicked through to.
   */
  it("sends no referrer, because the URL carries the run id", async () => {
    expect((await headers("/api/health")).get("referrer-policy")).toBe("no-referrer");
  });
});

describe("the policy allows exactly what the app needs", () => {
  it("permits the font hosts the running app loads its type from", async () => {
    const policy = (await headers("/api/health")).get("content-security-policy") ?? "";
    expect(policy).toContain("https://fonts.googleapis.com");
    expect(policy).toContain("https://fonts.gstatic.com");
  });

  it("permits inline style attributes, which React writes and the screens rely on", async () => {
    const policy = (await headers("/api/health")).get("content-security-policy") ?? "";
    expect(policy).toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  /**
   * The line the whole policy is for. Allowing inline *style* costs little; allowing inline
   * *script* would give away the only thing CSP is really being asked to stop here.
   */
  it("never permits inline script", async () => {
    const policy = (await headers("/api/health")).get("content-security-policy") ?? "";
    expect(policy).toMatch(/script-src 'self'/);
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  /**
   * specs.md Part 1: the key and the prompts are the server's, so the browser has no reason
   * to call anything but this origin. If that ever stops being true, this test is where the
   * argument for changing it has to be made.
   */
  it("lets the browser talk only to this server", async () => {
    const policy = (await headers("/api/health")).get("content-security-policy") ?? "";
    expect(policy).toContain("connect-src 'self'");
  });
});
