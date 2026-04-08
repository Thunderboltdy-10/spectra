import { describe, expect, it } from "vitest";
import {
  resolveCanonicalWorkspaceItemType,
  normalizeCanonicalWorkspaceItemType,
  resolveWorkspaceCategory,
  resolveWorkspaceSourceKind,
  resolveWorkspaceSourceId,
} from "../workspaceHelpers";

/* ─── resolveCanonicalWorkspaceItemType ─────────────────── */

describe("resolveCanonicalWorkspaceItemType", () => {
  it("returns itemType when explicitly provided", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ itemType: "thread" }),
    ).toBe("thread");
    expect(
      resolveCanonicalWorkspaceItemType({ itemType: "artifact" }),
    ).toBe("artifact");
    expect(
      resolveCanonicalWorkspaceItemType({ itemType: "planner" }),
    ).toBe("planner");
    expect(
      resolveCanonicalWorkspaceItemType({ itemType: "utility" }),
    ).toBe("utility");
    expect(
      resolveCanonicalWorkspaceItemType({ itemType: "custom" }),
    ).toBe("custom");
  });

  it("prioritises itemType over source fields", () => {
    expect(
      resolveCanonicalWorkspaceItemType({
        itemType: "planner",
        sourceChatId: "chat_1" as never,
        sourceArtifactId: "art_1" as never,
      }),
    ).toBe("planner");
  });

  it("resolves sourceChatId to thread", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ sourceChatId: "chat_1" as never }),
    ).toBe("thread");
  });

  it("resolves sourcePlannerItemId to planner", () => {
    expect(
      resolveCanonicalWorkspaceItemType({
        sourcePlannerItemId: "plan_1" as never,
      }),
    ).toBe("planner");
  });

  it("resolves sourceArtifactId to artifact", () => {
    expect(
      resolveCanonicalWorkspaceItemType({
        sourceArtifactId: "art_1" as never,
      }),
    ).toBe("artifact");
  });

  it("prioritises sourceChatId over sourcePlannerItemId and sourceArtifactId", () => {
    expect(
      resolveCanonicalWorkspaceItemType({
        sourceChatId: "chat_1" as never,
        sourcePlannerItemId: "plan_1" as never,
        sourceArtifactId: "art_1" as never,
      }),
    ).toBe("thread");
  });

  it("prioritises sourcePlannerItemId over sourceArtifactId", () => {
    expect(
      resolveCanonicalWorkspaceItemType({
        sourcePlannerItemId: "plan_1" as never,
        sourceArtifactId: "art_1" as never,
      }),
    ).toBe("planner");
  });

  it("falls back to legacyType === thread", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "thread" }),
    ).toBe("thread");
  });

  it("falls back to legacyType === planner", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "planner" }),
    ).toBe("planner");
  });

  it("falls back to legacyType === utility", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "utility" }),
    ).toBe("utility");
  });

  it("falls back to legacyType === custom", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "custom" }),
    ).toBe("custom");
  });

  it("returns artifact for legacy document type", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "document" }),
    ).toBe("artifact");
  });

  it("returns artifact for legacy visualization type", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "visualization" }),
    ).toBe("artifact");
  });

  it("returns artifact for legacy board type", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "board" }),
    ).toBe("artifact");
  });

  it("returns artifact for legacy media type", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "media" }),
    ).toBe("artifact");
  });

  it("returns artifact for legacy reference type", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: "reference" }),
    ).toBe("artifact");
  });

  it("defaults to artifact when nothing is provided", () => {
    expect(resolveCanonicalWorkspaceItemType({})).toBe("artifact");
  });

  it("defaults to artifact for undefined legacy type", () => {
    expect(
      resolveCanonicalWorkspaceItemType({ legacyType: undefined }),
    ).toBe("artifact");
  });

  // VAL-W1-003: Dual-read — itemType takes priority over source/legacy fields
  it("supports dual-read: itemType present overrides legacy type", () => {
    expect(
      resolveCanonicalWorkspaceItemType({
        itemType: "artifact",
        legacyType: "thread",
      }),
    ).toBe("artifact");
  });

  it("supports dual-read: source fields resolve when itemType is absent", () => {
    expect(
      resolveCanonicalWorkspaceItemType({
        sourceChatId: "chat_1" as never,
        legacyType: "document",
      }),
    ).toBe("thread");
  });

  it("supports dual-read: legacy type resolves when no source fields or itemType", () => {
    expect(
      resolveCanonicalWorkspaceItemType({
        legacyType: "utility",
      }),
    ).toBe("utility");
  });
});

