/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { CATALOG_MIGRATION_KEY } from "./catalogPages";
import { ARTIFACT_SUMMARY_READ_MODEL_VERSION } from "./orgTreeShared";

const modules = import.meta.glob("./**/*.ts");
const setup = () => convexTest(schema, modules);

async function migration(t: ReturnType<typeof setup>) {
  return t.run((ctx) =>
    ctx.db.query("spectraReadModelMigrations").withIndex("by_key", (q) => q.eq("key", CATALOG_MIGRATION_KEY)).unique(),
  );
}

describe("catalog summary backfill runs by itself", () => {
  it("completes on a deployment where it never ran", async () => {
    vi.useFakeTimers();
    const t = setup();
    expect(await migration(t)).toBeNull();
    await t.mutation(internal.spectraArtifacts.continueSummaryBackfill, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const done = await migration(t);
    expect(done?.state).toBe("complete");
    expect(done?.version).toBe(ARTIFACT_SUMMARY_READ_MODEL_VERSION);
    vi.useRealTimers();
  });

  it("starts over when the read model moved to a new version, and does nothing once current", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("spectraReadModelMigrations", {
        key: CATALOG_MIGRATION_KEY,
        version: ARTIFACT_SUMMARY_READ_MODEL_VERSION - 1,
        state: "complete",
        scanned: 0,
        repaired: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.mutation(internal.spectraArtifacts.continueSummaryBackfill, {});
    const upgraded = await migration(t);
    expect(upgraded?.version).toBe(ARTIFACT_SUMMARY_READ_MODEL_VERSION);
    expect(upgraded?.state).toBe("complete");
    const before = upgraded?.updatedAt;
    expect(await t.mutation(internal.spectraArtifacts.continueSummaryBackfill, {})).toEqual({ done: true });
    expect((await migration(t))?.updatedAt).toBe(before);
  });
});
