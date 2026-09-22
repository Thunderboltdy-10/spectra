import { describe, expect, it, vi } from "vitest";
import {
  CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
  convexSafeOfficeActivationContent,
} from "../lenses/office-content";
import { humanizePublicFailure } from "../bridge/humanize";

const durableMocks = vi.hoisted(() => ({
  query: vi.fn(async () => ({artifactId: "artifact", content: {}})),
  mutation: vi.fn(async () => ({jobId: "job", versionId: "version"})),
  store: vi.fn(async (_artifactId: string, _content: unknown): Promise<unknown> => ({})),
  workbook: vi.fn(),
}));
vi.mock("@/lib/auth-server", () => ({requireActor: async () => ({accountId: "owner", clerkId: "owner"})}));
vi.mock("@/lib/convex-server", () => ({convexQuery: durableMocks.query, convexMutation: durableMocks.mutation, convexAction: vi.fn(), storeArtifactContent: durableMocks.store}));
vi.mock("../lenses/xlsx-lens", () => ({xlsxLens: {open: async () => ({projection: {nativeBinding: {}}, fidelityMap: {entries: []}})}}));
vi.mock("../lenses/office-content", async importOriginal => ({...await importOriginal<typeof import("../lenses/office-content")>(), xlsxArtifactContent: durableMocks.workbook}));

function largeWorkbook() {
  return {sheets: [{id: "s", name: "Dense", cells: Object.fromEntries(Array.from({length: 12_000}, (_, i) => [`A${i+1}`, {value: "界".repeat(40)+i}]))}]};
}
const handle = {spectraContentRef: {version: 1, artifactId: "artifact", payloadRef: "body", digest: "a".repeat(64), byteLength: 2_000_000, path: "value"}};

describe("Office activation Convex budget", () => {
  it("keeps a 200k-scale sheet activation document under the Convex cap while preserving sheet identity", () => {
    const cells = Object.fromEntries(
      Array.from({ length: 8_000 }, (_, index) => [
        `A${index + 1}`,
        { value: `density-${index}-${"n".repeat(80)}` },
      ]),
    );
    const content = {
      workbook: {
        calculationMode: "automatic" as const,
        locale: "en-US",
        namedRanges: { Title: "Density!A1" },
        calculationVersion: 1,
      },
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Density",
          cells,
          tables: [],
          charts: [],
          mergedRanges: ["A1:B1"],
          frozenRows: 1,
          frozenColumns: 0,
        },
      ],
      activeSheetId: "xlsx:sheet:1",
      nativeBinding: {
        version: 1 as const,
        format: "xlsx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "a".repeat(64),
        recognizedFormulaFunctions: [],
      },
    };

    const raw = JSON.stringify(content).length;
    expect(raw).toBeGreaterThan(CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES);

    const stored = convexSafeOfficeActivationContent("sheets", content);
    const storedText = JSON.stringify(stored);
    expect(storedText.length).toBeLessThanOrEqual(
      CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
    );
    expect(storedText).toContain("Density");
    expect(storedText).toContain("xlsx:sheet:1");
    // Budgeted head must stay nonempty (Empty sheet / hollow import guard).
    expect(storedText).toContain("density-0");
    // Must still drop the oversized tail so the hot row fits Convex.
    expect(storedText).not.toContain("density-7999");
  });


  it("keeps a nonempty head when activation content is already chunk-encoded", async () => {
    const { encodeArtifactContentForStorage, decodeSheetsContentFromStorage } =
      await import("../../../../shared/sheet-cells");
    const cells = Object.fromEntries(
      Array.from({ length: 12_000 }, (_, index) => [
        `A${index + 1}`,
        { value: `row-${index}-${"x".repeat(100)}` },
      ]),
    );
    const content = {
      workbook: {
        calculationMode: "automatic" as const,
        locale: "en-US",
        namedRanges: {},
        calculationVersion: 1,
      },
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Density",
          cells,
          tables: [],
          charts: [],
          mergedRanges: [],
        },
      ],
      activeSheetId: "xlsx:sheet:1",
    };
    const encoded = encodeArtifactContentForStorage("sheets", content);
    expect(JSON.stringify(encoded)).toContain("spectra-sheet-cells-v1");
    expect(JSON.stringify(encoded).length).toBeGreaterThan(
      CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
    );
    // Pass already-encoded content the way a Convex reload would.
    const stored = convexSafeOfficeActivationContent("sheets", encoded);
    const storedText = JSON.stringify(stored);
    expect(storedText.length).toBeLessThanOrEqual(
      CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
    );
    const decoded = decodeSheetsContentFromStorage(stored) as {
      sheets: Array<{ cells: Record<string, { value?: string }> }>;
    };
    expect(decoded.sheets[0]?.cells.A1?.value).toContain("row-0");
  });

  it("does not show Convex body-limit JSON to a person", () => {
    const leaked = `{"code": "BadJsonBody", "message": "Failed to buffer the request body: length limit exceeded"}`;
    expect(humanizePublicFailure(leaked, "Excel")).toContain("too large");
    expect(humanizePublicFailure(leaked)).not.toMatch(/BadJsonBody|length limit/i);
  });

  it("truncates a fidelity map that would overflow a Convex mutation", async () => {
    const { convexSafeFidelityMap } = await import("../lenses/office-content");
    const huge = Array.from({ length: 20_000 }, (_, index) => ({
      scope: `cell-${index}`,
      level: "adapted",
      message: "n".repeat(20),
    }));
    const stored = convexSafeFidelityMap(huge);
    expect(JSON.stringify(stored).length).toBeLessThan(500);
    expect(stored).toMatchObject({ truncated: true });
  });
});

