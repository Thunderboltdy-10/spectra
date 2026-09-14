import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { getBlueprint } from "@/features/spectra/artifacts/blueprint-catalog";
import {
  ARTIFACT_TYPE_KEYS,
  type ArtifactTypeKey,
} from "@/features/spectra/artifacts/types";
import {
  codeFileText,
  codeYjsAdapter,
  createDocumentRelativeSelection,
  documentYjsAdapter,
  extractLegacyFlashcardStudyState,
  listWorkYjsAdapters,
  resolveDocumentRelativeSelection,
  structuredCollection,
  structuredText,
  workTransactionOrigin,
  workYjsAdapter,
  type WorkActorIdentity,
} from "@/features/spectra/work/models/yjs";
import {
  NativeArtifactYjsModel,
  NATIVE_WORK_LIVE_META_MAP,
} from "@/features/spectra/work/models/yjs/native-artifact-model";
import {
  BoundedYjsLocalPersistence,
  MemoryYjsStore,
  shouldRefuseCollapsedLocalPersist,
  type LocalYjsRecord,
  type LocalYjsStore,
} from "@/features/spectra/realtime/persistence";
import {
  collaborationPolicyRegistry,
  LeaseReleaseSubscriptions,
  waitForActorRelease,
} from "@/features/spectra/realtime/policies";

const human: WorkActorIdentity = {
  clientId: "human-1",
  kind: "human",
  accountId: "account-1",
  name: "Pablo",
};
const ai: WorkActorIdentity = {
  clientId: "ai-1",
  kind: "ai",
  accountId: "account-1",
  name: "Pablo's AI",
};

function sync(from: Y.Doc, to: Y.Doc) {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

function firstXmlText(node: Y.XmlFragment | Y.XmlElement): Y.XmlText {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (child instanceof Y.XmlElement) {
      try {
        return firstXmlText(child);
      } catch {
        // Continue through the remaining descendants.
      }
    }
  }
  throw new Error("XML_TEXT_NOT_FOUND");
}

function defaultContent(type: ArtifactTypeKey) {
  const blueprint = getBlueprint(type);
  if (!blueprint) throw new Error(`Missing blueprint ${type}`);
  return structuredClone(blueprint.defaultContent);
}

function denseWorkbook(cellCount = 1_800) {
  const sheetCount = 4;
  const cellsPerSheet = Math.ceil(cellCount / sheetCount);
  return {
    workbook: { calculationMode: "automatic" as const, locale: "en-US" },
    activeSheetId: "sheet-1",
    sheets: Array.from({ length: sheetCount }, (_, sheetIndex) => {
      const cells = Object.fromEntries(
        Array.from({ length: cellsPerSheet }, (_, cellIndex) => {
          const row = Math.floor(cellIndex / 15) + 1;
          const column = String.fromCharCode(65 + (cellIndex % 15));
          return [
            `${column}${row}`,
            {
              value: `S${sheetIndex + 1}-${cellIndex + 1}`,
              ...(cellIndex % 9 === 0
                ? { formula: `=${column}${Math.max(1, row - 1)}+1` }
                : {}),
            },
          ];
        }),
      );
      return {
        id: `sheet-${sheetIndex + 1}`,
        name: `Sheet ${sheetIndex + 1}`,
        cells,
        tables: [],
        charts: [],
        rowCount: Math.ceil(cellsPerSheet / 15),
        columnCount: 15,
      };
    }),
  };
}

function mergeFixtureContent(type: ArtifactTypeKey) {
  if (type !== "document") return defaultContent(type);
  return {
    ...(defaultContent(type) as Record<string, unknown>),
    tiptap: undefined,
    blocks: [{ id: "intro", type: "paragraph", text: "Seed" }],
  };
}

function nativeTypes(value: unknown, result: Array<Y.Text | Y.XmlText> = []) {
  if (value instanceof Y.Text || value instanceof Y.XmlText) {
    result.push(value);
    return result;
  }
  if (value instanceof Y.Map)
    for (const entry of value.values()) nativeTypes(entry, result);
  else if (
    value instanceof Y.Array ||
    value instanceof Y.XmlFragment ||
    value instanceof Y.XmlElement
  )
    for (const entry of value.toArray()) nativeTypes(entry, result);
  return result;
}

function sharedTexts(
  adapter: ReturnType<typeof workYjsAdapter>,
  document: Y.Doc,
) {
  const binding = adapter.bind(document, null, human);
  return binding.sharedTypes.flatMap((value) => nativeTypes(value));
}

