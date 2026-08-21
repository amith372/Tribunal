/**
 * optimize-images.ts — turns the 17 hand-drawn avatar PNGs into web-sized WebP.
 *
 * The originals live outside the repo (~65 MB, several of them 5–6 MB each) and stay
 * there: committing them would put a 65 MB payload in a school project's history to
 * serve images the browser only ever sees at a few hundred pixels. Only the WebP output
 * is committed, at roughly 1–2 MB for the set.
 *
 * **It fails loudly on a missing file rather than writing a partial set.** The avatar
 * names are derived from `data.ts` — the same `assetKey` mapping the app uses to find
 * them at runtime — so a character in `characters.md` with no artwork is caught here,
 * at build time, instead of as a broken image during a demo. Every expected name is
 * checked before a single file is written.
 *
 * Run it with:  npm run images:optimize
 *
 * Source directory: `TRIBUNAL_AVATAR_SRC`, or the first argument, or the default below.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { loadData } from "../server/src/data.js";

/** Where the originals live. Outside the repo on purpose. */
const DEFAULT_SOURCE = "C:/Users/Amit_PC/Downloads/Tribunal";

/**
 * The longest edge, in pixels. The avatars are displayed as tiles a few hundred pixels
 * across at most, and 512 leaves headroom for a high-density screen without carrying a
 * print-resolution image to every visitor.
 */
const MAX_EDGE = 512;

/**
 * WebP quality. 82 is the point where this particular art — flat colour, soft shading,
 * no fine texture — stops losing anything visible. Worth re-checking by eye rather than
 * trusting: the gate for this stage is looking at all 17.
 */
const QUALITY = 82;

/** The three states each character's avatar is drawn in (specs.md Part 1). */
const STATES = ["idle", "thinking", "happy"] as const;

/** The bench's two loader frames, which belong to no character. */
const STANDALONE = ["judge", "undone_judge"] as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outputDir = join(repoRoot, "web", "public", "avatars");

const sourceDir = resolve(
  process.argv[2] ?? process.env.TRIBUNAL_AVATAR_SRC ?? DEFAULT_SOURCE,
);

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Every filename this build expects, derived from the character roster rather than
 * listed by hand — a sixth character added to `characters.md` becomes a missing-artwork
 * error here instead of a blank tile later.
 */
function expectedNames(): string[] {
  const data = loadData();
  const names = data.characters.flatMap((character) =>
    STATES.map((state) => `${state}_${data.assetKey(character.id)}`),
  );
  return [...names, ...STANDALONE];
}

async function main(): Promise<void> {
  console.log("\nThe Tribunal — avatar optimisation");
  console.log(`  from: ${sourceDir}`);
  console.log(`  to:   ${outputDir}`);
  console.log(`  ${MAX_EDGE}px longest edge, WebP quality ${QUALITY}, never enlarged\n`);

  if (!existsSync(sourceDir)) {
    console.error(
      `Could not find the source directory:\n  ${sourceDir}\n\n` +
        "Pass it as an argument or set TRIBUNAL_AVATAR_SRC.",
    );
    process.exit(1);
  }

  const expected = expectedNames();
  const missing = expected.filter((name) => !existsSync(join(sourceDir, `${name}.png`)));
  if (missing.length > 0) {
    console.error(
      `Missing artwork for: ${missing.join(", ")}.\n` +
        `Looked for ${missing.map((name) => `${name}.png`).join(", ")} in ${sourceDir}.\n` +
        "Nothing was written — fix the source directory and run again.",
    );
    process.exit(1);
  }

  // Anything in the folder that is not on the list is reported, not silently skipped:
  // a renamed file would otherwise vanish without a word.
  const strays = readdirSync(sourceDir)
    .filter((file) => file.toLowerCase().endsWith(".png"))
    .map((file) => file.replace(/\.png$/i, ""))
    .filter((name) => !expected.includes(name));
  if (strays.length > 0) {
    console.log(`Note: ignoring ${strays.length} PNG not on the list — ${strays.join(", ")}.\n`);
  }

  mkdirSync(outputDir, { recursive: true });

  console.log(`${"Avatar".padEnd(22)} ${"Before".padStart(9)} ${"After".padStart(9)}   Size`);
  console.log(`${"─".repeat(22)} ${"─".repeat(9)} ${"─".repeat(9)}   ${"─".repeat(11)}`);

  // Converted in parallel, but reported in list order — the table is read by a person
  // checking all seventeen, so it should not reshuffle itself by whichever finished first.
  const rows = await Promise.all(
    expected.map(async (name) => {
      const from = join(sourceDir, `${name}.png`);
      const info = await sharp(from)
        .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(join(outputDir, `${name}.webp`));

      return { name, before: statSync(from).size, after: info.size, width: info.width, height: info.height };
    }),
  );

  for (const row of rows) {
    console.log(
      `${row.name.padEnd(22)} ${kb(row.before).padStart(9)} ${kb(row.after).padStart(9)}   ` +
        `${row.width}×${row.height}`,
    );
  }

  const before = rows.reduce((sum, row) => sum + row.before, 0);
  const after = rows.reduce((sum, row) => sum + row.after, 0);

  console.log(
    `\n${rows.length} avatars — ${mb(before)} in, ${mb(after)} out ` +
      `(${(100 - (after / before) * 100).toFixed(1)}% smaller).`,
  );
  console.log("Only the WebP is committed; the originals stay where they are.\n");
}

main().catch((error: unknown) => {
  console.error(`\nFailed: ${(error as Error).message}\n`);
  process.exit(1);
});