/* ─── normalizeCanonicalWorkspaceItemType ────────────────── */

describe("normalizeCanonicalWorkspaceItemType", () => {
  it("returns valid canonical types as-is", () => {
    expect(normalizeCanonicalWorkspaceItemType("thread")).toBe("thread");
    expect(normalizeCanonicalWorkspaceItemType("artifact")).toBe("artifact");
    expect(normalizeCanonicalWorkspaceItemType("planner")).toBe("planner");
    expect(normalizeCanonicalWorkspaceItemType("utility")).toBe("utility");
    expect(normalizeCanonicalWorkspaceItemType("custom")).toBe("custom");
  });

  // VAL-W1-097: Invalid values must return "custom"
  it("rejects empty string → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("")).toBe("custom");
  });

  it("rejects 'note' → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("note")).toBe("custom");
  });

  it("rejects 'visual' → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("visual")).toBe("custom");
  });

  it("rejects 'code' → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("code")).toBe("custom");
  });

  it("rejects 'export' → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("export")).toBe("custom");
  });

  it("rejects 'board' → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("board")).toBe("custom");
  });

  it("rejects 'document' → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("document")).toBe("custom");
  });

  it("rejects 'media' → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("media")).toBe("custom");
  });

  it("rejects random string → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType("unknown")).toBe("custom");
  });

  it("rejects undefined → custom", () => {
    expect(normalizeCanonicalWorkspaceItemType(undefined)).toBe("custom");
  });
});

/* ─── resolveWorkspaceCategory ──────────────────────────── */

describe("resolveWorkspaceCategory", () => {
  it("returns explicit category when provided", () => {
    expect(
      resolveWorkspaceCategory({ explicitCategory: "documents" }),
    ).toBe("documents");
    expect(
      resolveWorkspaceCategory({ explicitCategory: "visualizations" }),
    ).toBe("visualizations");
  });

  it("resolves thread itemType to threads", () => {
    expect(
      resolveWorkspaceCategory({ itemType: "thread" }),
    ).toBe("threads");
  });

  it("resolves thread legacyType to threads", () => {
    expect(
      resolveWorkspaceCategory({ legacyType: "thread" }),
    ).toBe("threads");
  });

  it("resolves planner itemType to planner", () => {
    expect(
      resolveWorkspaceCategory({ itemType: "planner" }),
    ).toBe("planner");
  });

  it("resolves planner legacyType to planner", () => {
    expect(
      resolveWorkspaceCategory({ legacyType: "planner" }),
    ).toBe("planner");
  });

  it("resolves utility itemType to custom", () => {
    expect(
      resolveWorkspaceCategory({ itemType: "utility" }),
    ).toBe("custom");
  });

  // renderMode-based resolution
  it("resolves document renderMode to documents", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "document" }),
    ).toBe("documents");
  });

  it("resolves note renderMode to documents", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "note" }),
    ).toBe("documents");
  });

  it("resolves study_plan renderMode to documents", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "study_plan" }),
    ).toBe("documents");
  });

  it("resolves flashcard_deck renderMode to documents", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "flashcard_deck" }),
    ).toBe("documents");
  });

  it("resolves code_project renderMode to documents", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "code_project" }),
    ).toBe("documents");
  });

  it("resolves timetable renderMode to planner", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "timetable" }),
    ).toBe("planner");
  });

  it("resolves board renderMode to boards", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "board" }),
    ).toBe("boards");
  });

  it("resolves visualization renderMode to visualizations", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "visualization" }),
    ).toBe("visualizations");
  });

  it("resolves concept_map renderMode to visualizations", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "concept_map" }),
    ).toBe("visualizations");
  });

  it("resolves quiz renderMode to visualizations", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "quiz" }),
    ).toBe("visualizations");
  });

  it("resolves whiteboard renderMode to visualizations", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "whiteboard" }),
    ).toBe("visualizations");
  });

  it("resolves code_output renderMode to visualizations", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "code_output" }),
    ).toBe("visualizations");
  });

  it("resolves image renderMode to media", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "image" }),
    ).toBe("media");
  });

  it("resolves diagram renderMode to media", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "diagram" }),
    ).toBe("media");
  });

  it("resolves bookmark renderMode to references", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "bookmark" }),
    ).toBe("references");
  });

  it("resolves collection renderMode to references", () => {
    expect(
      resolveWorkspaceCategory({ renderMode: "collection" }),
    ).toBe("references");
  });

  // Legacy type fallback
  it("falls back to legacyType document → documents", () => {
    expect(
      resolveWorkspaceCategory({ legacyType: "document" }),
    ).toBe("documents");
  });

  it("falls back to legacyType board → boards", () => {
    expect(
      resolveWorkspaceCategory({ legacyType: "board" }),
    ).toBe("boards");
  });

  it("falls back to legacyType visualization → visualizations", () => {
    expect(
      resolveWorkspaceCategory({ legacyType: "visualization" }),
    ).toBe("visualizations");
  });

  it("falls back to legacyType media → media", () => {
    expect(
      resolveWorkspaceCategory({ legacyType: "media" }),
    ).toBe("media");
  });

  it("falls back to legacyType reference → references", () => {
    expect(
      resolveWorkspaceCategory({ legacyType: "reference" }),
    ).toBe("references");
  });

  it("defaults to custom for unknown inputs", () => {
    expect(resolveWorkspaceCategory({})).toBe("custom");
  });
});

