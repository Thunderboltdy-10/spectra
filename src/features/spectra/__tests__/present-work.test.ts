import { describe, expect, it } from "vitest";
import { presentWork, workTypeMeta } from "../artifacts/presentation";

describe("presentWork", () => {
  it("shows a file Spectra opens as its own work as that work", () => {
    expect(presentWork("resource", "Essay.docx")).toBe(workTypeMeta.document);
    expect(presentWork("resource", "Budget.XLSX")).toBe(workTypeMeta.sheets);
    expect(presentWork("resource", "Talk.pptx")).toBe(workTypeMeta.presentation);
  });

  it("names a file it can't open by its kind", () => {
    expect(presentWork("resource", "Old.doc").label).toBe("Word document");
    expect(presentWork("resource", "Paper.pdf").label).toBe("PDF");
    expect(presentWork("resource", "mystery.bin")).toBe(workTypeMeta.resource);
  });
});
