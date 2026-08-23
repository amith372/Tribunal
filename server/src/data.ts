/**
 * data.ts — reads `data/characters.md`, `data/relations.md` and `data/judges.md` off
 * disk into typed records.
 *
 * specs.md Part 1: these three files are the *only* source of character facts. They
 * describe standing relationships; the charge sheet supplies what happened. Nothing
 * else about these characters may enter a prompt.
 *
 * They are hand-edited and are part of the graded deliverable, so a parse problem
 * fails loudly and names the file and line rather than degrading quietly.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class DataError extends Error {
  constructor(message: string, file?: string, line?: number) {
    super(file ? `${file}${line ? `:${line}` : ""} — ${message}` : message);
    this.name = "DataError";
  }
}

export interface Character {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface Judge {
  readonly id: string;
  readonly name: string;
  readonly persona: string;
}

export interface Relation {
  readonly a: string;
  readonly b: string;
  readonly text: string;
}

export interface TribunalData {
  readonly characters: readonly Character[];
  readonly judges: readonly Judge[];
  readonly relations: readonly Relation[];
  readonly dataDir: string;
  getCharacter(id: string): Character | undefined;
  getJudge(id: string): Judge | undefined;
  /** Order-independent: entries are `a ↔ b`, so either direction must find the pair. */
  getRelation(one: string, other: string): Relation | undefined;
  /** Character id to avatar asset key — the art is named `idle_jon`, not `idle_jon-snow`. */
  assetKey(id: string): string;
}

/**
 * The 2-for/2-against split arithmetic depends on there being exactly five characters
 * and three judges, so both counts are asserted rather than assumed.
 */
const EXPECTED_CHARACTERS = 5;
const EXPECTED_JUDGES = 3;

/** Character id to avatar asset key. Two ids differ from their art filenames. */
const ASSET_KEYS: Record<string, string> = {
  "jon-snow": "jon",
  daenerys: "daenerys",
  tyrion: "tyrion",
  "grey-worm": "worm",
  cersei: "cersei",
};

/**
 * Finds `data/` by walking up from this module. The server runs from `server/src` in
 * development and `server/dist` in production, and the data files sit at the repo
 * root in both cases.
 */
export function findDataDir(): string {
  const override = process.env.TRIBUNAL_DATA_DIR?.trim();
  if (override) {
    const dir = resolve(override);
    if (!existsSync(join(dir, "characters.md"))) {
      throw new DataError(`TRIBUNAL_DATA_DIR is set to "${dir}" but has no characters.md.`);
    }
    return dir;
  }

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, "data");
    if (existsSync(join(candidate, "characters.md"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new DataError(
    "Could not find the data/ directory (looked for data/characters.md above " +
      `${dirname(fileURLToPath(import.meta.url))}). Set TRIBUNAL_DATA_DIR to point at it.`,
  );
}

interface Block {
  readonly heading: string;
  readonly headingLine: number;
  readonly fields: ReadonlyMap<string, { value: string; line: number }>;
}

/**
 * Both `characters.md` and `judges.md` share one shape: `## Display Name` followed by
 * `- key: value` lines. Parsed once here so the two loaders stay short and a format
 * change is a single edit.
 */
function parseBlocks(text: string, file: string): Block[] {
  const blocks: Block[] = [];
  let current: { heading: string; headingLine: number; fields: Map<string, { value: string; line: number }> } | null =
    null;

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (line.startsWith("## ")) {
      if (current) blocks.push(current);
      current = { heading: line.slice(3).trim(), headingLine: lineNo, fields: new Map() };
      return;
    }
    if (!line.startsWith("- ")) return;

    const body = line.slice(2);
    const colon = body.indexOf(":");
    if (colon === -1) {
      throw new DataError(`Expected a "- key: value" line, got "${line}".`, file, lineNo);
    }
    if (!current) {
      throw new DataError(`Field "${body.slice(0, colon)}" appears before any "## " heading.`, file, lineNo);
    }
    current.fields.set(body.slice(0, colon).trim().toLowerCase(), {
      value: body.slice(colon + 1).trim(),
      line: lineNo,
    });
  });

  if (current) blocks.push(current);
  return blocks;
}

function requireField(block: Block, key: string, file: string): string {
  const field = block.fields.get(key);
  if (!field || field.value.length === 0) {
    throw new DataError(`"${block.heading}" is missing a non-empty "${key}:" line.`, file, block.headingLine);
  }
  return field.value;
}

function parseCharacters(text: string, file: string): Character[] {
  const characters = parseBlocks(text, file).map((block) => ({
    id: requireField(block, "id", file),
    name: block.heading,
    description: requireField(block, "description", file),
  }));

  if (characters.length !== EXPECTED_CHARACTERS) {
    throw new DataError(
      `Expected exactly ${EXPECTED_CHARACTERS} characters, found ${characters.length}. ` +
        "The two-for/two-against split assumes five, so a sixth would silently break casting.",
      file,
    );
  }
  assertUniqueIds(characters, file, "character");
  return characters;
}

