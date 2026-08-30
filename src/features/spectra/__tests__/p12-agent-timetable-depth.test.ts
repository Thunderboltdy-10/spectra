import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_STUDIO_CAPABILITIES,
  TIMETABLE_STUDIO_CAPABILITIES,
} from "../capabilities";
import { requireArtifactTypeManifest } from "../artifacts/registry";
import {
  agentContentSchema,
  migrateAgentContentV1ToV2,
} from "../artifacts/schema/agent";
import {
  migrateTimetableContentV1ToV2,
  timetableContentSchema,
} from "../artifacts/schema/timetable";
import { exportTimetableCsv } from "../timetable/io";
import {
  mergeTimetableState,
  normalizeTimetablePersonalState,
  parseTimetableRecurrence,
  serializeTimetableRecurrence,
  TIMETABLE_DEFAULT_LAYER_COLORS,
} from "../timetable/model";
import type { CommandContext } from "../commands/types";

const enabledContext = { can: () => true } as unknown as CommandContext;

describe("P12.I6 Agent and timetable capability depth", () => {
  it("moves both type registries out of studios.ts and retains stable ids", () => {
    const baseSource = readFileSync(
      "src/features/spectra/capabilities/studios.ts",
      "utf8",
    );
    expect(baseSource).not.toContain('type: "agent"');
    expect(baseSource).not.toContain('type: "timetable"');

    const agentIds = new Set<string>(
      AGENT_STUDIO_CAPABILITIES.map((entry) => entry.id),
    );
    const timetableIds = new Set<string>(
      TIMETABLE_STUDIO_CAPABILITIES.map((entry) => entry.id),
    );
    expect(AGENT_STUDIO_CAPABILITIES.length).toBeGreaterThan(7);
    expect(TIMETABLE_STUDIO_CAPABILITIES.length).toBeGreaterThan(8);
    for (const id of [
      "agent.next",
      "agent.source",
      "agent.dismissed",
      "agent.competence",
      "agent.refresh",
      "agent.brief",
      "agent.private",
      "agent.evaluation.compareRuns",
      "agent.release.compare",
      "agent.routing.preview",
    ]) {
      expect(agentIds.has(id), id).toBe(true);
    }
    for (const id of [
      "timetable.today",
      "timetable.previous",
      "timetable.next",
      "timetable.view",
      "timetable.calendars",
      "timetable.add",
      "timetable.import",
      "timetable.export.ics",
      "timetable.recurrence.setInterval",
      "timetable.overlay.reset",
      "timetable.print.current",
    ]) {
      expect(timetableIds.has(id), id).toBe(true);
    }
  });

  it("keeps every depth capability linked to a declared artifact-manifest operation", () => {
    for (const [type, definitions] of [
      ["agent", AGENT_STUDIO_CAPABILITIES],
      ["timetable", TIMETABLE_STUDIO_CAPABILITIES],
    ] as const) {
      const manifest = requireArtifactTypeManifest(type);
      for (const definition of definitions) {
        expect(definition.manifestOperation, definition.id).toBeTruthy();
        expect(manifest.operations, definition.id).toContain(
          `${type}.${definition.manifestOperation!.replaceAll("_", ".")}`,
        );
      }
    }
  });

  it("publishes plain-language refusal truth through the IR", () => {
    const refusalIds = [
      "agent.privacy.inspectInvocations",
      "agent.routing.trafficSplit",
      "agent.evaluation.providerTraces",
      "agent.export.withSecrets",
      "timetable.layer.renameProvider",
      "timetable.event.editSource",
      "timetable.recurrence.editCustom",
      "timetable.export.pdf",
    ];
    const definitions = [
      ...AGENT_STUDIO_CAPABILITIES,
      ...TIMETABLE_STUDIO_CAPABILITIES,
    ];
    for (const id of refusalIds) {
      const definition = definitions.find((entry) => entry.id === id);
      expect(definition, id).toBeTruthy();
      const availability = definition!.availability(enabledContext);
      expect(availability.state).toBe("disabled");
      if (availability.state === "disabled") {
        expect(availability.reason).toMatch(/[.!]$/);
        expect(availability.reason).not.toMatch(/[A-Z_]{4,}/);
      }
    }
  });
});

