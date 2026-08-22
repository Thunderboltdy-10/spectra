import { describe, expect, it } from "vitest";
import {
  POLICY_PRESETS,
  collisionSafeRelativePath,
  decideStructureOperation,
  decideMissingResourceAction,
  initialStructureRequestState,
  SYNC_POLICY_SCOPE_PRECEDENCE,
  policyAllowsTrigger,
  policyIncludesPath,
  resolveEffectivePolicy,
  structurePropagates,
  type ScopedSyncPolicy,
  type SyncPolicyScopeKind,
} from "../../../../shared/sync-policy";
import { planStorageStrategyTransition } from "../../../../shared/storage-strategy";

function policy(
  scopeKind: SyncPolicyScopeKind,
  scopeId: string,
  preset: keyof typeof POLICY_PRESETS,
): ScopedSyncPolicy {
  return { ...POLICY_PRESETS[preset], scopeKind, scopeId };
}

describe("N6 effective sync policy", () => {
  it("uses the one item > folder > workspace > mount > account lattice", () => {
    const policies = [
      policy("account", "a", "spectra"),
      policy("mount", "m", "device"),
      policy("workspace", "w", "both"),
      policy("folder", "f", "linked"),
      policy("item", "i", "device"),
    ];
    expect(SYNC_POLICY_SCOPE_PRECEDENCE).toEqual([
      "item",
      "folder",
      "workspace",
      "mount",
      "account",
    ]);
    expect(
      resolveEffectivePolicy(
        { account: "a", mount: "m", workspace: "w", folder: "f", item: "i" },
        policies,
      ),
    ).toMatchObject({ preset: "device", source: { kind: "item", id: "i" } });
  });

  it("is deterministic across policy insertion order", () => {
    let seed = 0x51ced;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let run = 0; run < 500; run += 1) {
      const policies = SYNC_POLICY_SCOPE_PRECEDENCE.filter(() => random() > 0.35).map(
        (kind, index) =>
          policy(kind, `${kind}-${run}`, (["spectra", "device", "both", "linked"] as const)[index % 4]!),
      );
      const scopes = Object.fromEntries(
        SYNC_POLICY_SCOPE_PRECEDENCE.map((kind) => [kind, `${kind}-${run}`]),
      );
      const expected = resolveEffectivePolicy(scopes, policies);
      expect(resolveEffectivePolicy(scopes, [...policies].reverse())).toEqual(expected);
      expect(resolveEffectivePolicy(scopes, [...policies].sort(() => random() - 0.5))).toEqual(expected);
    }
  });

  it("enforces include/exclude filters and timing without UI interpretation", () => {
    const filters = { includeGlobs: ["Physics/**", "*.docx"], excludeGlobs: ["**/~$*"] };
    expect(policyIncludesPath(filters, "Physics/IA/report.docx")).toBe(true);
    expect(policyIncludesPath(filters, "Physics/~$report.docx")).toBe(false);
    expect(policyIncludesPath(filters, "notes.txt")).toBe(false);
    expect(policyAllowsTrigger("manual", "watch")).toBe(false);
    expect(policyAllowsTrigger("manual", "manual")).toBe(true);
    expect(policyAllowsTrigger("on-save-open", "save")).toBe(true);
  });

  it("defines structure propagation once for both directions", () => {
    expect(structurePropagates("independent", "spectra-to-disk")).toBe(false);
    expect(structurePropagates("mirror-to-disk", "spectra-to-disk")).toBe(true);
    expect(structurePropagates("mirror-to-disk", "disk-to-spectra")).toBe(false);
    expect(structurePropagates("mirror-from-disk", "disk-to-spectra")).toBe(true);
    expect(structurePropagates("mirror-both", "disk-to-spectra")).toBe(true);
  });

  it("turns every structure mode into one explicit decision", () => {
    expect(decideStructureOperation("independent", "spectra-to-disk")).toBe("ignore");
    expect(decideStructureOperation("mirror-to-disk", "spectra-to-disk")).toBe("propagate");
    expect(decideStructureOperation("mirror-from-disk", "spectra-to-disk")).toBe("ignore");
    expect(decideStructureOperation("mirror-both", "disk-to-spectra")).toBe("propagate");
    expect(decideStructureOperation("ask", "spectra-to-disk")).toBe("ask");
  });

  it("resolves structure collisions deterministically without overwriting", () => {
    expect(collisionSafeRelativePath("Reports/final.docx", [])).toBe("Reports/final.docx");
    expect(collisionSafeRelativePath("Reports/final.docx", ["Reports/final.docx"])).toBe("Reports/final (Spectra 2).docx");
    expect(collisionSafeRelativePath("Reports/final.docx", ["Reports/final.docx", "Reports/final (Spectra 2).docx"])).toBe("Reports/final (Spectra 3).docx");
  });

  it("keeps physical deletion behind an explicit confirmation", () => {
    expect(initialStructureRequestState("propagate", "spectra-to-disk", "move")).toBe("pending");
    expect(initialStructureRequestState("propagate", "spectra-to-disk", "delete")).toBe("approval-required");
    expect(initialStructureRequestState("ask", "spectra-to-disk", "rename")).toBe("approval-required");
  });

  it("makes vanished-file outcomes policy-specific and truthful", () => {
    expect(decideMissingResourceAction("mirror-from-disk", true)).toBe("trash-in-spectra");
    expect(decideMissingResourceAction("mirror-to-disk", true)).toBe("restore-to-disk");
    expect(decideMissingResourceAction("independent", true)).toBe("keep-unavailable");
    expect(decideMissingResourceAction("ask", false)).toBe("ask");
  });
});

