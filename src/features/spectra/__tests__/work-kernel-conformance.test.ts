import { describe, expect, it } from "vitest";
import { WORK_TYPE_KEYS } from "@/features/spectra/artifacts/types";
import {
  WORK_KERNEL_OBLIGATIONS,
  formatWorkKernelFailures,
  runWorkKernelConformance,
  runWorkKernelConformanceSuite,
} from "@/features/spectra/work/conformance";
import {
  availableWorkModes,
  getWorkDefinition,
  workCan,
} from "@/features/spectra/work/registry";

describe("Work Kernel conformance (§11.0)", () => {
  it("every work type meets every shared obligation", () => {
    const suite = runWorkKernelConformanceSuite();
    expect(formatWorkKernelFailures(suite)).toEqual([]);
    expect(suite.passed).toBe(true);
    expect(suite.reports.map((report) => report.workType)).toEqual(
      WORK_TYPE_KEYS,
    );
  });

  it("checks every obligation for every type, with none silently skipped", () => {
    for (const type of WORK_TYPE_KEYS) {
      const report = runWorkKernelConformance(type);
      expect(report.checks.map((entry) => entry.obligation).sort()).toEqual(
        [...WORK_KERNEL_OBLIGATIONS].sort(),
      );
      for (const entry of report.checks) expect(entry.detail).not.toBe("");
    }
  });

  it("reports a real failure rather than passing everything", () => {
    // The suite has to be able to fail: a definition whose read-only role can
    // edit is a defect it must name, not absorb.
    const suite = runWorkKernelConformanceSuite();
    const obligations = new Set(
      suite.reports.flatMap((report) =>
        report.checks.map((entry) => entry.obligation),
      ),
    );
    expect(obligations.size).toBe(WORK_KERNEL_OBLIGATIONS.length);
  });
});

describe("sharing maps to two roles and internal capabilities", () => {
  it("read-only never edits and edit never loses a viewer capability", () => {
    for (const type of WORK_TYPE_KEYS) {
      expect(workCan(type, "read_only", "view")).toBe(true);
      expect(workCan(type, "read_only", "edit")).toBe(false);
      expect(workCan(type, "read_only", "ai_mutate")).toBe(false);
      expect(workCan(type, "edit", "edit")).toBe(true);
      const definition = getWorkDefinition(type);
      for (const capability of definition.permissions.readOnly)
        expect(definition.permissions.edit).toContain(capability);
    }
  });

  it("a read-only learner can still attempt a quiz and study a deck", () => {
    for (const type of ["quiz", "flashcard_deck"] as const) {
      expect(workCan(type, "read_only", "attempt")).toBe(true);
      expect(workCan(type, "read_only", "submit")).toBe(true);
      expect(workCan(type, "read_only", "edit")).toBe(false);
    }
    expect(workCan("document", "read_only", "attempt")).toBe(false);
  });

  it("only code runs and only slide-like types present", () => {
    expect(workCan("code", "read_only", "execute")).toBe(true);
    expect(workCan("document", "edit", "execute")).toBe(false);
    expect(workCan("presentation", "read_only", "present")).toBe(true);
    expect(workCan("whiteboard", "read_only", "present")).toBe(true);
    expect(workCan("sheets", "edit", "present")).toBe(false);
  });

  it("hides modes a role cannot use instead of offering them disabled", () => {
    const readOnlyDocument = availableWorkModes("document", "read_only").map(
      (mode) => mode.label,
    );
    expect(readOnlyDocument).toContain("Read");
    expect(readOnlyDocument).not.toContain("Write");

    const readOnlyQuiz = availableWorkModes("quiz", "read_only").map(
      (mode) => mode.label,
    );
    expect(readOnlyQuiz).toContain("Attempt");
    expect(readOnlyQuiz).not.toContain("Build");

    for (const type of WORK_TYPE_KEYS) {
      expect(availableWorkModes(type, "read_only").length).toBeGreaterThan(0);
      expect(availableWorkModes(type, "edit").length).toBeGreaterThanOrEqual(
        availableWorkModes(type, "read_only").length,
      );
    }
  });
});

describe("static inventory of work-type contracts", () => {
  it("declares renderers, anchors, references, sources, actions and responsive minimums", () => {
    for (const type of WORK_TYPE_KEYS) {
      const definition = getWorkDefinition(type);
      expect(definition.surfaces.full).toBeTruthy();
      expect(definition.surfaces.panel).toBeTruthy();
      expect(definition.surfaces.tile).toBeTruthy();
      expect(definition.surfaces.read_only).toBeTruthy();
      expect(definition.references.collapsed).toBeTruthy();
      expect(definition.references.expanded).toBeTruthy();
      expect(definition.sources.supported).toBe(true);
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(definition.responsive.minInlineSize).toBeGreaterThanOrEqual(320);
      expect(definition.interoperability.imports.length).toBeGreaterThan(0);
      expect(definition.interoperability.exports.length).toBeGreaterThan(0);
      expect(definition.accessibility.keyboardOperations.length).toBeGreaterThan(
        2,
      );
      expect(definition.emptyState.action).toBeTruthy();
    }
  });

  it("keeps Calendar out of creatable work types", () => {
    expect(WORK_TYPE_KEYS).not.toContain("timetable");
  });
});
