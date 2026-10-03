import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollaborationGatewayBridgeClient } from "./collaboration-gateway-bridge-client.mjs";
import { convexNestingDepth, fitsConvexNesting, inlineContentFitsNesting } from "../shared/convex-nesting.mjs";
import {
  fitChangeGroupSnapshots, resolveCommitSnapshotStrategy,
} from "../shared/collaboration-change-group-capacity";

// The live DOCX that crashed the gateway (LV-062): a table cell whose styled
// text sits exactly at Convex's 16-level limit on the artifact row, so any row
// that embeds the snapshot one level deeper was rejected with a document dump.
function docxContentWithTable() {
  const text = { type: "text", text: "Multitasking", marks: [{ type: "textStyle", attrs: { fontFamily: "Arial" } }] };
  const cell = { type: "tableCell", content: [{ type: "paragraph", content: [text] }] };
  return {
    blocks: [{ id: "docx:table:1", type: "table" }],
    tiptap: { type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [cell] }] }] },
  };
}
const snapshot = content => ({ title: "Bridge DOCX", summary: "42 KB", content, tags: [] });

describe("Convex nesting budget for artifact content", () => {
  it("counts the row as level 1, so the artifact row fits and a change group does not", () => {
    const content = docxContentWithTable();
    expect(convexNestingDepth(content)).toBe(15);
    expect(fitsConvexNesting({ title: "row", content })).toBe(true);
    expect(fitsConvexNesting({ baseSnapshot: snapshot(content), finalSnapshot: snapshot(content) })).toBe(false);
    expect(inlineContentFitsNesting(content)).toBe(false);
    expect(inlineContentFitsNesting({ blocks: [{ id: "p", text: "flat" }] })).toBe(true);
  });

  it("omits too-deep change group snapshots instead of writing an invalid row", () => {
    const deep = fitChangeGroupSnapshots(snapshot(docxContentWithTable()), snapshot(docxContentWithTable()), { contentHash: "h".repeat(32) });
    expect(deep.omitted).toBe(true);
    expect(fitsConvexNesting({ baseSnapshot: deep.baseSnapshot, finalSnapshot: deep.finalSnapshot })).toBe(true);
    const flat = fitChangeGroupSnapshots(snapshot({ text: "a" }), snapshot({ text: "b" }));
    expect(flat.omitted).toBe(false);
  });

  it("keeps too-deep version snapshots off the version row", () => {
    const deep = snapshot(docxContentWithTable());
    expect(resolveCommitSnapshotStrategy("document", deep, deep)).toMatchObject({ strategy: "content_addressed", inline: false });
    expect(resolveCommitSnapshotStrategy("document", snapshot({ text: "a" }), snapshot({ text: "b" })))
      .toMatchObject({ strategy: "normalized", inline: true });
  });
});

describe("gateway bridge projection transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  function harness() {
    const calls = [];
    const client = { action: vi.fn(async (_reference, envelope) => {
      const payload = JSON.parse(envelope.payloadJson);
      calls.push({ operation: envelope.operation, payload });
      if (envelope.operation === "issueDurableUpload") return "https://upload.example.test/slot";
      if (envelope.operation === "storeDurablePayload") return { payloadRef: "payload-ref", dependencies: payload.dependencies };
      return { sequence: 1 };
    }) };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ storageId: "storage" }), { status: 200 })));
    const bridge = createCollaborationGatewayBridgeClient({ convexUrl: "https://convex.example.test", bridgeKey: "k".repeat(40), client });
    return { bridge, calls };
  }
  const append = content => ({ artifactId: "artifact", accountId: "account", partitionKey: "root", policyVersion: 1,
    projectionJson: JSON.stringify(snapshot(content)) });

  it("sends content too deep for a Convex row as an immutable content reference", async () => {
    const { bridge, calls } = harness();
    await bridge("append", append(docxContentWithTable()));
    const sent = calls.find(call => call.operation === "append").payload;
    const projected = JSON.parse(sent.projectionJson);
    expect(projected.content.spectraContentRef).toMatchObject({ payloadRef: "payload-ref", path: "content" });
    expect(fitsConvexNesting({ baseSnapshot: projected, finalSnapshot: projected })).toBe(true);
  });

  it("keeps small, shallow content inline", async () => {
    const { bridge, calls } = harness();
    await bridge("append", append({ blocks: [{ id: "p", type: "paragraph", text: "flat" }] }));
    expect(calls.map(call => call.operation)).toEqual(["append"]);
    expect(JSON.parse(calls[0].payload.projectionJson).content.blocks[0].text).toBe("flat");
  });
});
