import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  nativeOfficeDraftPending,
  writeStudioDirty,
} from "../components/native-office-draft";

describe("nativeOfficeDraftPending", () => {
  it("keeps a native Office draft pending after the live model echoes the local edit", () => {
    expect(
      nativeOfficeDraftPending({
        nativeOfficeDocument: true,
        userHasEdited: true,
        snapshotsDiffer: false,
      }),
    ).toBe(true);
  });

  it("clears once the human-edit flag is consumed by a real save", () => {
    expect(
      nativeOfficeDraftPending({
        nativeOfficeDocument: true,
        userHasEdited: false,
        snapshotsDiffer: false,
      }),
    ).toBe(false);
  });

  it("does not treat matching snapshots as dirty for non-Office collaborative artifact", () => {
    expect(
      nativeOfficeDraftPending({
        nativeOfficeDocument: false,
        userHasEdited: true,
        snapshotsDiffer: false,
      }),
    ).toBe(false);
  });

  it("still marks an unsaved React snapshot dirty for non-Office artifact", () => {
    expect(
      nativeOfficeDraftPending({
        nativeOfficeDocument: false,
        userHasEdited: true,
        snapshotsDiffer: true,
      }),
    ).toBe(true);
  });

  it("is wired into the studio dirty derivation so Yjs echoes cannot skip materialize", () => {
    const source = readFileSync(
      "src/features/spectra/components/artifact-studio.tsx",
      "utf8",
    );
    expect(source).toContain("nativeOfficeDraftPending");
    expect(source).toContain("writeStudioDirty");
    expect(source).toContain("localDraftEpoch");
    expect(source).toContain("decideRemoteStudioIncoming");
    expect(source).toContain("nativeOfficeDocument");
    expect(source).toContain(
      "if (!userInitiated && reconcilingRemoteRef.current) return",
    );
    expect(source).toContain("nativeBodyBinding ? null : content");
  });

  it("does not setState when the dirty ref already matches", () => {
    const dirtyRef = { current: true };
    const calls: boolean[] = [];
    writeStudioDirty(dirtyRef, (dirty) => calls.push(dirty), true);
    expect(calls).toEqual([]);
    writeStudioDirty(dirtyRef, (dirty) => calls.push(dirty), false);
    expect(dirtyRef.current).toBe(false);
    expect(calls).toEqual([false]);
  });

  it("marks the Word editor ready on the same DOM events that produce keystrokes", () => {
    const source = readFileSync(
      "src/features/spectra/components/document-studio.tsx",
      "utf8",
    );
    expect(source).toContain("handleDOMEvents");
    expect(source).toContain("editorReadyForUserChanges.current = true");
    expect(source).toContain("editor?.isInitialized");
    expect(source).toContain("lastDecorationKeyRef");
    expect(source).toContain('setMeta("addToHistory", false)');
    expect(source).toContain("onLocalCollaborativeChangeRef");
  });
});