describe("native fine-grained Yjs models", () => {
  it("replaces the seeded document placeholder when AI authors a new document", () => {
    const adapter = documentYjsAdapter;
    const document = adapter.createDocument({
      blocks: [{ id: "intro", type: "paragraph", text: "Start writing here." }],
      outline: [],
    });
    adapter.applyProjection(
      document,
      {
        blocks: [
          { id: "title", type: "heading", text: "Cell biology" },
          { id: "body", type: "paragraph", text: "A useful revision note." },
        ],
        outline: [{ id: "title", title: "Cell biology", level: 1 }],
      },
      workTransactionOrigin(ai, "ai_semantic_edit"),
    );
    const projected = adapter.project(document) as {
      blocks: Array<{ id: string; text?: string }>;
    };
    expect(projected.blocks.map((block) => block.id)).toEqual(["title", "body"]);
    expect(projected.blocks.some((block) => block.text === "Start writing here.")).toBe(false);
    document.destroy();
  });

  it("registers a complete create/bind/project/regions/validate/migrate/undo adapter for every work type", () => {
    const adapters = listWorkYjsAdapters();
    expect(adapters.map((adapter) => adapter.workType)).toEqual(
      ARTIFACT_TYPE_KEYS,
    );
    for (const type of ARTIFACT_TYPE_KEYS) {
      const adapter = workYjsAdapter(type);
      const document = adapter.createDocument(defaultContent(type));
      expect(adapter.validate(document)).toEqual({ valid: true });
      expect(adapter.project(document)).toBeTruthy();
      expect(adapter.deriveSemanticRegions(document).length).toBeGreaterThan(0);
      expect(
        adapter.bind(document, null, human).sharedTypes.length,
      ).toBeGreaterThan(0);
      const undo = adapter.createUndoManager(document, human);
      expect(undo).toBeInstanceOf(Y.UndoManager);
      undo.destroy();
      const migration = adapter.migrateLegacy({
        workType: type,
        schemaVersion: 1,
        content: defaultContent(type),
      });
      expect(migration.rollbackUpdate.byteLength).toBeGreaterThan(0);
      expect(adapter.validate(migration.document)).toEqual({ valid: true });
      expect(adapter.project(migration.document)).toEqual(migration.projected);
      const repeated = adapter.migrateLegacy({
        workType: type,
        schemaVersion: 1,
        content: migration.projected,
      });
      expect(adapter.project(repeated.document)).toEqual(migration.projected);
    }
  });

  it("passes native merge, stable-region, actor-undo, projection, and serialization contracts for every work type", () => {
    for (const type of ARTIFACT_TYPE_KEYS) {
      const adapter = workYjsAdapter(type);
      const left = adapter.createDocument(mergeFixtureContent(type));
      const right = new Y.Doc();
      sync(left, right);
      const leftText = sharedTexts(adapter, left)[0];
      const rightText = sharedTexts(adapter, right)[0];
      expect(leftText, `${type} must expose native shared text`).toBeTruthy();
      expect(
        rightText,
        `${type} must reproduce native shared text`,
      ).toBeTruthy();
      const regionsBefore = new Set(
        adapter.deriveSemanticRegions(left).map((region) => region.regionId),
      );
      left.transact(
        () => leftText!.insert(leftText!.length, ` L-${type}`),
        workTransactionOrigin(human, "local_human"),
      );
      right.transact(
        () => rightText!.insert(0, `R-${type} `),
        workTransactionOrigin(ai, "ai_semantic_edit"),
      );
      sync(left, right);
      sync(right, left);
      expect(sharedTexts(adapter, left)[0]!.toString()).toBe(
        sharedTexts(adapter, right)[0]!.toString(),
      );
      expect(adapter.validate(left)).toEqual({ valid: true });
      const regionsAfter = new Set(
        adapter.deriveSemanticRegions(left).map((region) => region.regionId),
      );
      expect(
        [...regionsBefore].some((regionId) => regionsAfter.has(regionId)),
        `${type} semantic identity must survive text edits`,
      ).toBe(true);
      expect(adapter.project(left)).toEqual(adapter.project(right));

      const undoDocument = adapter.createDocument(mergeFixtureContent(type));
      const undoText = sharedTexts(adapter, undoDocument)[0]!;
      const origins = adapter.origins(human);
      const undo = adapter.createUndoManager(undoDocument, human);
      undoDocument.transact(
        () => undoText.insert(undoText.length, " LOCAL-UNDO-MARKER"),
        origins.localHuman,
      );
      undoDocument.transact(
        () => undoText.insert(undoText.length, " AI-PRESERVED-MARKER"),
        adapter.origins(ai).ai,
      );
      undo.undo();
      expect(undoText.toString()).not.toContain("LOCAL-UNDO-MARKER");
      expect(undoText.toString()).toContain("AI-PRESERVED-MARKER");
      undo.destroy();

      const started = performance.now();
      const encoded = Y.encodeStateAsUpdate(left);
      expect(performance.now() - started).toBeLessThan(250);
      expect(encoded.byteLength).toBeLessThan(1_048_576);
      left.destroy();
      right.destroy();
      undoDocument.destroy();
    }
  });

  it("constructs code undo before the collaboration document is bootstrapped", () => {
    const document = new Y.Doc();
    const origins = codeYjsAdapter.origins(human);
    const undo = codeYjsAdapter.createUndoManager(document, human);

    codeYjsAdapter.applyProjection(
      document,
      defaultContent("code") as Parameters<
        typeof codeYjsAdapter.applyProjection
      >[1],
      origins.localHuman,
    );
    const text = codeFileText(
      document,
      codeYjsAdapter.project(document).entryFileId,
    )!;
    document.transact(
      () => text.insert(text.length, "\n<!-- local -->"),
      origins.localHuman,
    );
    undo.undo();

    expect(text.toString()).not.toContain("<!-- local -->");
    undo.destroy();
    document.destroy();
  });

  it("merges simultaneous document text and keeps relative anchors stable", () => {
    const initial = {
      blocks: [{ id: "intro", type: "paragraph", text: "Hello" }],
    };
    const left = documentYjsAdapter.createDocument(initial);
    const right = new Y.Doc();
    sync(left, right);
    const leftText = firstXmlText(left.getXmlFragment("spectra:document-v2"));
    const rightText = firstXmlText(right.getXmlFragment("spectra:document-v2"));
    const anchor = createDocumentRelativeSelection(left, "intro", 5);
    expect(anchor).not.toBeNull();
    left.transact(
      () => leftText.insert(5, " world"),
      workTransactionOrigin(human, "local_human"),
    );
    right.transact(
      () => rightText.insert(0, "Kind "),
      workTransactionOrigin(ai, "ai_semantic_edit"),
    );
    sync(left, right);
    sync(right, left);
    expect(
      firstXmlText(left.getXmlFragment("spectra:document-v2")).toString(),
    ).toBe(
      firstXmlText(right.getXmlFragment("spectra:document-v2")).toString(),
    );
    const resolved = resolveDocumentRelativeSelection(left, anchor!);
    expect(resolved?.blockId).toBe("intro");
    expect(resolved?.anchor).toBeGreaterThanOrEqual(5);
    expect(resolved?.anchor).toBeLessThanOrEqual(leftText.length);
  });

  it("merges code per file while structural metadata stays independent", () => {
    const initial = defaultContent("code") as Parameters<
      typeof codeYjsAdapter.createDocument
    >[0];
    const left = codeYjsAdapter.createDocument(initial);
    const right = new Y.Doc();
    sync(left, right);
    const leftText = codeFileText(left, "file-main")!;
    const rightText = codeFileText(right, "file-main")!;
    leftText.insert(leftText.length, "\n<p>Left</p>");
    rightText.insert(0, "<!-- right -->\n");
    sync(left, right);
    sync(right, left);
    expect(codeYjsAdapter.project(left).files[0]?.source).toBe(
      codeYjsAdapter.project(right).files[0]?.source,
    );
    expect(codeYjsAdapter.project(left).entryFileId).toBe("file-main");
  });

  it("keeps sparse sheet cells and presentation geometry in independent native maps", () => {
    const sheetDoc = workYjsAdapter("sheets").createDocument(
      defaultContent("sheets"),
    );
    const sheets = structuredCollection(sheetDoc, ["sheets"]);
    expect(sheets).not.toBeNull();
    const sheet = sheets!.items.get("sheet-1")!;
    const cells = sheet.get("cells") as Y.Map<Y.Map<unknown>>;
    const a1 = new Y.Map<unknown>();
    a1.set("formula", "=1+1");
    a1.set("value", 2);
    const b1 = new Y.Map<unknown>();
    b1.set("value", "Independent");
    cells.set("A1", a1);
    cells.set("B1", b1);
    const sheetProjection = workYjsAdapter("sheets").project(sheetDoc) as {
      sheets: Array<{ cells: Record<string, unknown> }>;
    };
    expect(sheetProjection.sheets[0]?.cells).toMatchObject({
      A1: { formula: "=1+1", value: 2 },
      B1: { value: "Independent" },
    });

    const presentation = defaultContent("presentation") as Record<
      string,
      unknown
    >;
    (presentation.slides as Array<Record<string, unknown>>)[0]!.objects = [
      {
        id: "object-1",
        type: "text",
        x: 20,
        y: 30,
        width: 200,
        height: 80,
        rotation: 0,
        content: { text: "Move me" },
      },
    ];
    const deckDoc = workYjsAdapter("presentation").createDocument(presentation);
    const slides = structuredCollection(deckDoc, ["slides"])!;
    const objects = slides.items
      .get("slide-1")!
      .get("objects") as Y.Map<unknown>;
    const objectItems = objects.get("items") as Y.Map<Y.Map<unknown>>;
    const object = objectItems.get("object-1")!;
    object.set("x", 440);
    object.set("y", 220);
    const deck = workYjsAdapter("presentation").project(deckDoc) as {
      slides: Array<{ objects: Array<{ x: number; y: number }> }>;
    };
    expect(deck.slides[0]?.objects[0]).toMatchObject({ x: 440, y: 220 });
  });

  it("stores dense sheet cells as compact strings and bounds eager semantic regions", () => {
    const adapter = workYjsAdapter("sheets");
    const initial = denseWorkbook(12_000);
    const started = performance.now();
    const document = adapter.createDocument(initial);
    const createdMs = performance.now() - started;
    const projected = adapter.project(document) as ReturnType<
      typeof denseWorkbook
    >;
    expect(projected.sheets[0]?.cells.A1?.value).toBe("S1-1");
    const sheets = structuredCollection(document, ["sheets"]);
    const cells = sheets!.items.get("sheet-1")!.get("cells") as Y.Map<unknown>;
    expect(typeof cells.get("A1")).toBe("string");
    const regionStarted = performance.now();
    const regions = adapter.deriveSemanticRegions(document, projected);
    const regionMs = performance.now() - regionStarted;
    expect(regions.some((region) => region.kind === "sheet_cell")).toBe(false);
    expect(regions.length).toBeLessThan(80);
    expect(createdMs).toBeLessThan(2_000);
    expect(regionMs).toBeLessThan(250);
    document.destroy();
  });

  it("commits one dense-workbook cell as a compact native update with an immediate live snapshot", async () => {
    const adapter = workYjsAdapter("sheets");
    const initial = denseWorkbook();
    const document = adapter.createDocument(initial);
    const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "Dense workbook");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const peer = new Y.Doc();
    sync(document, peer);
    const beforeVector = Y.encodeStateVector(document);
    const transport = {
      clientId: "dense-sheet-client",
      document,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    };
    const model = new NativeArtifactYjsModel(
      "sheets",
      transport as unknown as ConstructorParameters<
        typeof NativeArtifactYjsModel
      >[1],
    );
    const nextContent = structuredClone(adapter.project(document)) as ReturnType<
      typeof denseWorkbook
    >;
    nextContent.sheets[0]!.cells.A1 = { value: "RCV1-DENSE-A1" };
    const claims: Array<{ regionId: string; overlapDomains: string[] }> = [];
    const controller = {
      editMany: async (
        regions: Array<{ regionId: string; overlapDomains: string[] }>,
        change: () => void,
      ) => {
        claims.push(...regions);
        document.transact(change);
        return { applied: true as const, claims: [] };
      },
    };

    const started = performance.now();
    await model.replaceSnapshot(
      {
        title: "Dense workbook",
        tags: [],
        content: nextContent,
      },
      controller as unknown as Parameters<typeof model.replaceSnapshot>[1],
    );
    const elapsed = performance.now() - started;
    const delta = Y.encodeStateAsUpdate(document, beforeVector);

    expect(elapsed).toBeLessThan(100);
    expect(delta.byteLength).toBeLessThan(8 * 1024);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.regionId).toBe(
      "sheet-1:sheet-1:row:1:sheet-1:column:1",
    );
    expect(
      (
        model.getSnapshot().value?.content as ReturnType<
          typeof denseWorkbook
        >
      ).sheets[0]!.cells.A1?.value,
    ).toBe("RCV1-DENSE-A1");

    Y.applyUpdate(peer, delta);
    const projectedPeer = adapter.project(peer) as ReturnType<
      typeof denseWorkbook
    >;
    expect(projectedPeer.sheets[0]!.cells.A1?.value).toBe("RCV1-DENSE-A1");
    expect(projectedPeer.sheets[0]!.cells.B1?.value).toBe("S1-2");
    expect(projectedPeer.sheets[3]!.cells.O30?.value).toBe("S4-450");

    model.destroy();
    peer.destroy();
    document.destroy();
  });

  it("restores selected native regions without replacing unrelated content", async () => {
    const adapter = documentYjsAdapter;
    const currentContent = {
      ...(defaultContent("document") as Record<string, unknown>),
      tiptap: undefined,
      blocks: [
        { id: "block-a", type: "paragraph", text: "Current A" },
        { id: "block-b", type: "paragraph", text: "Current B" },
      ],
    };
    const historicalContent = {
      ...currentContent,
      blocks: [
        { id: "block-a", type: "paragraph", text: "Historical A" },
        { id: "block-b", type: "paragraph", text: "Historical B" },
      ],
    };
    const document = adapter.createDocument(currentContent);
    const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "Selective restore");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const model = new NativeArtifactYjsModel("document", {
      clientId: "selective-restore-client",
      document,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    } as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1]);
    const claimed: string[] = [];
    const controller = {
      editMany: async (
        regions: Array<{ regionId: string; overlapDomains: string[] }>,
        change: () => void,
      ) => {
        claimed.push(...regions.map((region) => region.regionId));
        document.transact(change);
        return { applied: true as const, claims: [] };
      },
    } as unknown as Parameters<
      NativeArtifactYjsModel["replaceRegionsFromSnapshot"]
    >[2];

    await model.replaceRegionsFromSnapshot(
      {
        title: "Selective restore",
        tags: [],
        content: historicalContent,
      },
      ["block-a"],
      controller,
    );

    const restored = adapter.project(document) as {
      blocks: Array<{ id: string; type: string; text: string }>;
    };
    expect(claimed).toEqual(["block-a"]);
    expect(restored.blocks).toEqual([
      { id: "block-a", type: "paragraph", text: "Historical A" },
      { id: "block-b", type: "paragraph", text: "Current B" },
    ]);
    model.destroy();
    document.destroy();
  });

  it("restores one sheet cell while preserving neighboring cells and sheet structure", async () => {
    const adapter = workYjsAdapter("sheets");
    const currentContent = {
      workbook: { calculationMode: "automatic", locale: "en-US" },
      activeSheetId: "sheet-a",
      sheets: [
        {
          id: "sheet-a",
          name: "Data",
          cells: {
            A1: { value: "Current A" },
            B1: { value: "Current B" },
          },
          tables: [],
          charts: [],
        },
      ],
    };
    const document = adapter.createDocument(currentContent);
    const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "Selective sheet restore");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const projectedCurrent = adapter.project(document) as typeof currentContent;
    const historicalContent = structuredClone(projectedCurrent);
    historicalContent.sheets[0]!.cells.A1 = { value: "Historical A" };
    const cellRegion = adapter
      .deriveSemanticRegions(document, projectedCurrent)
      .find((region) =>
        JSON.stringify(region.path) ===
        JSON.stringify(["sheets", 0, "cells", "A1"]),
      );
    expect(cellRegion).toBeDefined();
    const model = new NativeArtifactYjsModel("sheets", {
      clientId: "selective-sheet-client",
      document,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    } as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1]);
    const claimed: string[] = [];
    const controller = {
      editMany: async (
        regions: Array<{ regionId: string; overlapDomains: string[] }>,
        change: () => void,
      ) => {
        claimed.push(...regions.map((region) => region.regionId));
        document.transact(change);
        return { applied: true as const, claims: [] };
      },
    } as unknown as Parameters<
      NativeArtifactYjsModel["replaceRegionsFromSnapshot"]
    >[2];

    await model.replaceRegionsFromSnapshot(
      {
        title: "Selective sheet restore",
        tags: [],
        content: historicalContent,
      },
      [cellRegion!.regionId],
      controller,
    );

    const restored = adapter.project(document) as typeof currentContent;
    expect(claimed).toEqual([cellRegion!.regionId]);
    expect(restored.sheets[0]!.cells).toMatchObject({
      A1: { value: "Historical A" },
      B1: { value: "Current B" },
    });
    expect(restored.sheets[0]!.id).toBe("sheet-a");
    model.destroy();
    document.destroy();
  });

  it("restores a presentation root descriptor and refuses a changed target structure", async () => {
    const adapter = workYjsAdapter("presentation");
    const currentContent = {
      theme: { id: "theme-current", name: "Current theme" },
      slides: [
        {
          id: "slide-a",
          title: "Current slide",
          speakerNotes: "Current notes",
          objects: [
            {
              id: "object-a",
              type: "text" as const,
              x: 10,
              y: 10,
              width: 200,
              height: 80,
              rotation: 0,
              content: { text: "Current object" },
            },
          ],
        },
        {
          id: "slide-b",
          title: "Unrelated current slide",
          objects: [],
        },
      ],
      sections: [],
      components: [],
      settings: { aspectRatio: "16:9" as const },
    };
    const document = adapter.createDocument(currentContent);
    const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "Selective presentation restore");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const projectedCurrent = adapter.project(document) as typeof currentContent;
    const historicalContent = structuredClone(projectedCurrent);
    historicalContent.theme = { id: "theme-historical", name: "Historical theme" };
    historicalContent.slides[0]!.objects[0]!.content = {
      text: "Historical object",
    };
    const model = new NativeArtifactYjsModel("presentation", {
      clientId: "selective-presentation-client",
      document,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    } as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1]);
    const claimed: string[] = [];
    const controller = {
      editMany: async (
        regions: Array<{ regionId: string; overlapDomains: string[] }>,
        change: () => void,
      ) => {
        claimed.push(...regions.map((region) => region.regionId));
        document.transact(change);
        return { applied: true as const, claims: [] };
      },
    } as unknown as Parameters<
      NativeArtifactYjsModel["replaceRegionsFromSnapshot"]
    >[2];

    await model.replaceRegionsFromSnapshot(
      {
        title: "Selective presentation restore",
        tags: [],
        content: historicalContent,
      },
      ["presentation:theme"],
      controller,
    );
    const restored = adapter.project(document) as typeof currentContent;
    expect(claimed).toEqual(["presentation:theme"]);
    expect(restored.theme).toEqual(historicalContent.theme);
    expect(restored.slides[1]!.title).toBe("Unrelated current slide");
    expect(restored.slides[0]!.objects[0]!.content).toEqual(
      projectedCurrent.slides[0]!.objects[0]!.content,
    );

    const changedStructure = structuredClone(projectedCurrent);
    changedStructure.slides[0]!.id = "slide-renamed";
    await expect(
      model.replaceRegionsFromSnapshot(
        {
          title: "Selective presentation restore",
          tags: [],
          content: changedStructure,
        },
        ["object-a"],
        controller,
      ),
    ).rejects.toThrow("NATIVE_PARTIAL_RESTORE_STRUCTURE_CHANGED");
    expect((adapter.project(document) as typeof currentContent).theme).toEqual(
      historicalContent.theme,
    );
    model.destroy();
    document.destroy();
  });

  it("adopts a Word-only trailing paragraph without rewriting existing fragment nodes", () => {
    const adapter = documentYjsAdapter;
    const initial = {
      blocks: [
        {
          id: "docx:paragraph:protected",
          type: "paragraph",
          text: "Protected OMML host",
          attrs: { nativeReadOnly: true },
        },
        {
          id: "docx:paragraph:one",
          type: "paragraph",
          text: "Spectra paragraph",
        },
      ],
    };
    const document = adapter.createDocument(initial);
    const fragment = document.getXmlFragment("spectra:document-v2");
    const [protectedNode, spectraNode] = fragment.toArray();
    adapter.applyProjection(
      document,
      {
        blocks: [
          ...initial.blocks,
          {
            id: "docx:paragraph:native",
            type: "paragraph",
            text: "RCV1WORDNATIVE7",
          },
        ],
      },
      workTransactionOrigin(
        { clientId: "keep-word", kind: "human" },
        "source_update",
      ),
    );
    const projected = adapter.project(document);
    expect(fragment.toArray()[0]).toBe(protectedNode);
    expect(fragment.toArray()[1]).toBe(spectraNode);
    expect(fragment.length).toBe(3);
    expect(JSON.stringify(projected.blocks)).toContain("RCV1WORDNATIVE7");
    expect(JSON.stringify(projected.tiptap)).toContain("RCV1WORDNATIVE7");
    document.destroy();
  });

  it("adopts a Word-only trailing paragraph into the live document fragment", async () => {
    const adapter = documentYjsAdapter;
    const initial = {
      blocks: [{ id: "intro", type: "paragraph", text: "Spectra paragraph" }],
      outline: [],
      tiptap: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: "intro" },
            content: [{ type: "text", text: "Spectra paragraph" }],
          },
        ],
      },
    };
    const document = adapter.createDocument(initial);
    const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "Maths EE 3.docx");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const model = new NativeArtifactYjsModel("document", {
      clientId: "docx-keep-word-client",
      document,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    } as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1]);
    const nativeProjection = {
      blocks: [
        { id: "intro", type: "paragraph", text: "Spectra paragraph" },
        {
          id: "docx:paragraph:native",
          type: "paragraph",
          text: "RCV1WORDNATIVE5",
        },
      ],
      outline: [],
    };
    await model.replaceSnapshot(
      {
        title: "Maths EE 3.docx",
        tags: [],
        content: nativeProjection,
      },
      {
        editMany: async (
          _regions: Array<{ regionId: string; overlapDomains: string[] }>,
          change: () => void,
        ) => {
          document.transact(change);
          return { applied: true as const, claims: [] };
        },
        edit: async (
          _regionId: string,
          _overlap: string[],
          change: () => void,
        ) => {
          document.transact(change);
          return { applied: true as const };
        },
      } as unknown as Parameters<typeof model.replaceSnapshot>[1],
    );
    const projected = adapter.project(document);
    expect(JSON.stringify(projected.blocks)).toContain("RCV1WORDNATIVE5");
    expect(JSON.stringify(projected.tiptap)).toContain("RCV1WORDNATIVE5");
    model.destroy();
    document.destroy();
  });

  it("flushes Yjs-ahead document body on a metadata-only save", async () => {
    const adapter = documentYjsAdapter;
    const initial = {
      blocks: [
        {
          id: "intro",
          type: "paragraph",
          text: "UNIQUE-SEED UNIQUE-A UNIQUE-B UNIQUE-AI",
        },
      ],
    };
    const ydoc = adapter.createDocument(initial);
    const liveMeta = ydoc.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "P8V1-D3-unique.docx");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const model = new NativeArtifactYjsModel("document", {
      clientId: "docx-ahead-client",
      document: ydoc,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    } as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1]);
    adapter.applyProjection(
      ydoc,
      {
        blocks: [
          {
            id: "intro",
            type: "paragraph",
            text: "UNIQUE-SEED UNIQUE-A UNIQUE-B UNIQUE-AI UNIQUE-AFTER-DOWN",
          },
        ],
      },
      workTransactionOrigin(
        { clientId: "docx-ahead-client", kind: "human" },
        "local_human",
      ),
    );
    expect(JSON.stringify(model.getSnapshot().value?.content)).not.toContain(
      "UNIQUE-AFTER-DOWN",
    );
    await model.replaceMetadataSnapshot(
      {
        title: "P8V1-D3-unique.docx",
        tags: [],
        content: model.getSnapshot().value?.content,
      },
      {
        editMany: async (
          _regions: Array<{ regionId: string; overlapDomains: string[] }>,
          change: () => void,
        ) => {
          ydoc.transact(change);
          return { applied: true as const, claims: [] };
        },
      } as unknown as Parameters<typeof model.replaceMetadataSnapshot>[1],
    );
    expect(JSON.stringify(model.getSnapshot().value?.content)).toContain(
      "UNIQUE-AFTER-DOWN",
    );
    model.destroy();
    ydoc.destroy();
  });

  it("persists document page chrome through metadata-only collaboration saves", async () => {
    const adapter = documentYjsAdapter;
    const ydoc = adapter.createDocument({
      blocks: [{ id: "intro", type: "paragraph", text: "Body" }],
      pageSetup: { header: "", footer: "" },
    });
    const liveMeta = ydoc.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "V8-02-rich.docx");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const model = new NativeArtifactYjsModel("document", {
      clientId: "docx-page-chrome-client",
      document: ydoc,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    } as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1]);

    await model.replaceMetadataSnapshot(
      {
        title: "V8-02-rich.docx",
        tags: [],
        content: {
          ...(model.getSnapshot().value?.content as Record<string, unknown>),
          pageSetup: { header: "V8-02 Rich Word Acceptance", footer: "" },
        },
      },
      {
        editMany: async (
          _regions: Array<{ regionId: string; overlapDomains: string[] }>,
          change: () => void,
        ) => {
          ydoc.transact(change);
          return { applied: true as const, claims: [] };
        },
      } as unknown as Parameters<typeof model.replaceMetadataSnapshot>[1],
    );

    expect(
      (model.getSnapshot().value?.content as Record<string, unknown>)
        .pageSetup,
    ).toEqual({ header: "V8-02 Rich Word Acceptance", footer: "" });
    model.destroy();
    ydoc.destroy();
  });

  it("projects a dense live model once and reuses its semantic descriptor index", () => {
    const adapter = workYjsAdapter("sheets");
    const document = adapter.createDocument(denseWorkbook());
    const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "Dense workbook");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const project = vi.spyOn(adapter, "project");
    const validate = vi.spyOn(adapter, "validate");
    const deriveSemanticRegions = vi.spyOn(
      adapter,
      "deriveSemanticRegions",
    );
    const model = new NativeArtifactYjsModel("sheets", {
      clientId: "dense-descriptor-client",
      document,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    } as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1]);

    try {
      expect(project).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledTimes(1);
      expect(deriveSemanticRegions).toHaveBeenCalledTimes(1);

      const regionIds = model.getSnapshot().regionIds.slice(0, 64);
      expect(regionIds).toHaveLength(64);
      expect(regionIds.every((regionId) => model.descriptor(regionId))).toBe(
        true,
      );
      expect(project).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledTimes(1);
      expect(deriveSemanticRegions).toHaveBeenCalledTimes(1);
    } finally {
      model.destroy();
      deriveSemanticRegions.mockRestore();
      validate.mockRestore();
      project.mockRestore();
      document.destroy();
    }
  });

  it("keeps quiz attempts and flashcard study progress outside authored Yjs source", () => {
    const deck = {
      ...(defaultContent("flashcard_deck") as Record<string, unknown>),
      cards: [
        {
          id: "card-1",
          front: "Question",
          back: "Answer",
          confidence: "strong",
          review: { state: "mastered", correctStreak: 8 },
        },
      ],
    };
    expect(extractLegacyFlashcardStudyState(deck)).toEqual([
      {
        cardId: "card-1",
        confidence: "strong",
        review: { state: "mastered", correctStreak: 8 },
      },
    ]);
    const deckProjection = workYjsAdapter("flashcard_deck").project(
      workYjsAdapter("flashcard_deck").createDocument(deck),
    ) as { cards: Array<Record<string, unknown>> };
    expect(deckProjection.cards[0]).not.toHaveProperty("review");
    expect(deckProjection.cards[0]).not.toHaveProperty("confidence");

    const quiz = {
      ...(defaultContent("quiz") as Record<string, unknown>),
      questions: [
        {
          id: "question-1",
          prompt: "Pick one",
          type: "multiple_choice",
          options: ["Alpha", "Beta"],
          optionIds: ["option-a", "option-b"],
          correctAnswer: "Alpha",
        },
      ],
      attempts: [{ id: "attempt-1", score: 100 }],
      responses: { "question-1": "A" },
    };
    const quizProjection = workYjsAdapter("quiz").project(
      workYjsAdapter("quiz").createDocument(quiz),
    ) as Record<string, unknown>;
    expect(quizProjection).not.toHaveProperty("attempts");
    expect(quizProjection).not.toHaveProperty("responses");
    const questions = structuredCollection(
      workYjsAdapter("quiz").createDocument(quiz),
      ["questions"],
    )!;
    const options = questions.items
      .get("question-1")!
      .get("options") as Y.Array<unknown>;
    expect(options.get(0)).toBeInstanceOf(Y.Text);
  });

  it("models board z-order and future Plan tasks/milestones as stable shared ordering", () => {
    const boardSource = defaultContent("whiteboard") as Record<string, unknown>;
    const board = workYjsAdapter("whiteboard").createDocument(boardSource);
    const boardRoot = board.getMap<unknown>("spectra:work-v2");
    expect(boardRoot.get("zOrder")).toBeInstanceOf(Y.Array);

    const planSource = {
      ...(defaultContent("planner_task") as Record<string, unknown>),
      tasks: [
        {
          id: "task-1",
          title: "Research",
          status: "todo",
          calendarBlockIds: ["block-1"],
        },
        { id: "task-2", title: "Draft", status: "doing" },
      ],
      milestones: [{ id: "milestone-1", title: "First review" }],
      sections: [{ id: "section-1", title: "Essay" }],
    };
    const plan = workYjsAdapter("planner_task").createDocument(planSource);
    expect(structuredCollection(plan, ["tasks"])?.order.toArray()).toEqual([
      "task-1",
      "task-2",
    ]);
    expect(structuredCollection(plan, ["milestones"])?.order.toArray()).toEqual(
      ["milestone-1"],
    );
    expect(structuredText(plan, ["tasks", "task-1", "title"])?.toString()).toBe(
      "Research",
    );
    expect(workYjsAdapter("planner_task").validate(plan)).toEqual({
      valid: true,
    });
  });

  it("supports collaborative Agent mission, evidence, dynamic sections, and release drafts", () => {
    const source = {
      ...(defaultContent("agent") as Record<string, unknown>),
      mission: { objective: "Review research with source discipline" },
      foundationSections: [
        {
          id: "section-1",
          type: "text",
          question: "What should improve?",
          answer: "Claims",
        },
      ],
      evidenceBindings: [
        { id: "evidence-1", title: "Rubric", description: "Primary criteria" },
      ],
      releaseDrafts: [
        {
          id: "release-1",
          releaseSummary: "Adds evidence checks",
          status: "draft",
        },
      ],
    };
    const document = workYjsAdapter("agent").createDocument(source);
    expect(structuredText(document, ["mission", "objective"])?.toString()).toBe(
      "Review research with source discipline",
    );
    expect(
      structuredCollection(document, ["foundationSections"])?.order.toArray(),
    ).toEqual(["section-1"]);
    expect(
      structuredCollection(document, ["evidenceBindings"])?.order.toArray(),
    ).toEqual(["evidence-1"]);
    expect(
      structuredCollection(document, ["releaseDrafts"])?.order.toArray(),
    ).toEqual(["release-1"]);
    expect(workYjsAdapter("agent").validate(document)).toEqual({ valid: true });
  });

  it("isolates human undo from remote AI origins", () => {
    const document = codeYjsAdapter.createDocument(
      defaultContent("code") as Parameters<
        typeof codeYjsAdapter.createDocument
      >[0],
    );
    const text = codeFileText(document, "file-main")!;
    const localOrigin = workTransactionOrigin(human, "local_human");
    const aiOrigin = workTransactionOrigin(ai, "ai_semantic_edit");
    const undo = new Y.UndoManager(text, {
      trackedOrigins: new Set([localOrigin]),
    });
    document.transact(() => text.insert(text.length, " local"), localOrigin);
    document.transact(() => text.insert(text.length, " ai"), aiOrigin);
    undo.undo();
    expect(text.toString()).toContain(" ai");
    expect(text.toString()).not.toContain(" local");
    undo.destroy();
  });

  it("resolves every action/control through mergeable, lease, or claim policy", () => {
    collaborationPolicyRegistry.assertEveryRegisteredActionResolves();
    expect(
      collaborationPolicyRegistry.resolve({
        workType: "document",
        control: "richtext",
      }),
    ).toEqual({ mode: "mergeable", sharedType: "xml" });
    expect(
      collaborationPolicyRegistry.resolve({
        workType: "sheets",
        control: "gridCell",
      }),
    ).toMatchObject({ mode: "interaction_lease", leaseScope: "field" });
    expect(
      collaborationPolicyRegistry.resolve({
        workType: "presentation",
        operation: "reorder",
      }),
    ).toMatchObject({ mode: "structural_claim", queueable: true });
    expect(
      collaborationPolicyRegistry.resolve({
        workType: "whiteboard",
        control: "canvasObject",
      }),
    ).toMatchObject({ mode: "interaction_lease", release: "pointer_up" });
  });

  it("resumes AI from release subscription after idle re-resolution without polling", async () => {
    const subscriptions = new LeaseReleaseSubscriptions();
    const resumed = waitForActorRelease(subscriptions, {
      targetId: "/slides/slide-1/objects/object-1",
      idleThresholdMs: 0,
      resolveTarget: () => ({ id: "object-1", x: 40 }),
      isStillRelevant: (target) => target.x === 40,
    });
    subscriptions.release({
      targetId: "/slides/slide-1/objects/object-1",
      leaseId: "lease-1",
      releasedAt: Date.now(),
      reason: "pointer_up",
    });
    await expect(resumed).resolves.toMatchObject({
      kind: "resume",
      target: { id: "object-1" },
    });

    const replanned = waitForActorRelease(subscriptions, {
      targetId: "/tasks/task-1/status",
      idleThresholdMs: 0,
      resolveTarget: () => null,
      isStillRelevant: () => true,
    });
    subscriptions.release({
      targetId: "/tasks/task-1/status",
      leaseId: "lease-2",
      releasedAt: Date.now(),
      reason: "commit",
    });
    await expect(replanned).resolves.toMatchObject({
      kind: "replan",
      reason: "target_missing_after_wait",
    });
  });

  it("restores offline edits, evicts only durable work, and never blocks editing on persistence", async () => {
    class DelayedStore implements LocalYjsStore {
      readonly base = new MemoryYjsStore();
      release: (() => void) | null = null;
      get(key: string) {
        return this.base.get(key);
      }
      async put(record: LocalYjsRecord) {
        await new Promise<void>((resolve) => {
          this.release = resolve;
        });
        await this.base.put(record);
      }
      delete(key: string) {
        return this.base.delete(key);
      }
      list() {
        return this.base.list();
      }
      listMeta() {
        return this.base.listMeta();
      }
    }
    const store = new DelayedStore();
    const document = codeYjsAdapter.createDocument(
      defaultContent("code") as Parameters<
        typeof codeYjsAdapter.createDocument
      >[0],
    );
    const persistence = new BoundedYjsLocalPersistence({
      key: "work:code-1:root",
      document,
      modelVersion: 2,
      store,
      debounceMs: 60_000,
    });
    await persistence.initialize();
    const text = codeFileText(document, "file-main")!;
    text.insert(text.length, " offline");
    const pending = persistence.persistNow();
    expect(text.toString()).toContain("offline");
    expect(persistence.getSnapshot().pendingRemoteSync).toBe(true);
    await vi.waitFor(() => {
      expect(store.release).toEqual(expect.any(Function));
    });
    store.release?.();
    await pending;
    persistence.destroy();

    const restored = new Y.Doc();
    const second = new BoundedYjsLocalPersistence({
      key: "work:code-1:root",
      document: restored,
      modelVersion: 2,
      store,
      debounceMs: 0,
    });
    await second.initialize();
    expect(codeFileText(restored, "file-main")?.toString()).toContain(
      "offline",
    );
    expect(second.getSnapshot()).toMatchObject({
      restored: true,
      pendingRemoteSync: true,
    });
    second.destroy();
  });

  it("refuses to persist a pending collapse over a durable local copy", () => {
    expect(
      shouldRefuseCollapsedLocalPersist(
        { bytes: 8000, pendingRemoteSync: false },
        1000,
        true,
      ),
    ).toBe(true);
    expect(
      shouldRefuseCollapsedLocalPersist(
        { bytes: 8000, pendingRemoteSync: false },
        5000,
        true,
      ),
    ).toBe(false);
    expect(
      shouldRefuseCollapsedLocalPersist(
        { bytes: 8000, pendingRemoteSync: true },
        1000,
        true,
      ),
    ).toBe(false);
    expect(shouldRefuseCollapsedLocalPersist(null, 1000, true)).toBe(false);
  });

  it("keeps native serialization bounded and statically guards focused document resets", async () => {
    const document = codeYjsAdapter.createDocument(
      defaultContent("code") as Parameters<
        typeof codeYjsAdapter.createDocument
      >[0],
    );
    const text = codeFileText(document, "file-main")!;
    text.insert(text.length, "x".repeat(200_000));
    const started = performance.now();
    const update = Y.encodeStateAsUpdate(document);
    expect(performance.now() - started).toBeLessThan(250);
    expect(update.byteLength).toBeLessThan(260_000);

    const source = await readFile(
      new URL("../components/document-studio.tsx", import.meta.url),
      "utf8",
    );
    const blockIdSource = await readFile(
      new URL("../editor/stable-block-id.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("missingNativeBlockIds");
    expect(source).toContain("NATIVE_PROJECTION_TRANSACTION_META");
    expect(source).toContain("Collaboration.configure");
    expect(blockIdSource).toContain("isYjsOriginDocumentTransaction");
  });
});
