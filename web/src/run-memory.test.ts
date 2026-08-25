/**
 * The per-browser archive list: order, dedupe, the cap, forgetting, and what happens when
 * the browser refuses storage.
 *
 * No jsdom here (see `vitest.config.ts` — this suite is deliberately without a DOM), so
 * `localStorage` is stood up as a small fake `Storage` for the duration of this file
 * rather than pulled in from a browser environment.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { archivedRunIds, forgetArchivedRun, rememberArchivedRun } from "./run-memory.js";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Every method throws — a browser refusing storage entirely (a private window, a policy). */
function throwingStorage(): Storage {
  const refuse = () => {
    throw new Error("storage refused");
  };
  return { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 };
}

let original: Storage;

beforeEach(() => {
  original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: fakeStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: original,
    configurable: true,
    writable: true,
  });
});

describe("rememberArchivedRun and archivedRunIds", () => {
  it("lists ids newest first", () => {
    rememberArchivedRun("run-a");
    rememberArchivedRun("run-b");
    rememberArchivedRun("run-c");
    expect(archivedRunIds()).toEqual(["run-c", "run-b", "run-a"]);
  });

  it("dedupes: remembering an id again moves it to the front rather than repeating it", () => {
    rememberArchivedRun("run-a");
    rememberArchivedRun("run-b");
    rememberArchivedRun("run-a");
    expect(archivedRunIds()).toEqual(["run-a", "run-b"]);
  });

  it("caps the list at 50, dropping the oldest", () => {
    for (let i = 0; i < 55; i++) rememberArchivedRun(`run-${i}`);

    const ids = archivedRunIds();
    expect(ids).toHaveLength(50);
    // Newest (54) first; the oldest five (0-4) fell off the end.
    expect(ids[0]).toBe("run-54");
    expect(ids.at(-1)).toBe("run-5");
    expect(ids).not.toContain("run-4");
  });

  it("starts empty", () => {
    expect(archivedRunIds()).toEqual([]);
  });
});

describe("forgetArchivedRun", () => {
  it("removes just the one id, keeping the rest in order", () => {
    rememberArchivedRun("run-a");
    rememberArchivedRun("run-b");
    rememberArchivedRun("run-c");
    forgetArchivedRun("run-b");
    expect(archivedRunIds()).toEqual(["run-c", "run-a"]);
  });

  it("is a no-op for an id that was never remembered", () => {
    rememberArchivedRun("run-a");
    forgetArchivedRun("run-never-seen");
    expect(archivedRunIds()).toEqual(["run-a"]);
  });
});

describe("a browser that refuses storage", () => {
  it("degrades to an empty list rather than throwing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: throwingStorage(),
      configurable: true,
      writable: true,
    });

    expect(() => rememberArchivedRun("run-a")).not.toThrow();
    expect(archivedRunIds()).toEqual([]);
    expect(() => forgetArchivedRun("run-a")).not.toThrow();
  });
});
