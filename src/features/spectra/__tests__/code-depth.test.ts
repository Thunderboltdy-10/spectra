import { describe, expect, it } from "vitest";
import {
  CODE_CAPABILITY_REFUSALS,
  CODE_STUDIO_CAPABILITIES,
  capabilitiesFor,
} from "../capabilities";
import { requireArtifactTypeManifest } from "../artifacts/registry";
import { codeContentSchema } from "../artifacts/schemas";
import {
  CODE_CONTENT_SCHEMA_VERSION,
  migrateCodeContent,
  migrateCodeContentV1ToV2,
} from "../artifacts/schema/code";
import { codeRuntimeVersion, normalizeCodeContent } from "../code/model";
import {
  appendCodeRunReport,
  codeRunReportJson,
  codeRunReportMarkdown,
  codeShortcutOperation,
  discoverPythonCells,
  normalizeCodeRunReports,
  pythonCellAtLine,
  pythonCellExecutionSource,
  type CodeRunReport,
} from "../code/operations";
import {
  isPublishedCodeBuildPayload,
  runtimeSourceDescriptor,
  SPECTRA_RUNTIME_BUILD_FORMAT,
  SPECTRA_RUNTIME_BUILD_VERSION,
} from "../code/published-build";
import { planWorkbarOverflow } from "../components/workbar-overflow";

const SOURCE_FINGERPRINT = "a".repeat(64);

function report(overrides: Partial<CodeRunReport> = {}): CodeRunReport {
  return {
    id: "run-1",
    createdAt: 1_780_000_000_000,
    runtime: "python",
    runtimeVersion: "pyodide-test",
    scope: "project",
    status: "ready",
    durationMs: 42,
    sourceFingerprint: SOURCE_FINGERPRINT,
    entryPath: "main.py",
    pythonPackages: ["numpy"],
    events: [{ atMs: 0, state: "building" }],
    outputExcerpt: "complete",
    problems: [],
    tests: [],
    ...overrides,
  };
}

describe("P12.I4 Code schema v2", () => {
  const v1 = {
    runtime: "python",
    entryFileId: "main-file",
    files: [
      {
        id: "main-file",
        path: "main.py",
        language: "python",
        source: "print('kept')",
        lineIds: ["main-file:line:1"],
      },
    ],
    visualisation: { enabled: true },
  };

  it("migrates v1 without replacing source and declares v2 in the manifest", () => {
    const migrated = migrateCodeContentV1ToV2(v1);
    expect(migrated.files[0]?.source).toBe("print('kept')");
    expect(migrated.pythonPackages).toEqual([]);
    expect(migrated.notebook).toEqual({ enabled: false });
    expect(migrated.runReports).toEqual([]);
    expect(codeContentSchema.parse(migrated)).toEqual(migrated);
    expect(migrateCodeContent(v1, 1)).toEqual(migrated);
    expect(CODE_CONTENT_SCHEMA_VERSION).toBe(2);
    expect(requireArtifactTypeManifest("code").schemas.currentVersion).toBe(2);
  });

  it("rejects content from a newer schema instead of guessing", () => {
    expect(() => migrateCodeContent(v1, 3)).toThrow(/newer Spectra schema/);
  });
});

describe("Python source cells", () => {
  const source = [
    "seed = 7",
    "# %% Load data",
    "values = [seed, seed + 1]",
    "# %%",
    "print(sum(values))",
  ].join("\n");

  it("discovers preamble and # %% cells in source order", () => {
    const cells = discoverPythonCells(source);
    expect(cells.map((cell) => cell.title)).toEqual([
      "Preamble",
      "Load data",
      "Cell 3",
    ]);
    expect(cells.map((cell) => [cell.startLine, cell.endLine])).toEqual([
      [1, 1],
      [3, 3],
      [5, 5],
    ]);
    expect(pythonCellAtLine(cells, 2)?.title).toBe("Load data");
    expect(pythonCellAtLine(cells, 5)?.title).toBe("Cell 3");
  });

  it("pads current-cell source so tracebacks retain original line numbers", () => {
    const cell = discoverPythonCells(source)[1]!;
    expect(pythonCellExecutionSource(cell)).toBe(
      "\n\nvalues = [seed, seed + 1]",
    );
  });
});

