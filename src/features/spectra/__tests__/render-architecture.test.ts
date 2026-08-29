import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { CollaborationPresence } from "../collaboration/types";
import type { InteractionState } from "../collaboration/interaction-model";
import {
  EMPTY_PRESENCE,
  ScopedCollaborationSnapshots,
} from "../collaboration/scoped-snapshots";
import { producePresentationContent } from "../presentation/model";
import type { PresentationContent } from "../presentation/model";
import {
  BoundedYjsLocalPersistence,
  MemoryYjsStore,
} from "../realtime/persistence/local-yjs-persistence";

function person(
  clientId: string,
  extras: Partial<CollaborationPresence> = {},
): CollaborationPresence {
  return {
    clientId,
    name: clientId,
    cursor: { x: 12, y: 24 },
    ...extras,
  };
}

function typingAt(path: string): InteractionState {
  return {
    v: 2,
    actor: { clientId: "peer", kind: "human", name: "Peer" },
    act: { kind: "type", point: { offset: 0 } },
    lifecycle: "active",
    target: {
      artifactId: "work-1",
      path,
      primitive: "richtext",
    },
    at: 1,
  };
}

function deck(): PresentationContent {
  return {
    theme: { id: "theme" },
    slides: [
      {
        id: "s1",
        title: "One",
        objects: [
          {
            id: "o1",
            type: "text",
            x: 40,
            y: 40,
            width: 200,
            height: 80,
            rotation: 0,
            content: "Hello",
          },
        ],
      },
      {
        id: "s2",
        title: "Two",
        objects: [
          {
            id: "o2",
            type: "shape",
            x: 80,
            y: 80,
            width: 120,
            height: 120,
            rotation: 0,
            content: null,
          },
        ],
      },
    ],
  };
}

describe("scoped collaboration snapshots (PERF-3)", () => {
  it("notifies presence listeners, not sync, when only the cursor moves", () => {
    const snapshots = new ScopedCollaborationSnapshots({ state: "synchronized" });
    let sync = 0;
    let presence = 0;
    let preview = 0;
    snapshots.subscribeSync(() => {
      sync += 1;
    });
    snapshots.subscribePresence(() => {
      presence += 1;
    });
    snapshots.subscribePresencePreview(() => {
      preview += 1;
    });

    snapshots.apply({ presence: [person("peer", { cursor: { x: 1, y: 1 } })] });
    expect(sync).toBe(0);
    expect(presence).toBe(1);
    expect(preview).toBe(1);

    const previewBefore = snapshots.getPresencePreviewSnapshot();
    snapshots.apply({ presence: [person("peer", { cursor: { x: 88, y: 12 } })] });
    expect(sync).toBe(0);
    expect(presence).toBe(2);
    expect(preview).toBe(1);
    expect(snapshots.getPresencePreviewSnapshot()).toBe(previewBefore);
    expect(snapshots.getPresenceSnapshot()[0]?.cursor?.x).toBe(88);
  });

  it("rebuilds the preview identity when the target path or speculation changes", () => {
    const snapshots = new ScopedCollaborationSnapshots({ state: "synchronized" });
    let preview = 0;
    snapshots.subscribePresencePreview(() => {
      preview += 1;
    });
    snapshots.apply({
      presence: [person("peer", { interactionState: typingAt("/slides/0") })],
    });
    const first = snapshots.getPresencePreviewSnapshot();
    snapshots.apply({
      presence: [person("peer", { interactionState: typingAt("/slides/1") })],
    });
    const second = snapshots.getPresencePreviewSnapshot();
    expect(preview).toBe(2);
    expect(second).not.toBe(first);
    expect(second.signature).not.toBe(first.signature);
    expect(second.people[0]?.interactionState?.target?.path).toBe("/slides/1");
  });

  it("does not treat an empty presence array as a new identity every sync tick", () => {
    const snapshots = new ScopedCollaborationSnapshots({ state: "connecting" });
    let presence = 0;
    snapshots.subscribePresence(() => {
      presence += 1;
    });
    snapshots.apply({
      presence: [person("peer", { cursor: { x: 1, y: 1 } })],
    });
    snapshots.apply({ presence: [] });
    expect(presence).toBe(2);
    expect(snapshots.getPresenceSnapshot()).toBe(EMPTY_PRESENCE);
    snapshots.apply({ unsynchronizedChanges: 1, presence: [] });
    snapshots.apply({ unsynchronizedChanges: 2, presence: [] });
    expect(presence).toBe(2);
  });
});

