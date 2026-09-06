import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSettledAiRunStatus,
  isWorkingAiRunStatus,
} from "../core";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("run settle honesty (chat vs Live Dock)", () => {
  it("treats only queued/running as still working", () => {
    expect(isWorkingAiRunStatus("queued")).toBe(true);
    expect(isWorkingAiRunStatus("running")).toBe(true);
    expect(isWorkingAiRunStatus("awaiting_confirmation")).toBe(false);
    expect(isWorkingAiRunStatus("awaiting_resolution")).toBe(false);
    expect(isWorkingAiRunStatus("completed")).toBe(false);
    expect(isWorkingAiRunStatus("failed")).toBe(false);
    expect(isWorkingAiRunStatus("cancelled")).toBe(false);
  });

  it("settled statuses are the complement of working", () => {
    for (const status of [
      "queued",
      "running",
      "awaiting_confirmation",
      "awaiting_resolution",
      "completed",
      "failed",
      "cancelled",
    ] as const) {
      expect(isSettledAiRunStatus(status)).toBe(!isWorkingAiRunStatus(status));
    }
  });

  it("persists terminal run status before the assistant message on operate completion", () => {
    const runtime = read("src/app/api/spectra/run/runtime.ts");
    const operateMarker =
      'resultVariant: provenanceArtifactIds.length > 0 ? "artifact" : "status"';
    const operateMarkerAt = runtime.indexOf(operateMarker);
    const operateStart = runtime.lastIndexOf(
      'loop.enter("report");',
      operateMarkerAt,
    );
    const operateBlock = runtime.slice(
      operateStart,
      runtime.indexOf('recordPhase("final_state_persisted")', operateStart),
    );
    expect(operateBlock).toContain(
      "Persist terminal run status before the assistant message",
    );
    expect(operateBlock).not.toContain("await Promise.all([");
    const updateAt = operateBlock.indexOf('mutate("spectraRuns:updateStatus"');
    const messageAt = operateBlock.indexOf("saveAssistantMessage(");
    expect(updateAt).toBeGreaterThan(-1);
    expect(messageAt).toBeGreaterThan(updateAt);

    const resumeMarker = "The resolved operations are complete.";
    const resumeMarkerAt = runtime.indexOf(resumeMarker);
    const resumeStart = runtime.indexOf('loop.enter("report");', resumeMarkerAt);
    const resumeEnd = runtime.indexOf(
      'mutate("spectraRuns:appendEvent"',
      resumeStart,
    );
    const resumeBlock = runtime.slice(resumeStart, resumeEnd);
    expect(resumeBlock).toContain('chat/Live Dock agree on "finished"');
    expect(resumeBlock).not.toContain("await Promise.all([");
    expect(resumeBlock.indexOf("saveAssistantMessage(")).toBeGreaterThan(
      resumeBlock.indexOf('mutate("spectraRuns:updateStatus"'),
    );
  });

  it("gates open-artifact result cards on settled run status in conversation UI", () => {
    const surface = read(
      "src/features/spectra/components/conversation-surface.tsx",
    );
    expect(surface).toContain("isSettledAiRunStatus(trace.run.status)");
    expect(surface).toContain("ArtifactResult");
  });
});
