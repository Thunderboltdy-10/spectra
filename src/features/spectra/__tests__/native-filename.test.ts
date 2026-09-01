import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filenameFromRelativePath } from "../../../../shared/native-filename";

describe("native Library identity", () => {
  it("uses the path basename, not a heading buried in the document", () => {
    expect(
      filenameFromRelativePath("IBDP1/Exercises/P5V1-Exercises-card6.docx"),
    ).toBe("P5V1-Exercises-card6.docx");
    expect(filenameFromRelativePath("P5V1-Exercises-control.docx")).toBe(
      "P5V1-Exercises-control.docx",
    );
    expect(
      filenameFromRelativePath("folder\\nested\\P5V1-Exercises-control.docx"),
    ).toBe("P5V1-Exercises-control.docx");
  });

  it("keeps checkpoint listing titles on the filename, not the projection heading", () => {
    const store = fs.readFileSync(
      path.join(process.cwd(), "convex/collaborationGatewayStore.ts"),
      "utf8",
    );
    expect(store).toContain("listingNameForNativeWork");
    expect(store).toContain("filenameFromRelativePath");
    expect(store).toContain("syncListingAfterProjection");
  });
});
