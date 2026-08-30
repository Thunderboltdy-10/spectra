import { describe, expect, it } from "vitest";
import {
  LegacyArtifactModelAdapter,
  SPECTRA_PROTOCOL_VERSIONS,
  adaptLegacyPreferences,
  adaptLegacyReferencePreview,
  adaptLegacyRunEvent,
  adaptLegacySchoolRecord,
  adaptLegacyToolDefinition,
  resolveLegacySpectraRoute,
  supportsProtocol,
} from "@/features/spectra/migrations";

describe("definitive migration foundation", () => {
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
      legacyReferenceId: "ref-1",
      sourceArtifactId: "work-1",
      mode: "expanded",
      versionPolicy: "live",
      displayPreferences: { regionIds: ["block-1"], view: "excerpt" },
    });
  });

  it("defines every legacy route migration without activating it", () => {
    expect(resolveLegacySpectraRoute("/artifacts")).toBe("/library");
    expect(resolveLegacySpectraRoute("/artifacts/work-1")).toBe(
      "/library/work-1",
    );
    expect(resolveLegacySpectraRoute("/timetable")).toBe("/calendar");
    expect(resolveLegacySpectraRoute("/memory")).toBe(
      "/settings?section=privacy",
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
