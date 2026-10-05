import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORK_TYPE_KEYS } from "../artifacts/types";
import {
  assertTemporalSeparation,
  calendarItemFromWire,
} from "../calendar/domain/model";
import {
  calendarActionPolicy,
  verifyCalendarActionPostcondition,
} from "../calendar/domain/actions";
import { normalizePlanContent, validatePlanDependencies } from "../plan/model";
import {
  assertSchoolAdapterContract,
  type CapabilityManifest,
  type SchoolSourceAdapter,
} from "../integrations/school/adapter";
import { parseModelOperation } from "../operations/schema";
import { APPLICATION_COMMAND_NAMES } from "@/app/api/spectra/run/harness/application-commands";
import {
  metricDefinition,
  SPECTRA_METRIC_REGISTRY,
} from "../administration/metric-registry";

const root = resolve(__dirname, "../../../..");

describe("Calendar, School, and administration V2", () => {
  it("removes Calendar from creatable work while retaining semantic tools", () => {
    expect(WORK_TYPE_KEYS).not.toContain("timetable");
    expect(() =>
      parseModelOperation({
        type: "artifact.create",
        input: {
          blueprintKey: "timetable",
          title: "Legacy schedule",
          summary: null,
          content: { events: [] },
          tags: [],
          workspaceId: null,
          placement: "inbox",
          pinned: false,
          exclusivePin: false,
        },
      }),
    ).toThrow();
    expect(APPLICATION_COMMAND_NAMES).not.toContain("create_timetable");
    expect(APPLICATION_COMMAND_NAMES).toEqual(
      expect.arrayContaining([
        "schedule_calendar_task",
        "create_calendar_personal_event",
        "move_calendar_block",
        "resize_calendar_block",
      ]),
    );
  });

  it("accepts personal-event create postconditions matching Add event", () => {
    const event = calendarItemFromWire({
      id: "personal-1",
      kind: "personal_event",
      title: "Study hall",
      sourceLocked: false,
      startAt: 1_000,
      endAt: 2_000,
      allDay: false,
      timezone: "UTC",
      timePrecision: "exact",
      status: "active",
      linkedWorkIds: [],
      revision: 1,
    });
    const postcondition = verifyCalendarActionPostcondition(
      {
        type: "calendar.create_personal_event",
        title: "Study hall",
        startAt: 1_000,
        endAt: 2_000,
        timezone: "UTC",
      },
      event,
    );
    expect(postcondition).toEqual({
      itemId: "personal-1",
      kind: "personal_event",
      startAt: 1_000,
      endAt: 2_000,
      linkedTask: false,
    });
    expect(calendarActionPolicy({
      type: "calendar.create_personal_event",
      title: "Study hall",
      startAt: 1_000,
      endAt: 2_000,
      timezone: "UTC",
    }).target.kind).toBe("personal_event");
  });

  it("keeps official deadlines immutable and scheduled work distinct", () => {
    const deadline = calendarItemFromWire({
      id: "deadline",
      kind: "official_deadline",
      title: "Source deadline",
      sourceLocked: true,
      allDay: false,
      timezone: "UTC",
      timePrecision: "exact",
      status: "active",
      linkedWorkIds: [],
      revision: 2,
    });
    const block = calendarItemFromWire({
      id: "block",
      kind: "scheduled_work_block",
      title: "Draft response",
      sourceLocked: false,
      startAt: 1_000,
      endAt: 2_000,
      allDay: false,
      timezone: "UTC",
      timePrecision: "exact",
      status: "active",
      taskItemId: "task",
      officialDeadlineItemId: "deadline",
      linkedWorkIds: [],
      revision: 3,
    });
    expect(assertTemporalSeparation([deadline, block])).toBe(true);
    const action = {
      type: "calendar.move_work_block" as const,
      itemId: "block",
      startAt: 1_000,
      endAt: 2_000,
      expectedRevision: 2,
    };
    expect(calendarActionPolicy(action)).toMatchObject({
      mode: "interaction_lease",
      leaseScope: "gesture",
    });
    expect(verifyCalendarActionPostcondition(action, block).linkedTask).toBe(true);
    expect(() =>
      assertTemporalSeparation([{ ...deadline, sourceLocked: false }]),
    ).toThrow("CALENDAR_OFFICIAL_DEADLINE_UNLOCKED");
  });

  it("places date-only school events on the day without hiding them", () => {
    const dated = calendarItemFromWire({
      id: "assembly",
      kind: "official_event",
      title: "Year group assembly",
      sourceLocked: true,
      startAt: Date.parse("2026-08-17T00:00:00.000Z"),
      endAt: Date.parse("2026-08-18T00:00:00.000Z"),
      allDay: false,
      timezone: "UTC",
      timePrecision: "date_only",
      status: "active",
      linkedWorkIds: [],
      revision: 1,
    });
    const untimedStart = calendarItemFromWire({
      id: "match",
      kind: "official_event",
      title: "Football fixture",
      sourceLocked: true,
      startAt: Date.parse("2026-08-17T14:00:00.000Z"),
      allDay: false,
      timezone: "UTC",
      timePrecision: "unknown",
      status: "active",
      linkedWorkIds: [],
      revision: 1,
    });
    expect(dated.allDay).toBe(true);
    expect(untimedStart.allDay).toBe(true);
  });

  it("normalizes flexible Plans idempotently and rejects dependency cycles", () => {
    const migrated = normalizePlanContent({
      taskTitle: "Prepare launch",
      description: "Coordinate a non-school product launch.",
      linkedArtifactIds: ["brief"],
    });
    expect(migrated.views.map((view) => view.kind)).toEqual([
      "list",
      "board",
      "timeline",
    ]);
    expect(normalizePlanContent(migrated)).toEqual(migrated);
    const cyclic = normalizePlanContent({
      tasks: [
        { id: "a", title: "A", dependencyIds: ["b"] },
        { id: "b", title: "B", dependencyIds: ["a"] },
      ],
    });
    expect(() => validatePlanDependencies(cyclic)).toThrow(
      "PLAN_DEPENDENCY_CYCLE",
    );
  });

  it("enforces a provider-neutral school adapter contract", () => {
    const manifest: CapabilityManifest = {
      provider: "fixture",
      version: "1",
      discoveredAt: 1,
      capabilities: [
        {
          id: "courses",
          entity: "course",
          scope: "personal",
          readable: true,
          pagination: "cursor",
          freshnessMinutes: 60,
          state: { kind: "available", updatedAt: 1 },
        },
      ],
    };
    const adapter: SchoolSourceAdapter = {
      provider: "fixture",
      async discoverCapabilities() {
        return manifest;
      },
      async *sync() {
        yield {
          capabilityId: "courses",
          records: [],
          complete: true,
          received: 0,
          quarantined: 0,
        };
      },
      normalize() {
        return {
          provider: "fixture",
          providerRecordId: "1",
          kind: "course",
          title: "Course",
          timePrecision: "unknown",
          fetchedAt: 1,
          payload: {},
        };
      },
      resolveSourceLink() {
        return null;
      },
      getFreshnessPolicy() {
        return { freshForMs: 60_000, staleWhileRefreshMs: 60_000, manualRefresh: true };
      },
    };
    expect(assertSchoolAdapterContract(adapter, manifest)).toBe(true);
  });

  it("never invents a provider event duration and only uses verified period maps", () => {
    const source = readFileSync(resolve(root, "convex/calendarShared.ts"), "utf8");
    expect(source).not.toMatch(/exactStart\s*\+\s*60\s*\*\s*60_000/);
    expect(source).toContain('query("calendarPeriodMaps")');
    expect(source).toContain('precision: "unknown" as const');
    expect(source).toContain('precision: "verified_period" as const');
  });

  it("registers every displayed core metric with source, privacy, freshness, and zero meaning", () => {
    const ids = SPECTRA_METRIC_REGISTRY.map((metric) => metric.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "account.work_created",
      "account.active_workspaces",
      "account.ai_runs",
      "account.ai_completion_rate",
      "account.model_tokens",
      "account.collaboration_bytes",
      "school.members",
      "school.class_workspaces",
      "platform.active_schools",
      "platform.total_users",
      "platform.work_created",
      "platform.messages",
      "platform.retention",
    ]) {
      const definition = metricDefinition(id);
      expect(definition.source).toBeTruthy();
      expect(definition.scope).toMatch(/account_private|school_aggregate|platform_aggregate/);
      expect(definition.freshness).toBeTruthy();
      expect(definition.zeroMeaning).toBeTruthy();
      expect(definition.filters.length).toBeGreaterThan(0);
    }
  });

  it("uses indexed platform administration reads rather than bare full-table scans", () => {
    const source = readFileSync(resolve(root, "convex/administration.ts"), "utf8");
    const platform = source.slice(source.indexOf("export const platformOverview"), source.indexOf("export const platformSecurityLog"));
    for (const table of [
      "schools",
      "accounts",
      "schoolIntegrations",
      "feedbackReports",
      "platformIncidents",
      "schoolRequests",
      "usageMeters",
      "operationalCounters",
    ])
      expect(platform).not.toContain(`query("${table}").collect()`);
    expect(platform).toContain('withIndex("by_day"');
    expect(platform).toContain("metricStates");
  });
});