function parseJudges(text: string, file: string): Judge[] {
  const judges = parseBlocks(text, file).map((block) => ({
    id: requireField(block, "id", file),
    name: block.heading,
    persona: requireField(block, "persona", file),
  }));

  if (judges.length !== EXPECTED_JUDGES) {
    throw new DataError(
      `Expected exactly ${EXPECTED_JUDGES} judges, found ${judges.length}. ` +
        "Majority aggregation assumes three.",
      file,
    );
  }
  assertUniqueIds(judges, file, "judge");
  return judges;
}

function assertUniqueIds(items: readonly { id: string }[], file: string, kind: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new DataError(`Duplicate ${kind} id "${item.id}".`, file);
    seen.add(item.id);
  }
}

/** Entries are `- a ↔ b: text`. The separator is `↔` because relations are mutual. */
function parseRelations(text: string, file: string, characterIds: readonly string[]): Relation[] {
  const known = new Set(characterIds);
  const relations: Relation[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (!line.startsWith("- ")) return;

    const body = line.slice(2);
    const colon = body.indexOf(":");
    if (colon === -1) {
      throw new DataError(`Expected "- id ↔ id: text", got "${line}".`, file, lineNo);
    }
    const pair = body.slice(0, colon).split("↔").map((part) => part.trim());
    if (pair.length !== 2 || !pair[0] || !pair[1]) {
      throw new DataError(`Expected exactly one "↔" between two ids, got "${body.slice(0, colon)}".`, file, lineNo);
    }
    const [a, b] = pair as [string, string];
    for (const id of [a, b]) {
      if (!known.has(id)) {
        throw new DataError(`Unknown character id "${id}" (not in characters.md).`, file, lineNo);
      }
    }
    const relationText = body.slice(colon + 1).trim();
    if (!relationText) throw new DataError(`Relation "${a} ↔ ${b}" has no text.`, file, lineNo);
    relations.push({ a, b, text: relationText });
  });

  assertEveryPairCovered(relations, characterIds, file);
  return relations;
}

/**
 * Every advocate prompt carries the advocate's relation to the defendant, so a missing
 * pair would silently drop context from one statement. Checked here instead.
 */
function assertEveryPairCovered(
  relations: readonly Relation[],
  characterIds: readonly string[],
  file: string,
): void {
  const key = (x: string, y: string) => [x, y].sort().join("|");
  const have = new Map<string, number>();
  for (const relation of relations) {
    const k = key(relation.a, relation.b);
    have.set(k, (have.get(k) ?? 0) + 1);
  }

  const missing: string[] = [];
  for (let i = 0; i < characterIds.length; i++) {
    for (let j = i + 1; j < characterIds.length; j++) {
      const a = characterIds[i];
      const b = characterIds[j];
      const count = have.get(key(a, b)) ?? 0;
      if (count === 0) missing.push(`${a} ↔ ${b}`);
      if (count > 1) throw new DataError(`Relation "${a} ↔ ${b}" is defined ${count} times.`, file);
    }
  }
  if (missing.length > 0) {
    throw new DataError(`Missing relations: ${missing.join(", ")}.`, file);
  }
}

function readOrThrow(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new DataError(`Could not read ${path}.`);
  }
}

/** Reads and validates all three files. Throws a `DataError` naming file and line. */
export function loadData(dataDir: string = findDataDir()): TribunalData {
  const charactersFile = join(dataDir, "characters.md");
  const judgesFile = join(dataDir, "judges.md");
  const relationsFile = join(dataDir, "relations.md");

  const characters = parseCharacters(readOrThrow(charactersFile), "data/characters.md");
  const judges = parseJudges(readOrThrow(judgesFile), "data/judges.md");
  const relations = parseRelations(
    readOrThrow(relationsFile),
    "data/relations.md",
    characters.map((c) => c.id),
  );

  for (const character of characters) {
    if (!ASSET_KEYS[character.id]) {
      throw new DataError(
        `Character "${character.id}" has no avatar asset key. Add one to ASSET_KEYS in server/src/data.ts.`,
        "data/characters.md",
      );
    }
  }

  return {
    characters,
    judges,
    relations,
    dataDir,
    getCharacter: (id) => characters.find((c) => c.id === id),
    getJudge: (id) => judges.find((j) => j.id === id),
    getRelation: (one, other) =>
      relations.find(
        (r) => (r.a === one && r.b === other) || (r.a === other && r.b === one),
      ),
    assetKey: (id) => {
      const key = ASSET_KEYS[id];
      if (!key) throw new DataError(`No avatar asset key for character id "${id}".`);
      return key;
    },
  };
}
