import { describe, expect, it } from "vitest";
import {
  workspaceItemTypeForArtifact,
  workspaceCategoryForArtifact,
} from "../../../convex/workspaceItemSync";
import {
  ARTIFACT_TYPES,
  CANONICAL_WORKSPACE_TYPES,
  ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE,
  LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE,
  canonicalWorkspaceTypeForArtifactType,
  canonicalWorkspaceTypeForLegacyType,
  type ArtifactType,
  type CanonicalWorkspaceType,
} from "../artifact-types";

/* ─── workspaceItemTypeForArtifact ──────────────────────── */

describe("workspaceItemTypeForArtifact", () => {
  // VAL-W1-099: All artifact types must map to a valid type, no undefined

  it("maps document → document", () => {
    expect(workspaceItemTypeForArtifact("document")).toBe("document");
  });

  it("maps study_plan → document", () => {
    expect(workspaceItemTypeForArtifact("study_plan")).toBe("document");
  });

  it("maps flashcard_deck → document", () => {
    expect(workspaceItemTypeForArtifact("flashcard_deck")).toBe("document");
  });

  it("maps code_project → document", () => {
    expect(workspaceItemTypeForArtifact("code_project")).toBe("document");
  });

  it("maps timetable → planner", () => {
    expect(workspaceItemTypeForArtifact("timetable")).toBe("planner");
  });

  it("maps visualization → visualization", () => {
    expect(workspaceItemTypeForArtifact("visualization")).toBe("visualization");
  });

  it("maps concept_map → visualization", () => {
    expect(workspaceItemTypeForArtifact("concept_map")).toBe("visualization");
  });

  it("maps quiz → visualization", () => {
    expect(workspaceItemTypeForArtifact("quiz")).toBe("visualization");
  });

  it("maps image → media", () => {
    expect(workspaceItemTypeForArtifact("image")).toBe("media");
  });

  it("maps diagram → media", () => {
    expect(workspaceItemTypeForArtifact("diagram")).toBe("media");
  });

  it("maps bookmark → reference", () => {
    expect(workspaceItemTypeForArtifact("bookmark")).toBe("reference");
  });

  it("maps collection → reference", () => {
    expect(workspaceItemTypeForArtifact("collection")).toBe("reference");
  });

  it("maps whiteboard → custom", () => {
    expect(workspaceItemTypeForArtifact("whiteboard")).toBe("custom");
  });

  it("maps code_output → custom", () => {
    expect(workspaceItemTypeForArtifact("code_output")).toBe("custom");
  });

  it("maps note → custom (default branch)", () => {
    expect(workspaceItemTypeForArtifact("note")).toBe("custom");
  });

  it("maps custom → custom", () => {
    expect(workspaceItemTypeForArtifact("custom")).toBe("custom");
  });

  it("maps unknown string → custom (safe fallback)", () => {
    expect(workspaceItemTypeForArtifact("totally_unknown")).toBe("custom");
  });

  it("never returns undefined for any ARTIFACT_TYPE", () => {
    for (const type of ARTIFACT_TYPES) {
      const result = workspaceItemTypeForArtifact(type);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    }
  });
});

/* ─── workspaceCategoryForArtifact ──────────────────────── */

describe("workspaceCategoryForArtifact", () => {
  // VAL-W1-100: All artifact types must map to a valid category, no undefined

  it("maps document → documents", () => {
    expect(workspaceCategoryForArtifact("document")).toBe("documents");
  });

  it("maps note → documents", () => {
    expect(workspaceCategoryForArtifact("note")).toBe("documents");
  });

  it("maps study_plan → documents", () => {
    expect(workspaceCategoryForArtifact("study_plan")).toBe("documents");
  });

  it("maps flashcard_deck → documents", () => {
    expect(workspaceCategoryForArtifact("flashcard_deck")).toBe("documents");
  });

  it("maps code_project → documents", () => {
    expect(workspaceCategoryForArtifact("code_project")).toBe("documents");
  });

  it("maps timetable → planner", () => {
    expect(workspaceCategoryForArtifact("timetable")).toBe("planner");
  });

  it("maps visualization → visualizations", () => {
    expect(workspaceCategoryForArtifact("visualization")).toBe("visualizations");
  });

  it("maps concept_map → visualizations", () => {
    expect(workspaceCategoryForArtifact("concept_map")).toBe("visualizations");
  });

  it("maps quiz → visualizations", () => {
    expect(workspaceCategoryForArtifact("quiz")).toBe("visualizations");
  });

  it("maps code_output → visualizations", () => {
    expect(workspaceCategoryForArtifact("code_output")).toBe("visualizations");
  });

  it("maps whiteboard → visualizations", () => {
    expect(workspaceCategoryForArtifact("whiteboard")).toBe("visualizations");
  });

  it("maps image → media", () => {
    expect(workspaceCategoryForArtifact("image")).toBe("media");
  });

  it("maps diagram → media", () => {
    expect(workspaceCategoryForArtifact("diagram")).toBe("media");
  });

  it("maps bookmark → references", () => {
    expect(workspaceCategoryForArtifact("bookmark")).toBe("references");
  });

  it("maps collection → references", () => {
    expect(workspaceCategoryForArtifact("collection")).toBe("references");
  });

  it("maps custom → custom (default)", () => {
    expect(workspaceCategoryForArtifact("custom")).toBe("custom");
  });

  it("maps unknown string → custom (safe fallback)", () => {
    expect(workspaceCategoryForArtifact("totally_unknown")).toBe("custom");
  });

  it("never returns undefined for any ARTIFACT_TYPE", () => {
    for (const type of ARTIFACT_TYPES) {
      const result = workspaceCategoryForArtifact(type);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    }
  });
});

