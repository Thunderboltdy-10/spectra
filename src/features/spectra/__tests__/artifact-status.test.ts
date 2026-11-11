import { describe, expect, it } from "vitest";
import { presentSync, type PresentSyncInput, type ReplicaTruth } from "../bridge/status";
import {
  artifactStatusOf,
  fileNameOf,
  folderTrailOf,
  savedAgo,
  statusMoment,
  type ArtifactStatusInput,
  type ArtifactStatusReplica,
} from "../components/artifact-status";

/*
 * The status control's states, from EDITORS.md's table, read from the same
 * presenter the rest of the app uses. Every row of the table is one test.
 */

const NOW = 1_800_000_000_000;
const ALL_ACTIONS = {
  retry: true,
  "sign-in": true,
  reconnect: true,
  "keep-spectra": true,
  "keep-office": true,
  compare: true,
  history: true,
  "open-in-office": true,
  "show-in-folder": true,
} as const;

function status(
  sync: Partial<PresentSyncInput> & { replicas?: ArtifactStatusReplica[] },
  extra: Partial<ArtifactStatusInput> = {},
) {
  const replicas = sync.replicas ?? [{ kind: "cloud", state: "current", lastVerifiedAt: NOW - 120_000 }];
  const presentation = presentSync({
    openConflictCount: 0,
    replicaPendingCount: 0,
    online: true,
    ...sync,
    replicas: replicas as ReplicaTruth[],
  });
  return artifactStatusOf({ presentation, replicas, now: NOW, can: ALL_ACTIONS, ...extra });
}

const LOCAL: ArtifactStatusReplica = {
  kind: "local",
  state: "current",
  lastVerifiedAt: NOW - 120_000,
  relativePath: "Biology/Essay.docx",
};

describe("the status control's states", () => {
  it("is quiet when saved: the saved glyph, no words, the time and place on hover", () => {
    const saved = status(
      { replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: NOW - 120_000 }, LOCAL] },
      { folderLabel: "Documents", officeApplication: "Word" },
    );
    expect(saved.state).toBe("saved");
    expect(saved.glyph).toBe("saved");
    expect(saved.words).toBeUndefined();
    expect(saved.running).toBe(false);
    expect(saved.sentence).toBe("Saved 2 min ago, and on this computer in Documents › Biology.");
    expect(saved.facts).toEqual([
      { label: "Last saved", value: "2 min ago" },
      { label: "Desktop file", value: "Essay.docx" },
      { label: "Where", value: "This computer · Documents › Biology" },
    ]);
    expect(saved.actions.map((action) => action.kind)).toEqual(["open-in-office", "show-in-folder", "history"]);
  });

  it("says Saving while a save runs, and the glyph keeps filling", () => {
    const saving = status({ dirty: true });
    expect(saving.state).toBe("saving");
    expect(saving.glyph).toBe("saving");
    expect(saving.words).toBe("Saving");
    expect(saving.running).toBe(true);
  });

  it("stays Offline while offline, with the changes kept on this device", () => {
    const offline = status({ online: false, queuedChangeCount: 2 });
    expect(offline.state).toBe("offline");
    expect(offline.glyph).toBe("offline");
    expect(offline.words).toBe("Offline");
    expect(offline.sentence).toMatch(/queued until this device reconnects/);
  });

  it("names the desktop file while it updates", () => {
    const syncing = status({ replicas: [{ kind: "cloud", state: "current" }, LOCAL], nativeActivity: true, nativeBridgeAvailable: true });
    expect(syncing.state).toBe("syncing");
    expect(syncing.glyph).toBe("syncing");
    expect(syncing.words).toBe("Updating file");
    expect(syncing.running).toBe(true);
  });

  it("waits for Office in the needs-you hue, and says where the file is open", () => {
    const waiting = status(
      { replicas: [{ ...LOCAL, state: "pending", errorCode: "office-locked" }], nativeBridgeAvailable: true },
      { officeApplication: "Word" },
    );
    expect(waiting.state).toBe("waitingOffice");
    expect(waiting.glyph).toBe("locked");
    expect(waiting.hue).toBe("var(--warning)");
    expect(waiting.words).toBe("Open in Word");
    expect(waiting.facts).toContainEqual({ label: "In use", value: "Open in Word on this computer" });
  });

  it("is Read only for someone who can only look", () => {
    const readOnly = status({ readOnly: true });
    expect(readOnly.state).toBe("readOnly");
    expect(readOnly.glyph).toBe("readOnly");
    expect(readOnly.words).toBe("Read only");
  });

  it("shows Two versions in the problem hue, with keep and compare first", () => {
    const versions = status({ replicas: [LOCAL] }, { nativeConflict: true, officeApplication: "Word" });
    expect(versions.state).toBe("versions");
    expect(versions.glyph).toBe("versions");
    expect(versions.hue).toBe("var(--danger)");
    expect(versions.words).toBe("Two versions");
    expect(versions.actions.slice(0, 3).map((action) => action.label)).toEqual([
      "Keep this version",
      "Keep the Word version",
      "Compare",
    ]);
  });

  it("puts a problem in one plain line and offers to try again", () => {
    const problem = status({ replicas: [{ kind: "cloud", state: "error", errorCode: "network" }] });
    expect(problem.state).toBe("problem");
    expect(problem.words).toBe("Couldn't save");
    expect(problem.actions[0]).toEqual({ kind: "retry", label: "Try again" });
  });

  it("says it is retrying when Spectra will try again by itself", () => {
    const retrying = status({ replicas: [{ kind: "cloud", state: "pending", retryAt: NOW + 5_000, errorCode: "network" }] });
    expect(retrying.state).toBe("problem");
    expect(retrying.words).toBe("Couldn't save. Retrying");
    expect(retrying.running).toBe(true);
  });

  it("only offers actions the surface can carry out", () => {
    const saved = artifactStatusOf({
      presentation: presentSync({ replicas: [LOCAL as ReplicaTruth], openConflictCount: 0, replicaPendingCount: 0, online: true }),
      replicas: [LOCAL],
      officeApplication: "Word",
      now: NOW,
      can: { history: true },
    });
    expect(saved.actions).toEqual([{ kind: "history", label: "Version history" }]);
  });
});