describe("P12.I6 schema migrations", () => {
  it("materializes a v2 Foundry document without losing legacy runtime fields", () => {
    const legacy = {
      profile: {
        purpose: "Mark essays against the department standard.",
        outcomes: ["Specific feedback"],
        audienceIntent: "English teachers",
        inScope: ["Essay feedback"],
        outOfScope: ["Writing the essay"],
      },
      instructions: {
        regionId: "instructions",
        text: "Apply the rubric and cite the relevant criterion.",
      },
      skills: [],
      tools: [],
      resources: [],
      routing: {
        enabled: true,
        description: "Choose for department essay marking requests.",
        examples: [],
        negativeExamples: [],
      },
      behavior: {
        clarification: "ask_when_needed",
        tone: "direct",
        responseLength: "balanced",
        boundaries: [],
      },
      modelPolicy: { mode: "spectra_default", allowFallback: true },
      evals: [],
      releaseNotes: "",
    };
    const migrated = migrateAgentContentV1ToV2(legacy);
    expect(migrated.profile.purpose).toBe(legacy.profile.purpose);
    expect(migrated.foundry.schemaVersion).toBeGreaterThan(0);
    expect(agentContentSchema.safeParse(migrated).success).toBe(true);
    const manifest = requireArtifactTypeManifest("agent");
    expect(manifest.schemas.currentVersion).toBe(2);
    expect(manifest.schemas.migrations?.[1]).toBe(migrateAgentContentV1ToV2);
  });

  it("migrates timetable content to shared/source truth and removes personal overlays", () => {
    const migrated = migrateTimetableContentV1ToV2({
      timezone: "UTC",
      layers: [
        {
          id: "school",
          name: "School",
          kind: "school",
          visible: false,
          color: TIMETABLE_DEFAULT_LAYER_COLORS.shared,
          authority: "school",
        },
        {
          id: "personal",
          name: "Personal",
          kind: "personal",
          visible: true,
          color: TIMETABLE_DEFAULT_LAYER_COLORS.personal,
          authority: "user",
          private: true,
        },
      ],
      events: [
        {
          id: "lesson",
          layerId: "school",
          title: "Physics",
          start: "2026-08-31T08:00:00.000Z",
          end: "2026-08-31T09:00:00.000Z",
          allDay: false,
          sourceRef: "google-event",
          overlay: { note: "Bring lab book" },
        },
        {
          id: "private",
          layerId: "personal",
          title: "Walk",
          start: "2026-08-31T10:00:00.000Z",
          end: "2026-08-31T11:00:00.000Z",
          allDay: false,
        },
      ],
    });
    expect(migrated.layers.map((layer) => layer.id)).toEqual(["school"]);
    expect(migrated.layers[0]?.visible).toBe(true);
    expect(migrated.events.map((event) => event.id)).toEqual(["lesson"]);
    expect(migrated.events[0]).not.toHaveProperty("overlay");
    expect(timetableContentSchema.safeParse(migrated).success).toBe(true);
    const manifest = requireArtifactTypeManifest("timetable");
    expect(manifest.schemas.currentVersion).toBe(2);
    expect(manifest.schemas.migrations?.[1]).toBe(
      migrateTimetableContentV1ToV2,
    );
  });
});

describe("P12.I6 recurrence, personal layer colour, and CSV export", () => {
  it("round-trips the editable recurrence subset and refuses imported custom rules", () => {
    const parsed = parseTimetableRecurrence(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=12",
    );
    expect(parsed).toMatchObject({
      frequency: "weekly",
      interval: 2,
      weekdays: ["MO", "WE", "FR"],
      end: { kind: "count", count: 12 },
      editable: true,
    });
    expect(serializeTimetableRecurrence(parsed)).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=12",
    );
    const custom = parseTimetableRecurrence("FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO");
    expect(custom.editable).toBe(false);
    expect(() => serializeTimetableRecurrence(custom)).toThrow(
      "must be changed in its source",
    );
    expect(parseTimetableRecurrence("FREQ=MONTHLY;BYDAY=1MO").editable).toBe(
      false,
    );
    expect(
      parseTimetableRecurrence("FREQ=WEEKLY;UNTIL=20261231T100000Z").editable,
    ).toBe(false);
  });

  it("applies provider layer colours only through personal state", () => {
    const shared = {
      timezone: "UTC",
      layers: [
        {
          id: "school",
          name: "School",
          kind: "school" as const,
          visible: true,
          color: TIMETABLE_DEFAULT_LAYER_COLORS.shared,
          authority: "school" as const,
        },
      ],
      events: [],
    };
    const personal = normalizeTimetablePersonalState(
      { layerColors: { school: "#7865ea" } },
      "UTC",
    );
    expect(mergeTimetableState(shared, personal).layers[0]?.color).toBe(
      "#7865ea",
    );
    expect(shared.layers[0]?.color).toBe("#26a879");
  });

  it("exports visible event fields with CSV escaping and personal display time", () => {
    const csv = exportTimetableCsv([
      {
        id: "event-1",
        layerId: "school",
        title: 'Lab, "rates"',
        start: "2026-08-31T08:00:00.000Z",
        end: "2026-08-31T09:00:00.000Z",
        allDay: false,
        sourceRef: "provider-event-1",
        overlay: {
          alternativeStart: "2026-08-31T10:00:00.000Z",
          alternativeEnd: "2026-08-31T11:00:00.000Z",
          note: "Personal note",
        },
      },
    ]);
    expect(csv).toContain('"Lab, ""rates"""');
    expect(csv).toContain("2026-08-31T10:00:00.000Z");
    expect(csv).toContain("provider-event-1");
    expect(csv).toContain("Personal note");
  });

  it("keeps Today, view, and Add time essential while export and print use overflow", () => {
    const source = readFileSync(
      "src/features/spectra/components/timetable-studio.tsx",
      "utf8",
    );
    expect(source).toMatch(/id: "today"[\s\S]*?priority: "essential"/);
    expect(source).toMatch(/id: "view"[\s\S]*?priority: "essential"/);
    expect(source).toMatch(/id: "add"[\s\S]*?priority: "essential"/);
    expect(source).toMatch(/id: "export\.csv"[\s\S]*?priority: "advanced"/);
    expect(source).toMatch(/id: "print\.current"[\s\S]*?priority: "advanced"/);
  });
});
