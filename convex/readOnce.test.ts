import { describe, expect, it, vi } from "vitest";
import { readOnceDb, withReadOnce } from "./readOnce";

function fakeDb(rows: Record<string, Record<string, unknown>>) {
  return {
    get: vi.fn(async (...args: unknown[]) => {
      const row = rows[String(args[args.length - 1])];
      return row ? { ...row } : null;
    }),
    normalizeId: vi.fn(),
    query: vi.fn(),
    system: {},
    insert: vi.fn(async () => "new"),
    patch: vi.fn(async (...args: unknown[]) => {
      const id = String(args[args.length - 2]);
      rows[id] = { ...rows[id], ...(args[args.length - 1] as object) };
    }),
    replace: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
}

describe("reading each document once", () => {
  it("answers repeat and concurrent reads from the first", async () => {
    const inner = fakeDb({ a: { _id: "a", title: "One" } });
    const { db } = readOnceDb(inner);
    const [first, second] = await Promise.all([db.get("a" as never), db.get("a" as never)]);
    await db.get("table" as never, "a" as never);
    expect(first).toEqual(second);
    expect(inner.get).toHaveBeenCalledTimes(1);
  });

  it("keeps what it remembers current with a patch, without reading again", async () => {
    const inner = fakeDb({ a: { _id: "a", title: "One", gone: 1 } });
    const { db } = readOnceDb(inner);
    await db.get("a" as never);
    await db.patch("a" as never, { title: "Two", gone: undefined } as never);
    expect(await db.get("a" as never)).toEqual({ _id: "a", title: "Two" });
    expect(inner.get).toHaveBeenCalledTimes(1);
  });

  it("keeps its identity through a replace and forgets nothing on a delete", async () => {
    const inner = fakeDb({ a: { _id: "a", _creationTime: 5, title: "One" } });
    const { db } = readOnceDb(inner);
    await db.get("a" as never);
    await (db as unknown as { replace(id: string, value: object): Promise<void> }).replace("a", { title: "New" });
    expect(await db.get("a" as never)).toEqual({ _id: "a", _creationTime: 5, title: "New" });
    await (db as unknown as { delete(id: string): Promise<void> }).delete("a");
    expect(await db.get("a" as never)).toBeNull();
    expect(inner.get).toHaveBeenCalledTimes(1);
  });

  it("gives each caller its own copy", async () => {
    const { db } = readOnceDb(fakeDb({ a: { _id: "a", title: "One" } }));
    const read = (await db.get("a" as never)) as unknown as Record<string, unknown>;
    read.title = "Changed by the caller";
    expect(await db.get("a" as never)).toEqual({ _id: "a", title: "One" });
  });

  it("reads again after a nested mutation", async () => {
    const inner = fakeDb({ a: { _id: "a", title: "One" } });
    const ctx = withReadOnce({ db: inner, runMutation: async () => "done" as unknown });
    await (ctx.db as unknown as { get(id: string): Promise<unknown> }).get("a");
    await (ctx.runMutation as () => Promise<unknown>)();
    await (ctx.db as unknown as { get(id: string): Promise<unknown> }).get("a");
    expect(inner.get).toHaveBeenCalledTimes(2);
  });
});