describe("Library office import activation path", () => {
  it("stores the complete workbook before returning a bounded activation handle", async () => {
    const content=largeWorkbook();
    durableMocks.workbook.mockReturnValue(content);
    durableMocks.store.mockResolvedValueOnce(handle);
    const {POST}=await import("@/app/api/spectra/imports/office/route");
    const form=new FormData();
    form.set("file",new File(["fixture"],"large.xlsx")); form.set("artifactId","artifact");
    const response=await POST(new Request("http://fixture/api/spectra/imports/office",{method:"POST",body:form}));
    expect(response.status).toBe(200);
    const body=await response.json();
    expect(body).toMatchObject({activationStub:false,content:handle});
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(2048);
    const {decodeSheetsContentFromStorage}=await import("../../../../shared/sheet-cells");
    expect(decodeSheetsContentFromStorage(durableMocks.store.mock.calls.at(-1)![1])).toEqual(content);
  });
});

describe("Library import complete Convex field ceiling", () => {
  it("completes an import only with an adopted handle after encoding every cell", async () => {
    durableMocks.store.mockClear(); durableMocks.mutation.mockClear();
    durableMocks.store.mockResolvedValueOnce(handle);
    const {POST}=await import("@/app/api/spectra/imports/route");
    const {NextRequest}=await import("next/server");
    const content=largeWorkbook();
    const response=await POST(new NextRequest("http://fixture/api/spectra/imports",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"complete",jobId:"job",status:"imported",typeKey:"sheets",importedContent:content})}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ok:true,versionId:"version"});
    const {sheetCellEntries}=await import("../../../../shared/sheet-cells");
    const stored=durableMocks.store.mock.calls[0]![1] as {sheets: Array<{cells: unknown}>};
    expect(sheetCellEntries(stored.sheets[0]!.cells)).toHaveLength(12_000);
    expect(sheetCellEntries(stored.sheets[0]!.cells).at(-1)).toEqual(["A12000",content.sheets[0]!.cells.A12000]);
    expect(durableMocks.mutation).toHaveBeenCalledWith("artifactImports:complete",expect.objectContaining({importedContent:handle}));
    expect(durableMocks.store.mock.invocationCallOrder[0]).toBeLessThan(durableMocks.mutation.mock.invocationCallOrder[0]!);
  });

  it("does not fail Library import toast when commitImport is deferred", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/spectra/imports/route.ts", "utf8");
    const shell = readFileSync(
      "src/features/spectra/pages/spectra-shell.tsx",
      "utf8",
    );
    expect(route).toContain("commitDeferred");
    expect(shell).toContain("commitDeferred");
    expect(shell).toContain("completedImport.versionId");
  });
});
