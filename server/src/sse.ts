/**
 * sse.ts — the wire format, kept apart from the routing so it can be tested as a string
 * function rather than through a socket.
 *
 * specs.md Part 3: "results are pushed as they settle rather than delivered in one silent
 * batch at the end." Two things make that literally true rather than nearly true:
 *
 *   · **Nothing is buffered on the way out.** Each event is written and flushed the moment
 *     the role it describes settles. Compression is not applied to this route — a gzip
 *     stream holds bytes back until its window fills, which would deliver a run in one
 *     lump at the end and defeat the whole point.
 *
 *   · **Every event carries its sequence number as the SSE `id:` field**, which a browser
 *     sends back as `Last-Event-ID` when it reconnects. That is what lets the run buffer
 *     resume a dropped connection exactly where it stopped.
 *
 * A heartbeat comment goes out on a timer because the advocate wave can run for a minute
 * with nothing to say, and an idle connection is exactly what a proxy decides to close.
 */

import type { Response } from "express";
import type { RunEvent } from "./run-buffer.js";

/** How often the keep-alive comment goes out. Well inside a typical 60s proxy idle cut. */
export const HEARTBEAT_MS = 15_000;

/** How long a browser should wait before reconnecting, if it drops. */
const RETRY_MS = 3_000;

/**
 * One event as SSE text. `data:` must be one line, so the JSON is written as a single
 * line and any newline inside a model's prose is already escaped by `JSON.stringify`.
 */
export function formatEvent(event: RunEvent): string {
  return `id: ${event.seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** Where a reconnecting client says it got to. The header wins; `?from=` is the fallback. */
export function resumeFrom(lastEventId: unknown, fromQuery: unknown): number {
  for (const candidate of [lastEventId, fromQuery]) {
    const value = Number(typeof candidate === "string" ? candidate.trim() : NaN);
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return 0;
}

export interface SseConnection {
  send: (event: RunEvent) => void;
  close: () => void;
}

/** Opens the response as an event stream and keeps it alive until something closes it. */
export function openSse(res: Response): SseConnection {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    // `no-transform` is the part that matters: it asks intermediaries not to buffer or
    // re-encode, which is what would turn an incremental run into one lump.
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx-family proxies (Render's included) buffer responses unless told not to.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(`retry: ${RETRY_MS}\n\n`);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": keep-alive\n\n");
  }, HEARTBEAT_MS);
  // A heartbeat is not a reason for the process to stay alive.
  heartbeat.unref?.();

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };

  return {
    send: (event) => {
      if (!closed && !res.writableEnded) res.write(formatEvent(event));
    },
    close,
  };
}
