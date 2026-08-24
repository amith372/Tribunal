/**
 * embed-font.ts — fetches the display face the exported run record carries with it.
 *
 * **Why the export embeds a font at all.** specs.md Part 2 requires the exported file to
 * open from disk with no server and no network, and Part 3 requires it to look like the
 * app that produced it — a reader is asked to check the panels against this file, and a
 * record that looks like a different product invites exactly the doubt it exists to
 * remove. The app's two faces are both served from a font host the file cannot reach, so
 * one of them has to travel inside it. The decision (logged 2026-08-23) is to embed the
 * *display* face — Cinzel, which carries the wordmark, the headings and the verdicts —
 * and to let the reading text fall back to whatever old-style serif the machine has. The
 * verdict is the thing a reader looks at, so the verdict is the thing that matches.
 *
 * **One weight, and it is declared across the whole range.** Cinzel is fetched at 600,
 * the weight `tokens.css` gives every heading, and the generated `@font-face` claims
 * `font-weight: 400 700` so the browser uses this one file wherever the document asks for
 * Cinzel rather than synthesising a bolder or lighter version of it. A second weight would
 * roughly double what every exported file carries forever, to make a distinction the
 * document does not draw.
 *
 * **Subset, not the whole face.** Only the characters this document actually prints. The
 * body text is fallback, so the set is the printable Latin the headings and the names in
 * `data/` can contain — 12 KB rather than 26, on every exported file. A glyph outside the
 * set is not a broken document: the browser simply draws that one character from the
 * fallback stack.
 *
 * Run it with:  npm run font:embed
 *
 * The output — `server/src/export-font.ts` — is committed, so a normal build and a normal
 * clone need no network. Re-run this only to change the weight or the character set.
 */

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Google's CSS API serves the modern format only when it believes it is a modern browser. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

const FAMILY = "Cinzel";
const WEIGHT = 600;

/**
 * What the document prints, as a character set.
 *
 * Printable ASCII covers the headings, the verdict words and the model identifiers, and
 * the few beyond it are the marks this app's own prose uses — the middot that separates
 * every meta line, the en dash in a tally, the em dash, curly quotes. The accented Latin
 * at the end is insurance: character and judge names are read from hand-edited files in
 * `data/`, and a name gaining an accent should not silently lose its typeface.
 */
const CHARSET =
  Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join("") +
  "·–—‘’“”…" +
  "àáäèéêíñóöü";

/**
 * The notice that travels with the file.
 *
 * Cinzel is under the SIL Open Font License, which asks that the copyright and the licence
 * be carried with the font wherever it goes — and this font goes wherever an exported run
 * record goes. Deliberately written without a URL: the export's tests assert the file
 * contains no `http` link at all, since anything that looks fetchable is the opposite of
 * what "opens from disk with no network" promises.
 */
const NOTICE =
  "Cinzel, (c) The Cinzel Project Authors. Licensed under the SIL Open Font License, " +
  "Version 1.1. Subset to the characters this document prints.";

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.text();
}

async function main(): Promise<void> {
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${FAMILY}:wght@${WEIGHT}` +
    `&text=${encodeURIComponent(CHARSET)}`;

  console.log(`  fetching the ${FAMILY} ${WEIGHT} subset…`);
  const css = await fetchText(cssUrl);

  // The CSS names exactly one file when a `text=` subset is requested. Anything else means
  // Google answered with the full family, which is not what this script is for.
  const urls = [...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);
  if (urls.length !== 1) {
    throw new Error(
      `Expected one font file in the subset stylesheet, got ${urls.length}. ` +
        "Google may have changed its response; check the CSS by hand before trusting this.",
    );
  }

  const response = await fetch(urls[0], { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`the font file answered HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.subarray(0, 4).toString("latin1") !== "wOF2") {
    throw new Error("that is not a WOFF2 file — refusing to embed it.");
  }

  const base64 = bytes.toString("base64");
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(join(here, "..", "server", "src", "export-font.ts"));

  writeFileSync(
    out,
    `/**
 * export-font.ts — generated by \`npm run font:embed\`. Do not edit by hand.
 *
 * The display face the exported run record carries inside itself, so that a file opened
 * from disk with no network still shows its verdict in the app's own type (specs.md
 * Part 3). ${FAMILY} at ${WEIGHT}, subsetted to the characters the document prints;
 * see \`scripts/embed-font.ts\` for the reasoning and the character set.
 *
 * ${(bytes.length / 1024).toFixed(1)} KB of font, ${(base64.length / 1024).toFixed(1)} KB
 * as base64 — the whole of what embedding costs an exported file.
 */

/** Carried into every exported file, because the licence travels with the font. */
export const FONT_NOTICE =
  ${JSON.stringify(NOTICE)};

/** The family name the export's CSS asks for. */
export const FONT_FAMILY = ${JSON.stringify(FAMILY)};

/** WOFF2, base64. One line, because a wrapped literal would only be harder to diff. */
export const FONT_WOFF2_BASE64 =
  "${base64}";
`,
    "utf8",
  );

  console.log(`  wrote ${out}`);
  console.log(`  ${(bytes.length / 1024).toFixed(1)} KB woff2 → ${(base64.length / 1024).toFixed(1)} KB base64`);
}

main().catch((error: unknown) => {
  console.error(`\n  embed-font failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