describe("storage strategy transitions", () => {
  const verifiedLocal = { hasCloud: true, cloudHasPayload: true, hasActiveLocal: true, localIsVerified: true, hasProtectedPending: false };

  it("keeps the logical item and unlinks without deleting the physical file", () => {
    expect(planStorageStrategyTransition("spectra", verifiedLocal)).toMatchObject({ localAction: "unlink", cloudAction: "retain", completion: "verified" });
  });
  it("requires a verified local replica for linked work", () => {
    expect(() => planStorageStrategyTransition("linked", { ...verifiedLocal, localIsVerified: false })).toThrow("STORAGE_STRATEGY_LOCAL_NOT_VERIFIED");
  });
  it("marks cloud-only to local transitions pending until Bridge verification", () => {
    expect(planStorageStrategyTransition("both", { ...verifiedLocal, hasActiveLocal: false })).toMatchObject({ localAction: "materialize", completion: "pending" });
  });
  it("never allows strategy removal while protected changes are pending", () => {
    expect(() => planStorageStrategyTransition("spectra", { ...verifiedLocal, hasProtectedPending: true })).toThrow("STORAGE_STRATEGY_PENDING_CHANGES");
  });
  it("keeps a local source active until a cloud payload is verified", () => {
    const plan = planStorageStrategyTransition("spectra", { ...verifiedLocal, cloudHasPayload: false });
    expect(plan).toMatchObject({
      localAction: "retain",
      requiresCloudMaterialization: true,
      completion: "pending",
    });
  });
  it("keeps device materialization pending until the Bridge verifies the local copy", () => {
    expect(planStorageStrategyTransition("device", {
      hasCloud: true,
      cloudHasPayload: true,
      hasActiveLocal: false,
      localIsVerified: false,
      hasProtectedPending: false,
    })).toMatchObject({
      localAction: "materialize",
      cloudAction: "metadata-only",
      completion: "pending",
    });
  });
  it("does not invent a cloud-only transition without a local source", () => {
    expect(() => planStorageStrategyTransition("spectra", {
      ...verifiedLocal,
      cloudHasPayload: false,
      hasActiveLocal: false,
    })).toThrow("STORAGE_STRATEGY_CLOUD_PAYLOAD_REQUIRED");
  });
  it("allows a verified local-only work to gain its first cloud replica", () => {
    expect(planStorageStrategyTransition("both", {
      hasCloud: false,
      cloudHasPayload: false,
      hasActiveLocal: true,
      localIsVerified: true,
      hasProtectedPending: false,
    })).toMatchObject({
      requiresCloudMaterialization: true,
      completion: "pending",
    });
    expect(planStorageStrategyTransition("spectra", {
      hasCloud: false,
      cloudHasPayload: false,
      hasActiveLocal: true,
      localIsVerified: true,
      hasProtectedPending: false,
    })).toMatchObject({
      requiresCloudMaterialization: true,
      completion: "pending",
    });
  });
  it("keeps every strategy transition explicit and monotonic", () => {
    const facts = {
      hasCloud: true,
      cloudHasPayload: true,
      hasActiveLocal: true,
      localIsVerified: true,
      hasProtectedPending: false,
    };
    for (const preset of ["spectra", "device", "both", "linked"] as const) {
      const plan = planStorageStrategyTransition(preset, facts);
      expect(plan.requiresLocal).toBe(preset !== "spectra");
      expect(plan.requiresCloud).toBe(preset !== "device");
      expect(plan.completion).toBe("verified");
      expect(plan.localAction).not.toBe("materialize");
    }
  });
});
