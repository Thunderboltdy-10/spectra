import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  isPresentationReady,
  locationLabel,
  presentSync,
  replicaDisclosure,
  selectSyncTruth,
} from "../bridge/status";
import { humanizePublicFailure } from "../bridge/humanize";

describe("sync presentation (P1.I3)", () => {
  it("treats saved-locally as ready so a verified device copy does not block checkpoints", () => {
    const presentation = presentSync({
      replicas: [{ kind: "local", state: "current", lastVerifiedAt: 1 }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
    });
    expect(presentation.key).toBe("saved-locally");
    expect(presentation.label).toBe("Saved locally");
    expect(presentation.ready).toBe(true);
    expect(isPresentationReady(presentation.key)).toBe(true);
  });

  it("speaks Offline when the browser is offline even with nothing queued", () => {
    const presentation = presentSync({
      replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: 1 }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: false,
    });
    expect(presentation.key).toBe("offline");
    expect(presentation.label).toBe("Offline");
    expect(presentation.ready).toBe(false);
  });

  it("counts dirty work as queued while offline", () => {
    const presentation = presentSync({
      replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: 1 }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: false,
      dirty: true,
    });
    expect(presentation.label).toBe("Offline · 1 change");
  });

  it("says Edit conflict when copies diverged with no open conflict rows", () => {
    expect(
      selectSyncTruth({
        replicas: [{ kind: "cloud", state: "diverged" }],
        openConflictCount: 0,
        pendingCount: 0,
      }).label,
    ).toBe("Edit conflict");
    expect(
      presentSync({
        replicas: [{ kind: "local", state: "diverged" }],
        openConflictCount: 0,
        replicaPendingCount: 0,
        online: true,
      }).label,
    ).toBe("Edit conflict");
  });

  it("never puts a machine error code in the spoken detail", () => {
    const presentation = presentSync({
      replicas: [
        {
          kind: "local",
          state: "error",
          errorCode: "LOCAL_REPLICA_UNAVAILABLE",
        },
      ],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
    });
    expect(presentation.detail).not.toMatch(/LOCAL_REPLICA_UNAVAILABLE/);
    expect(presentation.detail).not.toMatch(/[A-Z]{3,}_[A-Z0-9_]{3,}/);
  });

  it("discloses copies in plain words without Current", () => {
    const lines = replicaDisclosure(
      [{ kind: "local", state: "current", lastVerifiedAt: Date.now() }],
      Date.now(),
    );
    expect(lines.join(" ")).not.toMatch(/\bCurrent\b/);
    expect(lines[0]).toContain("This device · Up to date");
  });

  it("never says Up to date of a file Word still holds", () => {
    const lines = replicaDisclosure(
      [
        {
          kind: "local",
          state: "current",
          lastVerifiedAt: Date.now() - 9 * 60_000,
          errorCode: "office-locked",
        },
      ],
      Date.now(),
    );
    expect(lines[0]).toContain("Waiting for Office to finish saving");
    expect(lines[0]).not.toContain("Up to date");
    const presentation = presentSync({
      replicas: [
        {
          kind: "local",
          state: "current",
          lastVerifiedAt: 1,
          errorCode: "office-locked",
        },
      ],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
    });
    expect(presentation.label).toBe("Waiting for Office");
    expect(presentation.ready).toBe(false);
  });

  it("says a change waits for a paused folder instead of promising a retry", () => {
    const paused = { kind: "local" as const, state: "pending" as const, retryAt: 1, errorCode: "folder-paused" };
    expect(replicaDisclosure([paused], Date.now())).toEqual(["This device · Paused on this computer"]);
    const presentation = presentSync({ replicas: [paused], openConflictCount: 0, replicaPendingCount: 0, online: true });
    expect(presentation.detail).toBe("This folder is paused on this computer. Spectra saves the change when you resume it.");
    expect(presentation.detail).not.toMatch(/folder-paused|retry/i);
  });

  it("says queued and where the file lives when Bridge is down during a native write", () => {
    const presentation = presentSync({
      replicas: [
        { kind: "local", state: "pending" },
        { kind: "cloud", state: "current", lastVerifiedAt: 1 },
      ],
      openConflictCount: 0,
      replicaPendingCount: 1,
      nativeActivity: true,
      nativeBridgeAvailable: false,
      online: true,
    });
    expect(presentation.label).toBe("Queued");
    expect(presentation.detail).toContain("lives on your PC");
    expect(presentation.detail).toContain("queued safely");
    expect(presentation.ready).toBe(false);
  });

  it("does not call a This-PC file Unavailable when the local copy is current", () => {
    const presentation = presentSync({
      replicas: [
        { kind: "local", state: "current", lastVerifiedAt: 1 },
        { kind: "cloud", state: "unavailable", unavailableReason: "metadata-only" },
      ],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
    });
    expect(presentation.label).not.toBe("Unavailable on this device");
    expect(presentation.key).toBe("saved-locally");
    expect(presentation.ready).toBe(true);
  });

  it("keeps Location and replica availability on the same places", () => {
    expect(
      locationLabel([
        { kind: "local", state: "current" },
        { kind: "cloud", state: "unavailable" },
      ]),
    ).toBe("This device");
    expect(
      replicaDisclosure(
        [
          { kind: "local", state: "current", lastVerifiedAt: Date.now() },
          { kind: "cloud", state: "unavailable" },
        ],
        Date.now(),
      ).join(" "),
    ).toContain("Spectra · Not available here");
  });

  it("mounts the product Offline banner on AppShell so Settings sees it", () => {
    const root = process.cwd();
    const appShell = fs.readFileSync(
      path.join(root, "src/components/layout/app-shell.tsx"),
      "utf8",
    );
    const workbench = fs.readFileSync(
      path.join(root, "src/features/spectra/pages/spectra-shell.tsx"),
      "utf8",
    );
    const settings = fs.readFileSync(
      path.join(root, "src/app/settings/page.tsx"),
      "utf8",
    );
    expect(appShell).toContain("<ProductOfflineBanner");
    expect(workbench).not.toContain("ProductOfflineBanner");
    expect(settings).toContain("<AppShell");
    const settingsApp = fs.readFileSync(
      path.join(root, "src/features/spectra/settings/ui/settings-application.tsx"),
      "utf8",
    );
    const bridgeSettings = fs.readFileSync(
      path.join(root, "src/features/spectra/devices/devices-page.tsx"),
      "utf8",
    );
    const errorBoundary = fs.readFileSync(
      path.join(root, "src/components/global-error-boundary.tsx"),
      "utf8",
    );
    expect(settingsApp).toContain("IsolatedErrorBoundary");
    expect(bridgeSettings).toContain('cloudEnabled ? {} : "skip"');
    expect(errorBoundary).toContain("humanizePublicFailure");
    expect(errorBoundary).not.toContain("this.state.error.message");
    const convexAuth = [
      "[CONVEX Q(syncPolicy:effective)] [Request ID: 681785b0f916633b] Server Error Uncaught Error: AUTH_NOT_SIGNED_IN: Sign in to continue.",
    ];
    expect(humanizePublicFailure(convexAuth[0])).not.toMatch(/Request ID|AUTH_NOT_SIGNED_IN|syncPolicy:effective/i);
    const keepSpectra = "[Request ID: 275e55f7015f4512] Server Error\nUncaught Error: CONFLICT_RESOLUTION_WRITE_REQUIRED\n    at handler (../convex/replicas.ts:1272:12)";
    expect(humanizePublicFailure(keepSpectra, "Word")).toContain("Nothing was overwritten");
    expect(humanizePublicFailure(keepSpectra, "Word")).not.toMatch(/Request ID|CONFLICT_RESOLUTION_WRITE_REQUIRED|replicas\.ts/i);
  });

  it("offers Reconnect when the local copy is unavailable", () => {
    const presentation = presentSync({
      replicas: [{ kind: "local", state: "unavailable" }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
    });
    expect(presentation.action?.kind).toBe("reconnect");
    expect(presentation.action?.label).toBe("Reconnect");
  });

  it("names Read-don't-change as a shared refusal, not share-only access", () => {
    const presentation = presentSync({
      replicas: [{ kind: "local", state: "current", lastVerifiedAt: 1 }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
      readOnly: true,
      protectedOriginal: true,
    });
    expect(presentation.label).toBe("Read-only");
    expect(presentation.detail).toBe(
      "Spectra can read these files but will never change them.",
    );
    expect(presentation.detail).not.toMatch(/edit access/i);
  });

  it("opens a sign-in door for a stale collaboration session without machine tokens", () => {
    const presentation = presentSync({
      replicas: [{ kind: "cloud", state: "current", lastVerifiedAt: 1 }],
      openConflictCount: 0,
      replicaPendingCount: 0,
      online: true,
      transportState: "unsynchronized",
      transportError:
        "[Request ID: 681785b0f916633b] Server Error Uncaught Error: AUTH_NOT_SIGNED_IN: Sign in to continue.",
    });
    expect(presentation.label).toBe("Sign in to continue");
    expect(presentation.action).toEqual({ label: "Sign in", kind: "sign-in" });
    expect(`${presentation.label} ${presentation.detail}`).not.toMatch(
      /Request ID|AUTH_NOT_SIGNED_IN|681785b0f916633b/i,
    );
  });
});
