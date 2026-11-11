import { expect, it } from "vitest";
import { downloadFileName } from "../components/artifact-studio-file-utils";

it("never doubles an extension the title already has (F22)", () => {
  expect(downloadFileName("Live verification Word.docx.docx")).toBe("Live verification Word.docx");
  expect(downloadFileName("Notes.DOCX.docx")).toBe("Notes.DOCX");
  expect(downloadFileName("Essay.docx")).toBe("Essay.docx");
  expect(downloadFileName("v1.2.pdf")).toBe("v1.2.pdf");
  expect(downloadFileName("Plan.md.pdf")).toBe("Plan.md.pdf");
});
