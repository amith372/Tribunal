/**
 * security-headers.ts — the response headers the browser is told to enforce.
 *
 * **Written out rather than pulled in.** `helmet` would do this in one line, and the
 * one-line version is the right call in most projects. Here it is not: this server has
 * three production dependencies, every one of which is load-bearing, and a header is a
 * decision — a `Content-Security-Policy` that nobody can explain is a policy that gets
 * widened the first time something breaks. Each line below says what it stops and why the
 * app can live with it.
 *
 * **What this app actually has to allow**, which is what shapes the policy:
 *   - Its type comes from Google Fonts (`web/index.html`), so the stylesheet host and the
 *     font host are named. The exported record embeds its own face and links nothing, so
 *     nothing here constrains the file a reader downloads.
 *   - Seven `style={{…}}` attributes in the React source, so inline *attributes* are
 *     allowed. Inline `<script>` is not, and that is the half that matters: a policy that
 *     stops script injection while permitting a width in a style attribute is worth far
 *     more than no policy at all.
 *   - `connect-src 'self'` — the browser talks only to this origin. Every model call is
 *     made by the server, and specs.md Part 1 requires exactly that: the key and the
 *     prompts never reach the browser, so the browser never needs to reach OpenRouter.
 */

import type { NextFunction, Request, Response } from "express";

const FONT_STYLESHEET = "https://fonts.googleapis.com";
const FONT_FILES = "https://fonts.gstatic.com";

const POLICY = [
  // Nothing loads from anywhere unless a line below says otherwise.
  "default-src 'self'",
  // No injected script can run, and no script may be pulled from another origin. This is
  // the line doing the real work.
  "script-src 'self'",
  // The app's own CSS, Google's stylesheet, and the inline style attributes React writes.
  `style-src 'self' ${FONT_STYLESHEET} 'unsafe-inline'`,
  // The avatars are same-origin WebP; `data:` covers anything inlined by the build.
  "img-src 'self' data:",
  `font-src 'self' ${FONT_FILES} data:`,
  // The browser has no business calling anything but this server (see the docblock).
  "connect-src 'self'",
  // No plugins, and no framing this app inside another page — the modern spelling of
  // X-Frame-Options, kept alongside it below for browsers that only know the old one.
  "object-src 'none'",
  "frame-ancestors 'none'",
  // A relative form action cannot be redirected off-origin. This app posts nowhere else.
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");

/**
 * Applied to every response, API and static alike.
 *
 * Deliberately not `Strict-Transport-Security`: Render terminates TLS and already serves
 * this app over HTTPS, and asserting HSTS from inside the process would also assert it for
 * a developer running the server over plain HTTP on localhost, where it is both wrong and
 * annoying to undo — a browser remembers it long after the header stops being sent.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", POLICY);
  // Stops a browser from guessing a response is HTML when the server said it was not —
  // the trick that turns an uploaded or echoed file into a script.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // A run id is the only handle a run has (specs.md Part 3). Sending a full URL to another
  // site in a `Referer` header would hand that id to whoever the user clicked through to.
  res.setHeader("Referrer-Policy", "no-referrer");
  // This app asks for none of these, so it declines them on every response rather than
  // leaving the question open.
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
}
