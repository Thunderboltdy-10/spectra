/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { loadSnapshotObject, retainSnapshotObject, snapshotHash } from "./artifactSnapshots";
import { fitsConvexNesting } from "../shared/convex-nesting.mjs";

const modules = import.meta.glob("./**/*.ts");

// A DOCX table cell at the artifact row's 16-level limit (LV-062). As a
// version snapshot it sits one level deeper and Convex rejects the row.
function deepSnapshot(label: string) {
  const text = { type: "text", text: label, marks: [{ type: "textStyle", attrs: { fontFamily: "Arial" } }] };
  const table = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [text] }] }] }] };
  return { title: "Bridge DOCX", content: { tiptap: { type: "doc", content: [table] } }, tags: [] };
}

it("stores a too-deep snapshot object as JSON text and loads the same verified value", async () => {
  const t = convexTest(schema, modules);
  const payload = deepSnapshot("Multitasking");
  expect(fitsConvexNesting({ payload })).toBe(false);
  const { retained, again, stored, loaded } = await t.run(async ctx => {
    const retained = await retainSnapshotObject(ctx, undefined, payload, "content_addressed");
    const again = await retainSnapshotObject(ctx, undefined, deepSnapshot("Multitasking"), "content_addressed");
    const stored = await ctx.db.query("artifactSnapshotObjects").collect();
    const loaded = await loadSnapshotObject(ctx, undefined, retained.snapshotRef);
    return { retained, again, stored, loaded };
  });
  expect(retained.snapshotRef).toBe((await snapshotHash(payload)).hash);
  expect(again).toMatchObject({ snapshotRef: retained.snapshotRef, deduplicated: true });
  expect(stored).toHaveLength(1);
  expect(stored[0].refCount).toBe(2);
  expect(fitsConvexNesting(stored[0])).toBe(true);
  expect(loaded).toEqual(payload);
});

it("keeps a shallow snapshot object inline", async () => {
  const t = convexTest(schema, modules);
  const payload = { title: "Flat", content: { blocks: [{ id: "p", text: "flat" }] }, tags: [] };
  const stored = await t.run(async ctx => {
    await retainSnapshotObject(ctx, undefined, payload, "normalized");
    return ctx.db.query("artifactSnapshotObjects").first();
  });
  expect(stored?.payload).toEqual(payload);
});
