import { describe, expect, it } from "vitest";
import {
  POLICY_PRESETS,
  SYNC_POLICY_SCOPE_PRECEDENCE,
  policyAllowsTrigger,
  policyIncludesPath,
  resolveEffectivePolicy,
  structurePropagates,
  type ScopedSyncPolicy,
  type SyncPolicyScopeKind,
} from "../../../../shared/sync-policy";

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
});
