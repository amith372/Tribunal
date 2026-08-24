/**
 * export-theme.ts — the app's palette, written into the exported file.
 *
 * **Why the values are copied here rather than imported.** specs.md Part 2 requires the
 * exported run record to open from disk with no server and no network, so every byte of
 * its styling has to be *inside* it — there is no stylesheet to link and nothing to fetch.
 * And `web/src/styles/tokens.css` belongs to the browser build, which the server neither
 * imports nor ships. So the palette exists twice on purpose: once as the design system the
 * four screens are drawn from, and once here, as the copy that travels inside a file a
 * reader opens on their own machine a month later.
 *
 * **Two copies of a palette is a drift waiting to happen, so it is checked rather than
 * trusted.** `export-theme.test.ts` reads `tokens.css` and asserts that every token named
 * below carries the same value there. Change a colour in one place and the suite goes red
 * naming the token, which is the only reason it is safe to keep a second copy at all.
 *
 * Part 3 asks a reader to check the app's panels *against* this file. A record that looks
 * like a different product from the app that produced it invites exactly the doubt the
 * file exists to remove — so this is not decoration, it is the document's credibility.
 */

/**
 * Every token the exported document uses, keyed exactly as `tokens.css` names it.
 *
 * Only the flat values are here. The gradients `tokens.css` composes from them are
 * rebuilt in the export's own stylesheet, because a gradient is a use of the palette
 * rather than a part of it, and a CSS variable holding a gradient cannot be compared to
 * anything by a test.
 */
export const EXPORT_TOKENS: Readonly<Record<string, string>> = {
  "frame-1": "#7a5c24",
  "frame-2": "#b8944a",
  "frame-3": "#8a6a2c",
  "frame-edge": "#5e451c",

  "sheet-1": "#d9be86",
  "sheet-2": "#efe4c0",
  "sheet-3": "#f9f3dc",

  "crimson-1": "#8e1c1c",
  "crimson-2": "#5f1010",
  "crimson-3": "#3f0a0a",
  "gold-rule": "#d9b45f",

  panel: "#faf4dd",
  "panel-inset": "#f3ead0",
  "panel-stripe": "#f5edd2",
  highlight: "#f6e6b8",
  border: "#d9c9a3",
  hairline: "#e2d5b2",
  "border-strong": "#cdb987",

  ink: "#3a2a17",
  muted: "#6a5230",
  faint: "#8a7550",
  "ink-on-plate": "#fdf3d2",

  guilty: "#8e1c1c",
  acquitted: "#2c7a3e",
  gold: "#c9992f",
  "gold-deep": "#8a6510",
  "amber-text": "#8a6a1e",
  "chip-thinking-border": "#d4b978",

  "tile-border-accused": "#a5813a",
  "masthead-sub": "#e6c3a4",
  scales: "#f0c96a",
};

/** The `:root` block, exactly as the document's own stylesheet opens. */
export function rootVariables(): string {
  return Object.entries(EXPORT_TOKENS)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");
}
