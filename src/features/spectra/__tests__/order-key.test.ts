import { describe, expect, it } from "vitest";
import {
  FIRST_ORDER_KEY,
  between,
  compareOrderKeys,
  isOrderKey,
  nextOrderKey,
  normalizeOrderKey,
  orderKeysBetween,
  sequentialOrderKeys,
} from "../organization/order-key";

describe("order keys", () => {
  it("starts mid-range so both ends stay extendable", () => {
    expect(isOrderKey(FIRST_ORDER_KEY)).toBe(true);
    expect(between(null, FIRST_ORDER_KEY) < FIRST_ORDER_KEY).toBe(true);
    expect(between(FIRST_ORDER_KEY, null) > FIRST_ORDER_KEY).toBe(true);
  });

  it("returns a key strictly between two neighbours", () => {
    const a = FIRST_ORDER_KEY;
    const b = nextOrderKey(a);
    const middle = between(a, b);
    expect(a < middle).toBe(true);
    expect(middle < b).toBe(true);
    expect(isOrderKey(middle)).toBe(true);
  });

  it("survives repeated splitting at the same seam", () => {
    let low = FIRST_ORDER_KEY;
    let high = nextOrderKey(low);
    for (let index = 0; index < 200; index += 1) {
      const middle = between(low, high);
      expect(low < middle && middle < high).toBe(true);
      expect(isOrderKey(middle)).toBe(true);
      // Alternate which side we squeeze so both descent paths get exercised.
      if (index % 2 === 0) high = middle;
      else low = middle;
    }
  });

  it("keeps append order stable over many appends", () => {
    const keys: string[] = [];
    let previous: string | null = null;
    for (let index = 0; index < 500; index += 1) {
      previous = nextOrderKey(previous);
      keys.push(previous);
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps prepend order stable over many prepends", () => {
    const keys: string[] = [];
    let first: string | null = FIRST_ORDER_KEY;
    for (let index = 0; index < 500; index += 1) {
      first = between(null, first);
      keys.unshift(first);
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never produces a key that blocks its own lower neighbour", () => {
    let key: string | null = null;
    for (let index = 0; index < 300; index += 1) {
      key = nextOrderKey(key);
      expect(key.endsWith("0")).toBe(false);
      expect(between(null, key) < key).toBe(true);
    }
  });

  it("orders a batch of siblings dropped into one gap", () => {
    const low = FIRST_ORDER_KEY;
    const high = nextOrderKey(low);
    const keys = orderKeysBetween(low, high, 7);
    expect(keys).toHaveLength(7);
    expect([...keys].sort()).toEqual(keys);
    expect(low < keys[0]!).toBe(true);
    expect(keys[6]! < high).toBe(true);
  });

  it("orders a batch dropped at either open end", () => {
    const head = orderKeysBetween(null, FIRST_ORDER_KEY, 3);
    expect([...head].sort()).toEqual(head);
    expect(head[2]! < FIRST_ORDER_KEY).toBe(true);
    const tail = orderKeysBetween(FIRST_ORDER_KEY, null, 3);
    expect([...tail].sort()).toEqual(tail);
    expect(FIRST_ORDER_KEY < tail[0]!).toBe(true);
  });

  it("rejects reversed or invalid neighbours", () => {
    const a = FIRST_ORDER_KEY;
    const b = nextOrderKey(a);
    expect(() => between(b, a)).toThrow(/out of sequence/);
    expect(() => between(a, a)).toThrow(/out of sequence/);
    expect(() => between("!!", null)).toThrow(/Invalid order key/);
    expect(() => between(null, "A0")).toThrow(/Invalid order key/);
    expect(() => orderKeysBetween(null, null, 0)).toThrow(/count/);
  });

  it("validates keys", () => {
    expect(isOrderKey("V")).toBe(true);
    expect(isOrderKey("")).toBe(false);
    expect(isOrderKey("A0")).toBe(false); // trailing lowest digit
    expect(isOrderKey("a-b")).toBe(false);
    expect(isOrderKey(42)).toBe(false);
    expect(isOrderKey("V".repeat(400))).toBe(false);
  });

  it("normalizes legacy values instead of trusting them", () => {
    expect(normalizeOrderKey(" V ")).toBe("V");
    expect(normalizeOrderKey("A0")).toBe("A");
    expect(normalizeOrderKey("000")).toBe(null);
    expect(normalizeOrderKey(undefined)).toBe(null);
  });

  it("rebuilds an evenly ordered sibling list", () => {
    const keys = sequentialOrderKeys(50);
    expect(keys).toHaveLength(50);
    expect([...keys].sort()).toEqual(keys);
    expect(sequentialOrderKeys(0)).toEqual([]);
  });

  it("compares keys the same way the database sorts them", () => {
    const keys = sequentialOrderKeys(30);
    const shuffled = [...keys].reverse();
    expect([...shuffled].sort(compareOrderKeys)).toEqual(keys);
  });

  it("stays short enough for an index under realistic churn", () => {
    // Worst realistic case: always inserting right after the same node.
    let low = FIRST_ORDER_KEY;
    const high = nextOrderKey(low);
    for (let index = 0; index < 100; index += 1) low = between(low, high);
    expect(low.length).toBeLessThan(120);
  });
});
