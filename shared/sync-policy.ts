export const SYNC_POLICY_SCOPE_PRECEDENCE = [
  "item",
  "folder",
  "workspace",
  "mount",
  "account",
] as const;

export type SyncPolicyScopeKind = (typeof SYNC_POLICY_SCOPE_PRECEDENCE)[number];
export type SyncPolicyPreset = "spectra" | "device" | "both" | "linked";
export type ContentDirection =
  | "local-to-spectra"
  | "spectra-to-local"
  | "bidirectional"
  | "manual";
export type DiscoveryMode = "auto" | "ask" | "explicit";
export type StructureMode =
  | "independent"
  | "mirror-to-disk"
  | "mirror-from-disk"
  | "mirror-both"
  | "ask";
export type CloudContentMode = "full" | "metadata-only" | "none";
export type SyncTiming = "continuous" | "on-save-open" | "manual";

export type SyncPolicyValues = {
  preset: SyncPolicyPreset;
  contentDirection: ContentDirection;
  discovery: DiscoveryMode;
  structure: StructureMode;
  cloudContent: CloudContentMode;
  localMirrorGrantId?: string;
  includeGlobs: string[];
  excludeGlobs: string[];
  timing: SyncTiming;
  protectedOriginal: boolean;
};

export type ScopedSyncPolicy = SyncPolicyValues & {
  scopeKind: SyncPolicyScopeKind;
  scopeId: string;
};

export type EffectiveSyncPolicy = SyncPolicyValues & {
  source:
    | { kind: SyncPolicyScopeKind; id: string }
    | { kind: "default"; id: "account" };
};

export const POLICY_PRESETS: Record<SyncPolicyPreset, SyncPolicyValues> = {
  spectra: {
    preset: "spectra",
    contentDirection: "manual",
    discovery: "explicit",
    structure: "independent",
    cloudContent: "full",
    includeGlobs: [],
    excludeGlobs: [],
    timing: "continuous",
    protectedOriginal: false,
  },
  device: {
    preset: "device",
    contentDirection: "local-to-spectra",
    discovery: "auto",
    structure: "independent",
    cloudContent: "metadata-only",
    includeGlobs: [],
    excludeGlobs: [],
    timing: "continuous",
    protectedOriginal: false,
  },
  both: {
    preset: "both",
    contentDirection: "bidirectional",
    discovery: "auto",
    structure: "independent",
    cloudContent: "full",
    includeGlobs: [],
    excludeGlobs: [],
    timing: "continuous",
    protectedOriginal: false,
  },
  linked: {
    preset: "linked",
    contentDirection: "manual",
    discovery: "explicit",
    structure: "independent",
    cloudContent: "metadata-only",
    includeGlobs: [],
    excludeGlobs: [],
    timing: "manual",
    protectedOriginal: true,
  },
};

export function resolveEffectivePolicy(
  scopes: Partial<Record<SyncPolicyScopeKind, string>>,
  policies: readonly ScopedSyncPolicy[],
): EffectiveSyncPolicy {
  for (const kind of SYNC_POLICY_SCOPE_PRECEDENCE) {
    const id = scopes[kind];
    if (!id) continue;
    const policy = policies.find(
      (candidate) => candidate.scopeKind === kind && candidate.scopeId === id,
    );
    if (!policy) continue;
    const { scopeKind, scopeId, ...values } = policy;
    return { ...values, source: { kind: scopeKind, id: scopeId } };
  }
  return {
    ...POLICY_PRESETS.spectra,
    source: { kind: "default", id: "account" },
  };
}

function globToRegExp(glob: string) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function policyIncludesPath(
  policy: Pick<SyncPolicyValues, "includeGlobs" | "excludeGlobs">,
  relativePath: string,
) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const included =
    policy.includeGlobs.length === 0 ||
    policy.includeGlobs.some((glob) => globToRegExp(glob).test(normalized));
  if (!included) return false;
  return !policy.excludeGlobs.some((glob) => globToRegExp(glob).test(normalized));
}

export type SyncTrigger = "watch" | "save" | "open" | "manual";

export function policyAllowsTrigger(
  timing: SyncTiming,
  trigger: SyncTrigger,
) {
  if (timing === "continuous") return true;
  if (timing === "manual") return trigger === "manual";
  return trigger === "save" || trigger === "open" || trigger === "manual";
}

export function structurePropagates(
  mode: StructureMode,
  direction: "spectra-to-disk" | "disk-to-spectra",
) {
  if (mode === "mirror-both") return true;
  if (mode === "mirror-to-disk") return direction === "spectra-to-disk";
  if (mode === "mirror-from-disk") return direction === "disk-to-spectra";
  return false;
}

export type StructureDirection = "spectra-to-disk" | "disk-to-spectra";
export type StructureDecision = "ignore" | "propagate" | "ask";
export type StructureOperationKind = "move" | "rename" | "delete";
export type StructureRequestState =
  | "ignored"
  | "approval-required"
  | "pending";

/**
 * The one policy decision used by the tree, Bridge discovery, UI and tests.
 * `ask` is deliberately not treated as propagation: a durable decision must
 * be recorded before either side is changed.
 */
export function decideStructureOperation(
  mode: StructureMode,
  direction: StructureDirection,
): StructureDecision {
  if (mode === "ask") return "ask";
  return structurePropagates(mode, direction) ? "propagate" : "ignore";
}

/**
 * Physical deletion is always an explicit user decision, even when structure
 * mirroring is enabled. Move and rename can follow the selected policy.
 */
export function initialStructureRequestState(
  decision: StructureDecision,
  direction: StructureDirection,
  kind: StructureOperationKind,
): StructureRequestState {
  if (
    direction === "spectra-to-disk" &&
    kind === "delete" &&
    decision === "propagate"
  )
    return "approval-required";
  if (decision === "ask") return "approval-required";
  return decision === "propagate" ? "pending" : "ignored";
}

export type MissingResourceAction =
  | "keep-unavailable"
  | "restore-to-disk"
  | "trash-in-spectra"
  | "ask";

/** The server-side decision for a file that vanished between mount scans. */
export function decideMissingResourceAction(
  mode: StructureMode,
  cloudPayloadAvailable: boolean,
): MissingResourceAction {
  if (mode === "mirror-from-disk" || mode === "mirror-both")
    return "trash-in-spectra";
  if (mode === "mirror-to-disk" && cloudPayloadAvailable)
    return "restore-to-disk";
  if (mode === "ask") return "ask";
  return "keep-unavailable";
}

export function collisionSafeRelativePath(
  requestedPath: string,
  occupiedPaths: readonly string[],
) {
  const normalized = requestedPath.replaceAll("\\", "/");
  const occupied = new Set(
    occupiedPaths.map((path) => path.replaceAll("\\", "/").toLocaleLowerCase()),
  );
  if (!occupied.has(normalized.toLocaleLowerCase())) return normalized;
  const slash = normalized.lastIndexOf("/");
  const directory = slash >= 0 ? normalized.slice(0, slash + 1) : "";
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${directory}${stem} (Spectra ${index})${extension}`;
    if (!occupied.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error("STRUCTURE_COLLISION_LIMIT");
}
