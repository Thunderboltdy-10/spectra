import { describe, expect, it } from "vitest";
import { coalesceInFlight } from "@/lib/coalesce-inflight";

describe("coalesceInFlight", () => {
  it("shares one in-flight promise for the same key inside the ttl", async () => {
    const map = new Map();
    let starts = 0;
    const start = () => {
      starts += 1;
      return Promise.resolve(starts);
    };
    const first = coalesceInFlight(map, "threads", 1_100, start);
    const second = coalesceInFlight(map, "threads", 1_100, start);
    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    expect(starts).toBe(1);
  });

  it("starts a new request after force or a different key", async () => {
    const map = new Map();
    let starts = 0;
    const start = () => Promise.resolve((starts += 1));
    await coalesceInFlight(map, "a", 1_100, start);
    await coalesceInFlight(map, "b", 1_100, start);
    await coalesceInFlight(map, "a", 1_100, start, { force: true });
    expect(starts).toBe(3);
  });
});
