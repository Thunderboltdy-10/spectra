import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { collaborationDocumentName } from "@/lib/collaboration-token";
import { artifactCollaborationPersistenceKey } from "../collaboration/use-artifact-collaboration";
import { requireArtifactTypeManifest } from "../artifacts/registry";

describe("Office lens collaboration transition", () => {
  it("uses a different authoritative room identity after a resource becomes a sheet", () => {
    expect(collaborationDocumentName("work-1", "root", "resource")).not.toBe(
      collaborationDocumentName("work-1", "root", "sheets"),
    );
  });

  it("does not restore a resource Yjs cache into the activated Office model", () => {
    expect(
      artifactCollaborationPersistenceKey("work-1", "root", "resource", 1),
    ).not.toBe(
      artifactCollaborationPersistenceKey("work-1", "root", "presentation", 1),
    );
  });

  it("keeps room and cache identity stable for later edits in the same model", () => {
    expect(collaborationDocumentName("work-1", "root", "sheets")).toBe(
      collaborationDocumentName("work-1", "root", "sheets"),
    );
    expect(
      artifactCollaborationPersistenceKey("work-1", "root", "sheets"),
    ).toBe(artifactCollaborationPersistenceKey("work-1", "root", "sheets"));
    expect(
      artifactCollaborationPersistenceKey("work-1", "root", "sheets", 3),
    ).not.toBe(
      artifactCollaborationPersistenceKey("work-1", "root", "sheets", 4),
    );
  });

  it("versions the N5 Sheets projection separately from legacy room history", () => {
    expect(requireArtifactTypeManifest("sheets").schemas.currentVersion).toBe(4);
  });

  it("still materializes Office bytes after a pending Yjs transport retry", () => {
    const source = readFileSync(
      "src/features/spectra/components/artifact-studio.tsx",
      "utf8",
    );
    const retryBranch = source.slice(
      source.indexOf("if (hadPendingTransportUpdate)"),
      source.indexOf("const nextLiveValue"),
    );
    expect(retryBranch).not.toContain("return true");
    expect(source).toContain("await queueNativeMaterialization(acknowledged)");
  });
});
