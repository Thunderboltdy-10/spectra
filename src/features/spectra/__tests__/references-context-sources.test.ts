import { describe, expect, it } from "vitest";
import { getBlueprint } from "../artifacts/blueprint-catalog";
import { ARTIFACT_TYPE_KEYS, type ArtifactTypeKey } from "../artifacts/types";
import {
  createWorkAnchorAdapter,
  deserializeSemanticAnchor,
  getWorkAnchorAdapter,
  serializeSemanticAnchor,
  type SemanticAnchor,
} from "../anchors";
import {
  WORK_REFERENCE_CONTRACTS,
  changeReferenceView,
  createBoardCapture,
  createNativeReferenceInsertion,
  getWorkReferenceContract,
  insertionFromPaste,
  referenceIdentity,
  resizeReference,
  resolveBoardCapture,
  setReferenceMode,
  suggestReferencePlacement,
  validateReferenceView,
  type ReferenceNode,
} from "../references";
import { ContextSourceRegistry } from "../context/registry/context-source-registry";
import {
  IncrementalRichContentParser,
  RICH_CONTENT_ADAPTERS,
  parseSpectraRichContent,
  type RichBlock,
} from "../rich-content";
import {
  WORK_SOURCE_CONTRACTS,
  createEvidenceSpan,
  createPortableSourceBundle,
  createVerifiedSource,
  preserveSourcesThroughConversion,
  verifyCitation,
} from "../sources";
import {
  createRootCommentAnchor,
  migrateLegacyCommentAnchor,
  reanchorComment,
  resolveCommentAnchor,
  revealCommentTarget,
} from "../comments";

function content(type: ArtifactTypeKey) {
  const blueprint = getBlueprint(type);
  if (!blueprint) throw new Error(`Missing blueprint ${type}`);
  return structuredClone(blueprint.defaultContent);
}

function rootAnchor(type: ArtifactTypeKey, workId = `work-${type}`): SemanticAnchor {
  return createRootCommentAnchor(workId, type, 1);
}

function reference(type: ArtifactTypeKey = "document"): ReferenceNode {
  const contract = getWorkReferenceContract(type);
  const target = contract.targets[0]!;
  return {
    embedId: "reference-1",
    containerType: "artifact",
    containerId: "host-1",
    containerRegionId: "artifact:structure",
    sourceArtifactId: "target-1",
    mode: "compact",
    interaction: "read",
    versionPolicy: "live",
    contextPolicy: "summary",
    displayPreferences: {
      sourceWorkType: type,
      anchorKind: target.kind,
      view: target.views[0],
    },
    state: "ready",
  };
}

