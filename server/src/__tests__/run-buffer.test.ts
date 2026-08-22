/**
 * The reconnect buffer. Zero model calls — this is a data structure.
 *
 * What is worth asserting is not that it stores things but that it holds the two
 * properties specs.md Part 3 asks of it: a browser that lets go can be sent exactly what
 * it missed and nothing twice, and the thing doing that is a buffer rather than a store —
 * it forgets, it is bounded, and there is no way to ask it what runs it has.
 */

import { describe, expect, it } from "vitest";

import { RunBuffer, type RunEvent } from "../run-buffer.js";

/** A clock the test drives, so the hold can be tested without waiting ten minutes. */
function fakeClock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

const collect = () => {
  const seen: RunEvent[] = [];
  return { seen, listener: (event: RunEvent) => seen.push(event) };
};

describe("recording and following a run", () => {
  it("numbers events from 1, without gaps, in the order they were pushed", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();

    buffer.push(id, "preflight", { a: 1 });
    buffer.push(id, "statement", { b: 2 });
    buffer.close(id, "done", { c: 3 });

    const run = buffer.get(id);
    expect(run?.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(run?.events.map((event) => event.event)).toEqual(["preflight", "statement", "done"]);
  });

  it("sends live events to a subscriber as they are pushed", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();
    const { seen, listener } = collect();

    buffer.subscribe(id, 0, listener);
    buffer.push(id, "preflight", {});
    buffer.push(id, "statement", { name: "Tyrion" });

    expect(seen.map((event) => event.event)).toEqual(["preflight", "statement"]);
  });

  it("records an event before sending it, so nothing is live-only", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();
    let atFireTime = -1;

    buffer.subscribe(id, 0, () => {
      atFireTime = buffer.get(id)?.events.length ?? -1;
    });
    buffer.push(id, "statement", {});

    // The event is already in the buffer while the listener is being told about it — a
    // connection that dies mid-notify cannot take the only copy with it.
    expect(atFireTime).toBe(1);
  });

  it("seals a run at `done`, so nothing can be appended behind the record", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();

    buffer.close(id, "done", {});
    expect(buffer.push(id, "statement", { late: true })).toBeNull();
    expect(buffer.get(id)?.events).toHaveLength(1);
  });
});

describe("a browser that let go and came back", () => {
  it("replays only what the reconnecting client had not seen", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();
    buffer.push(id, "preflight", {});
    buffer.push(id, "statement", { n: 1 });
    buffer.push(id, "statement", { n: 2 });

    const { seen, listener } = collect();
    buffer.subscribe(id, 2, listener);

    expect(seen.map((event) => event.seq)).toEqual([3]);
  });

  it("replays everything for a client that starts from nothing", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();
    buffer.push(id, "preflight", {});
    buffer.push(id, "statement", {});

    const { seen, listener } = collect();
    buffer.subscribe(id, 0, listener);

    expect(seen.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("continues live after the replay, with no event sent twice", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();
    buffer.push(id, "preflight", {});

    const { seen, listener } = collect();
    buffer.subscribe(id, 0, listener);
    buffer.push(id, "statement", {});
    buffer.close(id, "done", {});

    expect(seen.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it("still hands a finished run over in full — the whole point of holding it", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();
    buffer.push(id, "preflight", {});
    buffer.close(id, "done", { record: "here" });

    const { seen, listener } = collect();
    expect(buffer.subscribe(id, 0, listener)).not.toBeNull();
    expect(seen.map((event) => event.event)).toEqual(["preflight", "done"]);
  });

  it("stops sending to a connection that unsubscribed", () => {
    const buffer = new RunBuffer();
    const id = buffer.open();
    const { seen, listener } = collect();

    const unsubscribe = buffer.subscribe(id, 0, listener);
    buffer.push(id, "preflight", {});
    unsubscribe?.();
    buffer.push(id, "statement", {});

    // The run went on regardless; only the delivery stopped.
    expect(seen).toHaveLength(1);
    expect(buffer.get(id)?.events).toHaveLength(2);
  });
});

describe("a buffer, not a store", () => {
  it("forgets a finished run once its hold has passed", () => {
    const clock = fakeClock();
    const buffer = new RunBuffer(1000, 20, clock.now);
    const id = buffer.open();
    buffer.close(id, "done", {});

    clock.advance(999);
    expect(buffer.get(id)).not.toBeNull();
    clock.advance(2);
    expect(buffer.get(id)).toBeNull();
    expect(buffer.subscribe(id, 0, () => {})).toBeNull();
  });

  it("keeps a run in flight however long it takes — the hold starts when it ends", () => {
    const clock = fakeClock();
    const buffer = new RunBuffer(1000, 20, clock.now);
    const id = buffer.open();

    clock.advance(1_000_000);
    expect(buffer.get(id)).not.toBeNull();
  });

  it("drops the oldest run rather than growing without bound", () => {
    const buffer = new RunBuffer(1000, 3);
    const ids = [buffer.open(), buffer.open(), buffer.open(), buffer.open()];

    expect(buffer.get(ids[0] as string)).toBeNull();
    expect(buffer.get(ids[3] as string)).not.toBeNull();
    expect(buffer.size()).toBe(3);
  });

  it("has no way to reach a run except by its own identifier", () => {
    const buffer = new RunBuffer();
    buffer.open();
    buffer.open();

    // `size` is a count for `/api/health` and nothing more: there is no listing, no
    // search, and no iteration over held runs anywhere in the type.
    expect(buffer.size()).toBe(2);
    expect(Object.keys(RunBuffer.prototype).filter((key) => key.startsWith("list"))).toEqual([]);
    expect(buffer.get("not-a-real-id")).toBeNull();
  });

  it("gives every run an unguessable identifier", () => {
    const buffer = new RunBuffer();
    const a = buffer.open();
    const b = buffer.open();

    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