describe("the status control's words", () => {
  it("says time like a person", () => {
    expect(savedAgo(NOW - 5_000, NOW)).toBe("just now");
    expect(savedAgo(NOW - 61_000, NOW)).toBe("1 min ago");
    expect(savedAgo(NOW - 3 * 3_600_000, NOW)).toBe("3 hr ago");
    expect(savedAgo(NOW - 26 * 3_600_000, NOW)).toBe("yesterday");
    expect(savedAgo(NOW - 4 * 86_400_000, NOW)).toBe("4 days ago");
  });

  it("never shows a path: a file name and a short folder trail", () => {
    expect(fileNameOf("Biology\\Unit 3\\Essay.docx")).toBe("Essay.docx");
    expect(folderTrailOf("Documents", "Essay.docx")).toBe("Documents");
    expect(folderTrailOf("Documents", "School/Biology/Unit 3/Essay.docx")).toBe("Documents › … › Unit 3");
    expect(folderTrailOf(undefined, undefined)).toBeUndefined();
  });
});

describe("the status control's life moments", () => {
  it("settles when a save lands, alarms on a problem, and asks on Office", () => {
    expect(statusMoment(null, "saved")).toBeNull();
    expect(statusMoment("saving", "saved")).toBe("settle");
    expect(statusMoment("syncing", "saved")).toBe("settle");
    expect(statusMoment("saved", "problem")).toBe("alarm");
    expect(statusMoment("saving", "versions")).toBe("alarm");
    expect(statusMoment("saving", "waitingOffice")).toBe("attention");
    expect(statusMoment("saved", "saving")).toBeNull();
  });
});

describe("a file deleted outside Spectra", () => {
  const GONE: ArtifactStatusReplica & ReplicaTruth = { kind: "local", state: "unavailable", unavailableReason: "missing-on-disk", relativePath: "Biology/Essay.docx" };

  it("says the file is gone, keeps the work, and offers one way to put it back", () => {
    const presentation = presentSync({ replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: NOW }, GONE], openConflictCount: 0, replicaPendingCount: 0, online: true });
    expect(presentation).toMatchObject({ key: "file-gone", label: "File deleted", action: { label: "Put it back", kind: "put-back" } });
    expect(presentation.detail).toBe("The file was deleted or moved out of its folder on this computer. This work is still here in Spectra.");
    const gone = status({ replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: NOW }, GONE] }, { can: { ...ALL_ACTIONS, "put-back": true } });
    expect(gone.words).toBe("File deleted");
    expect(gone.actions[0]).toEqual({ kind: "put-back", label: "Put it back" });
  });

  it("stays quiet when the file only moved, or is on another computer", () => {
    const moved = presentSync({ replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: NOW }, GONE, { kind: "local", state: "current", lastVerifiedAt: NOW }], openConflictCount: 0, replicaPendingCount: 0, online: true });
    expect(moved.key).not.toBe("file-gone");
    const elsewhere = presentSync({ replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: NOW }, { ...GONE, unavailableReason: "not-on-this-computer" }], openConflictCount: 0, replicaPendingCount: 0, online: true });
    expect(elsewhere.key).not.toBe("file-gone");
  });
});
