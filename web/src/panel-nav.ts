/**
 * panel-nav.ts — moving between the five result panels.
 *
 * This is the one thing the old `results-model.ts` did that was genuinely the browser's
 * business. Everything else in that file was *what a run says*, which the server decides
 * and the exported file has to word identically — so it now lives in `server/src/summary.ts`
 * and the browser reads it through the `@record` alias.
 *
 * Which panel is on screen is not part of the record. A file has no current panel, and a
 * reader of the export scrolls rather than steps. So it stays here.
 */

import { PANELS } from "@record/summary.js";

/**
 * The next panel index, clamped rather than wrapped.
 *
 * Wrapping would let the last panel's forward arrow land on the first, which reads as the
 * run starting over — the five sections are an order, not a carousel.
 */
export function stepPanel(current: number, by: number): number {
  return Math.max(0, Math.min(PANELS.length - 1, current + by));
}