describe("presentation structural sharing (PERF-1)", () => {
  it("keeps untouched slides and objects by identity when one object moves", () => {
    const original = deck();
    const untouchedSlide = original.slides[1]!;
    const moved = original.slides[0]!.objects[0]!;
    const next = producePresentationContent(original, (draft) => {
      const object = draft.slides[0]?.objects[0];
      if (object) object.x = 96;
    });
    expect(next).not.toBe(original);
    expect(next.slides[1]).toBe(untouchedSlide);
    expect(next.slides[0]?.objects[0]).not.toBe(moved);
    expect(next.slides[0]?.objects[0]?.x).toBe(96);
  });

  it("returns the original deck when the recipe changes nothing", () => {
    const original = deck();
    const next = producePresentationContent(original, () => undefined);
    expect(next).toBe(original);
  });
});

describe("local Yjs persistence equality (PERF-5)", () => {
  it("does not emit a new durability snapshot for every Y update while already persisting", async () => {
    const store = new MemoryYjsStore();
    const document = new Y.Doc();
    const persistence = new BoundedYjsLocalPersistence({
      key: "work:render-arch:root",
      document,
      modelVersion: 1,
      store,
      debounceMs: 60_000,
    });
    await persistence.initialize();
    const seen: Array<ReturnType<typeof persistence.getSnapshot>> = [];
    persistence.subscribe(() => {
      seen.push(persistence.getSnapshot());
    });
    const text = document.getText("body");
    text.insert(0, "a");
    text.insert(1, "b");
    text.insert(2, "c");
    const first = seen[0];
    expect(seen.length).toBe(1);
    expect(first?.state).toBe("persisting");
    expect(seen.every((snapshot) => snapshot === first)).toBe(true);
    persistence.destroy();
  });
});

describe("named keystroke and overflow kills", () => {
  it("stops collab document updates from getJSON/stringify and drops refreshToolbar", () => {
    const source = readFileSync(
      "src/features/spectra/components/document-studio.tsx",
      "utf8",
    );
    expect(source).not.toContain("refreshToolbar");
    expect(source).toContain("if (collaborationDocument) {");
    expect(source).toContain("onLocalCollaborativeChangeRef.current?.()");
    const collabBranch = source.slice(
      source.indexOf("if (collaborationDocument) {"),
      source.indexOf("const nextJson = editor.getJSON();"),
    );
    expect(collabBranch).toContain("return;");
    expect(collabBranch).not.toContain("getJSON");
    expect(collabBranch).not.toContain("JSON.stringify");
  });

  it("commits sheets by structural identity instead of serializing the workbook", () => {
    const source = readFileSync(
      "src/features/spectra/components/sheets-studio.tsx",
      "utf8",
    );
    expect(source).toContain("function workbookIdentityKey");
    expect(source).toContain("function sameContent");
    const commit = source.slice(
      source.indexOf("const commit = useCallback"),
      source.indexOf("const showSheet = useCallback"),
    );
    expect(commit).toContain("sameContent(current, next)");
    expect(commit).not.toContain("JSON.stringify");
  });

  it("does not clone the deck on presentation pointermove", () => {
    const source = readFileSync(
      "src/features/spectra/components/presentation-studio.tsx",
      "utf8",
    );
    const moveDrag = source.slice(
      source.indexOf("function moveDrag"),
      source.indexOf("function finishDrag"),
    );
    expect(moveDrag).toContain("mutateLocal");
    expect(moveDrag).not.toContain("cloneDeck");
  });
});