/* ─── Canonical workspace-facing type definitions ────────── */

describe("CANONICAL_WORKSPACE_TYPES", () => {
  // VAL-W1-001: The seven canonical workspace-facing types
  it("includes all 7 required canonical types", () => {
    const required: CanonicalWorkspaceType[] = [
      "note",
      "visual",
      "code",
      "export",
      "board",
      "flashcard_deck",
      "quiz",
    ];
    for (const type of required) {
      expect(CANONICAL_WORKSPACE_TYPES).toContain(type);
    }
  });

  it("includes thread and planner for completeness", () => {
    expect(CANONICAL_WORKSPACE_TYPES).toContain("thread");
    expect(CANONICAL_WORKSPACE_TYPES).toContain("planner");
  });

  it("has no duplicate entries", () => {
    const unique = new Set(CANONICAL_WORKSPACE_TYPES);
    expect(unique.size).toBe(CANONICAL_WORKSPACE_TYPES.length);
  });
});

/* ─── ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE mapping ─────── */

describe("ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE", () => {
  // VAL-W1-002: Every artifact type must map to a canonical type
  it("maps every ARTIFACT_TYPE to a valid canonical type", () => {
    for (const type of ARTIFACT_TYPES) {
      const mapping = ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE[type];
      expect(mapping).toBeDefined();
      expect(CANONICAL_WORKSPACE_TYPES).toContain(mapping);
    }
  });

  it("maps note/document/study_plan to note canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.note).toBe("note");
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.document).toBe("note");
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.study_plan).toBe("note");
  });

  it("maps visualization/concept_map/diagram to visual canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.visualization).toBe("visual");
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.concept_map).toBe("visual");
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.diagram).toBe("visual");
  });

  it("maps code_project/code_output to code canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.code_project).toBe("code");
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.code_output).toBe("code");
  });

  it("maps bookmark/collection/custom to export canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.bookmark).toBe("export");
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.collection).toBe("export");
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.custom).toBe("export");
  });

  it("maps whiteboard to board canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.whiteboard).toBe("board");
  });

  it("maps flashcard_deck to flashcard_deck canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.flashcard_deck).toBe("flashcard_deck");
  });

  it("maps quiz to quiz canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.quiz).toBe("quiz");
  });

  it("maps timetable to planner canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.timetable).toBe("planner");
  });

  it("maps image to visual canonical type", () => {
    expect(ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE.image).toBe("visual");
  });
});

/* ─── LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE mapping ──── */

describe("LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE", () => {
  // VAL-W1-003: Dual-read — legacy type values must map to canonical types
  it("maps thread → thread", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.thread).toBe("thread");
  });

  it("maps document → note", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.document).toBe("note");
  });

  it("maps planner → planner", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.planner).toBe("planner");
  });

  it("maps board → board", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.board).toBe("board");
  });

  it("maps visualization → visual", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.visualization).toBe("visual");
  });

  it("maps media → visual", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.media).toBe("visual");
  });

  it("maps reference → export", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.reference).toBe("export");
  });

  it("maps custom → export", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.custom).toBe("export");
  });

  it("maps utility → export", () => {
    expect(LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE.utility).toBe("export");
  });
});

/* ─── canonicalWorkspaceTypeForArtifactType function ──── */

describe("canonicalWorkspaceTypeForArtifactType", () => {
  it("returns correct canonical type for known artifact types", () => {
    expect(canonicalWorkspaceTypeForArtifactType("note")).toBe("note");
    expect(canonicalWorkspaceTypeForArtifactType("visualization")).toBe("visual");
    expect(canonicalWorkspaceTypeForArtifactType("code_project")).toBe("code");
    expect(canonicalWorkspaceTypeForArtifactType("bookmark")).toBe("export");
    expect(canonicalWorkspaceTypeForArtifactType("whiteboard")).toBe("board");
    expect(canonicalWorkspaceTypeForArtifactType("flashcard_deck")).toBe("flashcard_deck");
    expect(canonicalWorkspaceTypeForArtifactType("quiz")).toBe("quiz");
  });

  it("falls back to export for unknown artifact types", () => {
    expect(canonicalWorkspaceTypeForArtifactType("unknown_type")).toBe("export");
  });

  it("never returns undefined for any ARTIFACT_TYPE", () => {
    for (const type of ARTIFACT_TYPES) {
      const result = canonicalWorkspaceTypeForArtifactType(type);
      expect(result).toBeDefined();
      expect(CANONICAL_WORKSPACE_TYPES).toContain(result);
    }
  });
});

/* ─── canonicalWorkspaceTypeForLegacyType function ────── */

describe("canonicalWorkspaceTypeForLegacyType", () => {
  it("returns correct canonical type for known legacy types", () => {
    expect(canonicalWorkspaceTypeForLegacyType("thread")).toBe("thread");
    expect(canonicalWorkspaceTypeForLegacyType("document")).toBe("note");
    expect(canonicalWorkspaceTypeForLegacyType("planner")).toBe("planner");
    expect(canonicalWorkspaceTypeForLegacyType("board")).toBe("board");
    expect(canonicalWorkspaceTypeForLegacyType("visualization")).toBe("visual");
    expect(canonicalWorkspaceTypeForLegacyType("media")).toBe("visual");
    expect(canonicalWorkspaceTypeForLegacyType("reference")).toBe("export");
  });

  it("falls back to export for unknown legacy types", () => {
    expect(canonicalWorkspaceTypeForLegacyType("unknown_type")).toBe("export");
  });
});
