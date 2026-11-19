import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import pdfjsPackage from "pdfjs-dist/package.json";
import { pdfWorkerUrl } from "../pdfjs";

describe("pdf.js worker", () => {
  it("is vendored for the installed pdf.js version", () => {
    expect(existsSync(path.join(process.cwd(), "public", pdfWorkerUrl(pdfjsPackage.version)))).toBe(true);
  });
});
