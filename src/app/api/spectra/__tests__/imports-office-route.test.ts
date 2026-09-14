import { describe, expect, it, vi, beforeEach } from "vitest";

const actor = {
  clerkId: "office-import-owner",
  accountId: "account-office-import-owner",
  email: "office-import@example.test",
  emailVerified: true,
  name: "Office import owner",
  schoolId: "school-office-import",
  schoolRole: "school_admin" as const,
  membershipId: "membership-office-import",
};

vi.mock("@/lib/auth-server", () => ({
  requireActor: vi.fn(async () => actor),
}));

vi.mock("@/features/spectra/lenses/docx-lens", () => ({
  docxLens: {
    open: vi.fn(async () => ({
      projection: { blocks: [{ id: "p1", text: "ok" }] },
      fidelityMap: { entries: [] },
      preservedCarry: {},
    })),
  },
}));

vi.mock("@/features/spectra/lenses/document-projection", () => ({
  compactDocxProjectionForStorage: vi.fn((projection: unknown) => projection),
}));

vi.mock("@/features/spectra/lenses/xlsx-lens", () => ({
  xlsxLens: { open: vi.fn() },
}));

vi.mock("@/features/spectra/lenses/pptx-lens", () => ({
  pptxLens: { open: vi.fn() },
}));

vi.mock("@/features/spectra/lenses/office-content", () => ({
  xlsxArtifactContent: vi.fn(),
  pptxArtifactContent: vi.fn(),
}));

describe("imports/office route legacy .doc refuse", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function postNamedFile(name: string, bytes: Uint8Array = new Uint8Array([1, 2, 3])) {
    const { POST } = await import("../imports/office/route");
    const body = new FormData();
    body.set("file", new File([bytes], name, { type: "application/octet-stream" }));
    return POST(new Request("http://localhost/api/spectra/imports/office", {
      method: "POST",
      body,
    }));
  }

  it("fails closed on legacy .doc instead of pretending OOXML", async () => {
    const response = await postNamedFile("essay.doc");
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ error: "IMPORT_OFFICE_FORMAT_UNSUPPORTED" });
    const { docxLens } = await import("@/features/spectra/lenses/docx-lens");
    expect(docxLens.open).not.toHaveBeenCalled();
  });

  it("still opens .docx through the Word lens", async () => {
    const response = await postNamedFile("essay.docx");
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      blueprintKey: "document",
      nativeFormat: "docx",
    });
    const { docxLens } = await import("@/features/spectra/lenses/docx-lens");
    expect(docxLens.open).toHaveBeenCalledTimes(1);
  });
});