describe("Phase 7 semantic identity contracts", () => {
  it("provides round-trippable root and region anchors for every registered work type", () => {
    for (const type of ARTIFACT_TYPE_KEYS) {
      const adapter = getWorkAnchorAdapter(type);
      const value = content(type);
      const root = adapter.createFromSelection(`work-${type}`, {}, value)!;
      expect(root.kind).toBe("work:root");
      expect(adapter.exists(root, value)).toBe(true);
      expect(adapter.describe(root, value)).toMatch(/whole/i);
      const roundTrip = deserializeSemanticAnchor(serializeSemanticAnchor({ ...root, relativePosition: Uint8Array.from([1, 2, 3]) }));
      expect([...roundTrip.relativePosition!]).toEqual([1, 2, 3]);
      const migrated = adapter.migrate({ ...root, schemaVersion: 0 }, value);
      expect(migrated.schemaVersion).toBeGreaterThan(0);
    }
  });

  it("delegates reveal and geometry through the shared adapter", async () => {
    let revealed = false;
    const adapter = createWorkAnchorAdapter("document", {
      reveal: () => { revealed = true; },
      geometry: () => ({ x: 1, y: 2, width: 3, height: 4 }),
    });
    const anchor = rootAnchor("document");
    await adapter.reveal(anchor, { focus: true });
    expect(revealed).toBe(true);
    expect(adapter.resolveGeometry(anchor)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("keeps one reference identity while state, view, size, and version policy change", () => {
    const initial = reference();
    const identity = referenceIdentity(initial);
    const expanded = setReferenceMode(initial, "expanded");
    const resized = resizeReference(expanded, 900, 700, { width: 620, height: 480 });
    const viewed = changeReferenceView(resized, "section");
    const pinned = {
      ...viewed,
      versionPolicy: "pinned",
      pinnedVersionId: "version-1",
    } satisfies ReferenceNode;
    expect(referenceIdentity(pinned)).toBe(identity);
    expect(resized.displayPreferences).toMatchObject({ width: 620, height: 480 });
    expect(pinned.displayPreferences?.view).toBe("section");
    expect(pinned.pinnedVersionId).toBe("version-1");
  });

  it("declares useful targets, views, and native insertion for every work type and origin", () => {
    expect(Object.keys(WORK_REFERENCE_CONTRACTS).sort()).toEqual([...ARTIFACT_TYPE_KEYS].sort());
    for (const hostType of ARTIFACT_TYPE_KEYS) {
      const contract = getWorkReferenceContract(hostType);
      expect(contract.targets.length).toBeGreaterThan(0);
      for (const target of contract.targets) {
        expect(target.views.length).toBeGreaterThan(0);
        expect(validateReferenceView(hostType, target.kind, target.views[0])).toBe(true);
      }
      for (const origin of ["command", "paste", "drag", "context", "ai", "suggestion"] as const) {
        expect(createNativeReferenceInsertion(hostType, reference(), origin)).toMatchObject({ hostWorkType: hostType, primitive: contract.insertion, origin });
      }
    }
    expect(insertionFromPaste("document", "https://spectra.test/library/target-1#intro", () => reference())).toMatchObject({ primitive: "tiptap_node", origin: "paste" });
    expect(insertionFromPaste("document", "https://example.com", () => reference())).toBeNull();
  });

  it("captures board semantics and reports moved/deleted object truth", () => {
    const capture = createBoardCapture({ objectIds: ["a", "b", "b"], frameId: "frame-1", camera: { x: 10, y: 20, zoom: 99, width: 800, height: 600 } });
    expect(capture.objectIds).toEqual(["a", "b"]);
    expect(capture.camera.zoom).toBe(8);
    expect(resolveBoardCapture(capture, ["b"])).toMatchObject({ available: ["b"], missing: ["a"], status: "partial" });
    expect(resolveBoardCapture(capture, [])).toMatchObject({ status: "missing" });
  });

  it("emits only high-confidence dismissible suggestions", () => {
    expect(suggestReferencePlacement({ confidence: 0.7, referencedWorkId: "w1", alreadyPlaced: false })).toBeNull();
    expect(suggestReferencePlacement({ confidence: 0.95, referencedWorkId: "w1", workspaceId: "ws", alreadyPlaced: false, rawSpectraUrl: "/library/w1" })).toMatchObject({ kind: "replace_url", dismissible: true });
  });
});

describe("Phase 7 context and semantic index", () => {
  it("registers only permitted targets and resolves the deepest eligible nested target", () => {
    const registry = new ContextSourceRegistry();
    const base = { type: "Document" };
    const disposeRoot = registry.register({ ...base, id: "root", anchor: rootAnchor("document"), label: "Root", permissions: "allowed" });
    registry.register({ ...base, id: "child", parentId: "root", anchor: { ...rootAnchor("document"), kind: "block", path: ["document", "blocks", "b1"] }, label: "Child", permissions: "allowed" });
    registry.register({ ...base, id: "secret", anchor: { ...rootAnchor("document"), path: ["blocks", "secret", "line"] }, label: "Secret", permissions: "denied" });
    expect(registry.listEligible().map((entry) => entry.id).sort()).toEqual(["child", "root"]);
    expect(registry.resolveNested(["root", "secret", "child"])?.id).toBe("child");
    disposeRoot();
    expect(registry.get("root")).toBeUndefined();
  });
});

describe("Phase 7 rich content, citations, exports, and comments", () => {
  it("parses the full canonical AST and preserves stable completed blocks while streaming", () => {
    const source = "# Heading\n\nParagraph `code` $x+1$ [[cite:source:1:evidence:1|A]] [[ref:work-2|Linked work]] [^n]\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\n$$\nx^2\n$$\n\n> [!NOTE] Careful\n\n![Diagram](/diagram.png)\n\nSource: primary record\n\n[^n]: footnote";
    const ast = parseSpectraRichContent(source);
    expect([...new Set(ast.blocks.map((block) => block.type))]).toEqual(expect.arrayContaining(["heading", "paragraph", "list", "table", "code_block", "math_block", "callout", "media", "source_note", "footnote"]));
    const parser = new IncrementalRichContentParser();
    const first = parser.append("First paragraph\n\n```ts\nconst");
    expect(first.complete).toBe(false);
    const stable = first.blocks[0];
    const second = parser.append(" x = 1;\n```");
    expect(second.complete).toBe(true);
    expect(second.blocks[0]).toBe(stable);
    // Markdown written from the model reads back as the same model.
    const shape = (blocks: RichBlock[]) => JSON.parse(JSON.stringify(blocks, (key, value) => (key === "id" || key === "raw" || key === "complete" ? undefined : value)));
    const markdown = RICH_CONTENT_ADAPTERS.markdown;
    expect(shape(markdown.read(markdown.write(ast)).blocks)).toEqual(shape(ast.blocks));
  });

  it("requires verified source/evidence integrity and preserves it across every work conversion", () => {
    const source = createVerifiedSource({ title: "Primary source", accessedAt: "2026-08-03T00:00:00.000Z", sourceType: "paper", authority: "primary", provider: "fixture", url: "https://example.com/paper?utm_source=test", content: "Supported claim" });
    const evidence = createEvidenceSpan(source, "Supported claim", { page: 2 });
    const citation = verifyCitation({ sourceId: source.id, evidenceIds: [evidence.id], label: "A" }, [source], [evidence]);
    const bundle = createPortableSourceBundle({ sources: [source], evidence: [evidence], citations: [citation] });
    expect(() => createPortableSourceBundle({ sources: [source], evidence: [], citations: [citation] })).toThrow("SOURCE_BUNDLE_CONTAINS_UNVERIFIED_CITATION");
    expect(Object.keys(WORK_SOURCE_CONTRACTS).sort()).toEqual([...ARTIFACT_TYPE_KEYS].sort());
    for (const type of ARTIFACT_TYPE_KEYS) expect(preserveSourcesThroughConversion({ text: "answer" }, bundle, type).sourceBundle.citations).toHaveLength(1);
  });

  it("migrates, orphans, reveals, selects, and reanchors comments through shared adapters", async () => {
    const value = content("document");
    const adapter = createWorkAnchorAdapter("document");
    const root = createRootCommentAnchor("work-1", "document", 1);
    expect(resolveCommentAnchor(root, adapter, value).status).toBe("attached");
    const legacy = migrateLegacyCommentAnchor({ artifactId: "work-1", artifactType: "document", regionId: "missing", excerpt: "gone", relativePosition: [3, 4] });
    const orphan = resolveCommentAnchor(legacy, adapter, value);
    expect(orphan.status).toBe("orphaned");
    expect((await revealCommentTarget(orphan, adapter)).selected).toBe(true);
    expect(reanchorComment(orphan, root)).toMatchObject({ status: "attached", selected: true });
  });
});
