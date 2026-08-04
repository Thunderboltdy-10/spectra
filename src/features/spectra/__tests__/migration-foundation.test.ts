import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SPECTRA_MIGRATION_FLAGS,
  LegacyArtifactModelAdapter,
  SPECTRA_MIGRATION_FLAG_KEYS,
  SPECTRA_PROTOCOL_VERSIONS,
  adaptLegacyPreferences,
  adaptLegacyReferencePreview,
  adaptLegacyRunEvent,
  adaptLegacySchoolRecord,
  adaptLegacyToolDefinition,
  resolveSpectraMigrationFlags,
  resolveLegacySpectraRoute,
  supportsProtocol,
} from "@/features/spectra/migrations";

const changedEnvironment = new Set<string>();

afterEach(() => {
  for (const key of changedEnvironment) delete process.env[key];
  changedEnvironment.clear();
});

describe("definitive migration foundation", () => {
  it("keeps every migration path disabled by default", () => {
    expect(Object.keys(DEFAULT_SPECTRA_MIGRATION_FLAGS).sort()).toEqual(
      [...SPECTRA_MIGRATION_FLAG_KEYS].sort(),
    );
    expect(Object.values(resolveSpectraMigrationFlags()).every((value) => !value)).toBe(true);
  });

  it("resolves typed overrides before environment values", () => {
    const key = "SPECTRA_MIGRATION_CLOUDFLARE_REALTIME";
    changedEnvironment.add(key);
    process.env[key] = "true";
    expect(resolveSpectraMigrationFlags().cloudflareRealtime).toBe(true);
    expect(
      resolveSpectraMigrationFlags({ cloudflareRealtime: false })
        .cloudflareRealtime,
    ).toBe(false);
  });

  it("round-trips legacy atomic region snapshots idempotently", () => {
    const adapter = new LegacyArtifactModelAdapter();
    const snapshot = {
      schemaVersion: 3,
      content: { blocks: [{ id: "a", text: "Hello" }] },
      regions: { a: '{"text":"Hello"}' },
    };
    const first = adapter.project(adapter.migrate(snapshot));
    const second = adapter.project(adapter.migrate(first));
    expect(first).toEqual(snapshot);
    expect(second).toEqual(snapshot);
  });

  it("versions compatibility projections without losing identity", () => {
    const run = adaptLegacyRunEvent({
      type: "status",
      runId: "run-1",
      message: "Reading source",
    });
    expect(run).toMatchObject({
      protocolVersion: SPECTRA_PROTOCOL_VERSIONS.runItems,
      runId: "run-1",
      type: "status",
    });

    const reference = adaptLegacyReferencePreview({
      id: "ref-1",
      artifactId: "work-1",
      regionId: "block-1",
      expanded: true,
    });
    expect(reference).toMatchObject({
      protocolVersion: SPECTRA_PROTOCOL_VERSIONS.references,
      id: "ref-1",
      state: "expanded",
      target: { workId: "work-1" },
    });
  });

  it("defines every legacy route migration without activating it", () => {
    expect(resolveLegacySpectraRoute("/artifacts")).toBe("/library");
    expect(resolveLegacySpectraRoute("/artifacts/work-1")).toBe(
      "/library/work-1",
    );
    expect(resolveLegacySpectraRoute("/timetable")).toBe("/calendar");
    expect(resolveLegacySpectraRoute("/memory")).toBe(
      "/settings/privacy-data",
    );
    expect(resolveLegacySpectraRoute("/workspace")).toBeNull();
  });

  it("adapts tools, preferences, and school records truthfully", () => {
    expect(
      adaptLegacyToolDefinition({
        type: "artifact.archive",
        purpose: "Archive selected work",
        execution: "confirmation",
        batchable: false,
      }),
    ).toMatchObject({ id: "artifact.archive", approval: "always", risk: "high" });
    expect(adaptLegacyPreferences({ continueThread: false })).toMatchObject({
      version: SPECTRA_PROTOCOL_VERSIONS.preferences,
      account: { ai: { continueCurrentConversation: false } },
    });
    expect(
      adaptLegacySchoolRecord({ id: "task-1", type: "task", title: "Essay" }),
    ).toMatchObject({
      protocolVersion: SPECTRA_PROTOCOL_VERSIONS.schoolSource,
      provider: "managebac",
      providerRecordId: "task-1",
      kind: "task",
    });
  });

  it("rejects unsupported protocol versions", () => {
    expect(supportsProtocol("collaboration", SPECTRA_PROTOCOL_VERSIONS.collaboration)).toBe(true);
    expect(supportsProtocol("collaboration", 999)).toBe(false);
  });
});