describe("bounded reproducible run reports", () => {
  it("redacts common secret shapes and bounds durable history", () => {
    const normalized = normalizeCodeRunReports([
      report({
        outputExcerpt:
          "password=example-value\nAuthorization: credential-value\nfinished",
      }),
    ])[0]!;
    expect(normalized.outputExcerpt).not.toContain("example-value");
    expect(normalized.outputExcerpt).not.toContain("credential-value");
    expect(normalized.outputExcerpt).toContain("[redacted]");

    const reports = Array.from({ length: 25 }, (_, index) =>
      report({ id: `run-${index}` }),
    ).reduce<CodeRunReport[]>(
      (current, next) => appendCodeRunReport(current, next),
      [],
    );
    expect(reports).toHaveLength(20);
    expect(new Set(reports.map((item) => item.id)).size).toBe(20);
  });

  it("projects the same sanitized report to Markdown and JSON", () => {
    const value = report({
      scope: "cell",
      cell: { index: 0, title: "Load", startLine: 3, endLine: 4 },
      tests: [{ name: "sum", status: "passed" }],
    });
    expect(codeRunReportMarkdown(value)).toContain("# Spectra code run");
    expect(codeRunReportMarkdown(value)).toContain("lines 3-4");
    expect(JSON.parse(codeRunReportJson(value))).toEqual(value);
  });

  it("keeps run history out of the executable source descriptor", () => {
    const content = normalizeCodeContent({
      runtime: "python",
      entryFileId: "main",
      files: [
        {
          id: "main",
          path: "main.py",
          language: "python",
          source: "import numpy",
        },
      ],
      visualisation: { enabled: true },
      pythonPackages: ["numpy"],
      notebook: { enabled: true },
      runReports: [report()],
    });
    const descriptor = runtimeSourceDescriptor(content);
    expect(descriptor.pythonPackages).toEqual(["numpy"]);
    expect(descriptor.notebook).toEqual({ enabled: true });
    expect(descriptor).not.toHaveProperty("runReports");
  });

  it("enumerates package, notebook, and run-report collaboration regions", () => {
    const content = normalizeCodeContent({
      runtime: "python",
      entryFileId: "main",
      files: [
        {
          id: "main",
          path: "main.py",
          language: "python",
          source: "print('ready')",
        },
      ],
      visualisation: { enabled: true },
      pythonPackages: ["numpy"],
      notebook: { enabled: true },
      runReports: [report()],
    });
    const regions = requireArtifactTypeManifest("code").regions(content);
    expect(regions.map((region) => [region.kind, region.path])).toEqual(
      expect.arrayContaining([
        ["code_python_package", ["pythonPackages", 0]],
        ["code_notebook", ["notebook"]],
        ["code_run_report", ["runReports", 0]],
      ]),
    );
  });

  it("validates approved package and notebook declarations in published payloads", () => {
    const payload = {
      format: SPECTRA_RUNTIME_BUILD_FORMAT,
      version: SPECTRA_RUNTIME_BUILD_VERSION,
      sdkVersion: "test",
      artifactId: "artifact-1",
      artifactVersionId: "version-1",
      title: "Python result",
      sourceHash: SOURCE_FINGERPRINT,
      runtime: "python",
      runtimeVersion: codeRuntimeVersion("python"),
      entryFileId: "main",
      dependencies: {},
      pythonPackages: ["numpy"],
      notebook: { enabled: true },
      networkPolicy: { mode: "none" },
      parameters: [],
      assets: [],
      files: [
        {
          id: "main",
          path: "main.py",
          language: "python",
          source: "print('ready')",
        },
      ],
      visualisation: { enabled: true },
      createdAt: 1_780_000_000_000,
    };
    expect(isPublishedCodeBuildPayload(payload)).toBe(true);
    expect(
      isPublishedCodeBuildPayload({
        ...payload,
        pythonPackages: ["unapproved-package"],
      }),
    ).toBe(false);
    expect(
      isPublishedCodeBuildPayload({ ...payload, notebook: { enabled: "yes" } }),
    ).toBe(false);
  });
});

describe("Code capability and keyboard reachability", () => {
  it("registers the per-type inventory and keeps AI manifest verbs symmetric", () => {
    const definitions = capabilitiesFor("code");
    const manifestOperations = new Set(
      requireArtifactTypeManifest("code").operations,
    );
    expect(definitions).toEqual(CODE_STUDIO_CAPABILITIES);
    expect(definitions).toHaveLength(54);
    for (const definition of definitions) {
      if (!definition.ai.exposed) continue;
      expect(definition.manifestOperation).toBeTruthy();
      expect(
        manifestOperations.has(
          `code.${definition.manifestOperation!.replaceAll("_", ".")}`,
        ),
      ).toBe(true);
    }
  });

  it("uses the exact honest refusal sentence for arbitrary packages", () => {
    const definition = CODE_STUDIO_CAPABILITIES.find(
      (candidate) => candidate.id === "code.runtime.installArbitraryPackage",
    )!;
    const availability = definition.availability({
      workType: "code",
      can: () => true,
      selection: { ids: [] },
      permissions: { role: "edit", editable: true },
      compatibilityProfile: "spectra-native",
      fidelity: {},
    });
    expect(availability).toEqual({
      state: "disabled",
      reason: CODE_CAPABILITY_REFUSALS.arbitraryPackages,
    });
  });

  it("maps the scoped shortcuts without stealing unrelated keys", () => {
    expect(codeShortcutOperation({ key: "Enter", ctrlKey: true })).toBe(
      "runtime.run",
    );
    expect(codeShortcutOperation({ key: "Enter", shiftKey: true })).toBe(
      "notebook.runCell",
    );
    expect(
      codeShortcutOperation({ key: "Enter", ctrlKey: true, shiftKey: true }),
    ).toBe("notebook.runAll");
    expect(
      codeShortcutOperation({ key: "f", ctrlKey: true, shiftKey: true }),
    ).toBe("files.searchProject");
    expect(
      codeShortcutOperation({ key: "f", ctrlKey: true, altKey: true }),
    ).toBe("format");
    expect(codeShortcutOperation({ key: "b", ctrlKey: true })).toBeNull();
  });

  it("keeps every Code action reachable through deterministic narrow overflow", () => {
    const items = CODE_STUDIO_CAPABILITIES.map((definition, index) => ({
      id: definition.id,
      fullWidth: 84 + (index % 4) * 12,
      iconWidth: 32,
      priority:
        index < 4
          ? ("essential" as const)
          : index < 12
            ? ("secondary" as const)
            : ("advanced" as const),
    }));
    const first = planWorkbarOverflow(items, 320);
    const second = planWorkbarOverflow(items, 320);
    expect(second).toEqual(first);
    expect(new Set([...first.visibleIds, ...first.overflowIds])).toEqual(
      new Set(items.map((item) => item.id)),
    );
    expect(first.overflowIds.length).toBeGreaterThan(0);
  });
});