/* ─── resolveWorkspaceSourceKind ─────────────────────────── */

describe("resolveWorkspaceSourceKind", () => {
  it("resolves sourceChatId to chat", () => {
    expect(
      resolveWorkspaceSourceKind({ sourceChatId: "chat_1" as never }),
    ).toBe("chat");
  });

  it("resolves sourceArtifactId to artifact", () => {
    expect(
      resolveWorkspaceSourceKind({ sourceArtifactId: "art_1" as never }),
    ).toBe("artifact");
  });

  it("resolves sourcePlannerItemId to plannerItem", () => {
    expect(
      resolveWorkspaceSourceKind({ sourcePlannerItemId: "plan_1" as never }),
    ).toBe("plannerItem");
  });

  it("resolves utility itemType to utility", () => {
    expect(resolveWorkspaceSourceKind({ itemType: "utility" })).toBe("utility");
  });

  it("resolves custom itemType to custom", () => {
    expect(resolveWorkspaceSourceKind({ itemType: "custom" })).toBe("custom");
  });

  it("returns undefined for artifact itemType without source ids", () => {
    expect(resolveWorkspaceSourceKind({ itemType: "artifact" })).toBeUndefined();
  });

  it("returns undefined for thread itemType without source ids", () => {
    expect(resolveWorkspaceSourceKind({ itemType: "thread" })).toBeUndefined();
  });

  it("returns undefined when nothing is provided", () => {
    expect(resolveWorkspaceSourceKind({})).toBeUndefined();
  });
});

/* ─── resolveWorkspaceSourceId ───────────────────────────── */

describe("resolveWorkspaceSourceId", () => {
  it("returns sourceChatId when present", () => {
    expect(
      resolveWorkspaceSourceId({ sourceChatId: "chat_1" as never }),
    ).toBe("chat_1");
  });

  it("returns sourceArtifactId when present", () => {
    expect(
      resolveWorkspaceSourceId({ sourceArtifactId: "art_1" as never }),
    ).toBe("art_1");
  });

  it("returns sourcePlannerItemId when present", () => {
    expect(
      resolveWorkspaceSourceId({ sourcePlannerItemId: "plan_1" as never }),
    ).toBe("plan_1");
  });

  it("returns undefined when nothing is provided", () => {
    expect(resolveWorkspaceSourceId({})).toBeUndefined();
  });
});
