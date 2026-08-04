import type { CapabilityState } from "../../core/capability-truth";

export const SCHOOL_ENTITY_KINDS = [
  "course",
  "membership",
  "assignment",
  "assessment",
  "grade",
  "feedback",
  "discussion",
  "announcement",
  "resource",
  "timetable_event",
  "cas_experience",
  "attendance",
  "message",
] as const;

export type SchoolEntityKind = (typeof SCHOOL_ENTITY_KINDS)[number];

export type SchoolCapability = {
  id: string;
  entity: SchoolEntityKind;
  scope: "personal" | "class" | "school";
  readable: boolean;
  pagination: "none" | "page" | "cursor";
  freshnessMinutes: number;
  state: CapabilityState;
};

export type CapabilityManifest = {
  provider: string;
  version: string;
  discoveredAt: number;
  capabilities: SchoolCapability[];
};

export type SyncCursor = {
  capabilityId: string;
  value: string;
};

export type NormalizedSchoolRecord = {
  provider: string;
  providerRecordId: string;
  kind: SchoolEntityKind;
  title: string;
  classId?: string;
  startsAt?: number;
  endsAt?: number;
  dueAt?: number;
  timezone?: string;
  timePrecision: "exact" | "verified_period" | "date_only" | "unknown";
  periodKey?: string;
  sourceUrl?: string;
  sourceModifiedAt?: number;
  fetchedAt: number;
  payload: Record<string, unknown>;
};

export type SyncBatch = {
  capabilityId: string;
  records: NormalizedSchoolRecord[];
  cursor?: SyncCursor;
  complete: boolean;
  received: number;
  quarantined: number;
};

export type FreshnessPolicy = {
  freshForMs: number;
  staleWhileRefreshMs: number;
  manualRefresh: boolean;
};

export type ConnectedIdentity = {
  accountId: string;
  schoolId: string;
  providerIdentityStatus: "verified" | "pending" | "unavailable";
};

/**
 * Provider-neutral school source boundary. Provider payloads stop here; every
 * Calendar, Plan, School, context, and workspace consumer reads normalized
 * records plus explicit capability truth.
 */
export interface SchoolSourceAdapter<TProviderRecord = unknown> {
  readonly provider: string;
  discoverCapabilities(
    identity: ConnectedIdentity,
  ): Promise<CapabilityManifest>;
  sync(
    capability: SchoolCapability,
    cursor?: SyncCursor,
  ): AsyncGenerator<SyncBatch>;
  normalize(record: TProviderRecord): NormalizedSchoolRecord;
  resolveSourceLink(record: TProviderRecord): string | null;
  getFreshnessPolicy(capability: SchoolCapability): FreshnessPolicy;
}

export function assertSchoolAdapterContract(
  adapter: SchoolSourceAdapter,
  manifest: CapabilityManifest,
) {
  if (!adapter.provider.trim() || manifest.provider !== adapter.provider)
    throw new Error("SCHOOL_ADAPTER_PROVIDER_MISMATCH");
  const ids = new Set<string>();
  for (const capability of manifest.capabilities) {
    if (ids.has(capability.id)) throw new Error("SCHOOL_CAPABILITY_DUPLICATE");
    ids.add(capability.id);
    if (!SCHOOL_ENTITY_KINDS.includes(capability.entity))
      throw new Error("SCHOOL_CAPABILITY_ENTITY_UNSUPPORTED");
    if (capability.freshnessMinutes <= 0)
      throw new Error("SCHOOL_CAPABILITY_FRESHNESS_INVALID");
  }
  return true;
}
