import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

/* "Shared" is conveyed by an icon next to the workspace name. An icon alone is
   invisible to a screen reader, so the indicator must carry text. */
describe("shared workspace indicator", () => {
  it("exposes the workspace header icon as an image with a name", () => {
    const source = read("src/features/spectra/pages/library-header.tsx");
    const indicator = source.slice(
      source.indexOf("workspace?.isShared ?"),
      source.indexOf("workspace?.isShared ?") + 300,
    );
    expect(indicator).toMatch(/role="img" aria-label="Shared workspace"/);
  });
});
