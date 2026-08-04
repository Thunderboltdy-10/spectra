import type {
  CapabilityManifest,
  ConnectedIdentity,
  FreshnessPolicy,
  NormalizedSchoolRecord,
  SchoolCapability,
  SchoolEntityKind,
  SchoolSourceAdapter,
  SyncBatch,
  SyncCursor,
} from "./adapter";

type ManageBacRecord = {
  id?: string | number;
  recordType?: string;
  normalized?: Record<string, unknown>;
  fetchedAt?: number;
  sourceModifiedAt?: number;
  provenanceUrl?: string;
};

const kindMap: Record<string, SchoolEntityKind> = {
  class: "course",
  course: "course",
  membership: "membership",
  task: "assignment",
  assignment: "assignment",
  deadline: "assignment",
  assessment: "assessment",
  result: "grade",
  grade: "grade",
  feedback: "feedback",
  discussion: "discussion",
  announcement: "announcement",
  resource: "resource",
  class_resource: "resource",
  timetable: "timetable_event",
  timetable_event: "timetable_event",
  cas: "cas_experience",
  cas_experience: "cas_experience",
  attendance: "attendance",
  message: "message",
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function timestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return Date.parse(value);
  return undefined;
}

/** ManageBac is the first provider behind the neutral school-source contract. */
export class ManageBacSchoolSourceAdapter
  implements SchoolSourceAdapter<ManageBacRecord>
{
  readonly provider = "managebac";

  constructor(
    private readonly transport: {
      discover(identity: ConnectedIdentity): Promise<CapabilityManifest>;
      batches(
        capability: SchoolCapability,
        cursor?: SyncCursor,
      ): AsyncGenerator<SyncBatch>;
    },
  ) {}

  discoverCapabilities(identity: ConnectedIdentity) {
    return this.transport.discover(identity);
  }

  sync(capability: SchoolCapability, cursor?: SyncCursor) {
    return this.transport.batches(capability, cursor);
  }

  normalize(record: ManageBacRecord): NormalizedSchoolRecord {
    const value = record.normalized ?? {};
    const recordType = text(record.recordType, "resource").toLowerCase();
    const kind = kindMap[recordType] ?? "resource";
    const startsAt = timestamp(value.startAt ?? value.start);
    const endsAt = timestamp(value.endAt ?? value.end);
    const dueAt = timestamp(value.dueAt ?? value.deadlineAt);
    const periodKey = text(value.periodKey ?? value.period);
    const dateOnly = text(value.date ?? value.dayDate);
    const explicitPrecision = text(value.timePrecision);
    const timePrecision =
      explicitPrecision === "verified_period"
        ? "verified_period"
        : startsAt !== undefined
          ? "exact"
          : /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)
            ? "date_only"
            : "unknown";
    return {
      provider: this.provider,
      providerRecordId: String(record.id ?? value.id ?? "unknown"),
      kind,
      title: text(
        value.title ?? value.name ?? value.subject,
        kind === "timetable_event" ? "Class period" : "School record",
      ),
      classId: text(value.classId ?? value.class_id) || undefined,
      startsAt,
      endsAt,
      dueAt,
      timezone: text(value.timezone) || undefined,
      timePrecision,
      periodKey: periodKey || undefined,
      sourceUrl: record.provenanceUrl,
      sourceModifiedAt: record.sourceModifiedAt,
      fetchedAt: record.fetchedAt ?? Date.now(),
      payload: value,
    };
  }

  resolveSourceLink(record: ManageBacRecord) {
    return record.provenanceUrl ?? null;
  }

  getFreshnessPolicy(capability: SchoolCapability): FreshnessPolicy {
    return {
      freshForMs: capability.freshnessMinutes * 60_000,
      staleWhileRefreshMs: Math.max(
        capability.freshnessMinutes * 2 * 60_000,
        6 * 60 * 60_000,
      ),
      manualRefresh: true,
    };
  }
}
