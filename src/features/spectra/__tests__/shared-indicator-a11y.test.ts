import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

/* "Shared" is conveyed by an icon next to the workspace name. An icon alone is
   invisible to a screen reader, so each indicator must carry text. */
describe("shared workspace indicator", () => {
  it("names the workspace switcher's shared icon for assistive technology", () => {
    const source = read("src/components/layout/rail.tsx");
    const indicator = source.slice(
      source.indexOf('workspace.ownership === "shared" ?'),
      source.indexOf('workspace.ownership === "shared" ?') + 400,
    );
    expect(indicator).toMatch(/role="img" aria-label="Shared workspace"/);
    expect(indicator).toMatch(/<Icon name="people"[^>]*aria-hidden="true"/);
  });

  it("exposes the workspace header icon as an image with a name", () => {
    const source = read("src/features/spectra/pages/spectra-shell.tsx");
    expect(source).toMatch(/role="img" aria-label="Shared workspace"/);
  });
});
