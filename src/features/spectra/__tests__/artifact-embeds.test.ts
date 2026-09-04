import { createHash } from "crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_EMBED_CONTEXT_POLICIES,
  ARTIFACT_EMBED_INTERACTIONS,
  ARTIFACT_EMBED_MODES,
  ARTIFACT_EMBED_STATES,
  ARTIFACT_EMBED_VERSION_POLICIES,
} from "../../../../shared/artifact-embed";
import {
  embedCapabilitiesFor,
  embedCapabilityEnabled,
  suggestedEmbedInteraction,
} from "../capabilities";
import {
  readBoundedRuntimeResponse,
  verifyEmbeddedRuntimeBytes,
} from "../code/embed-runtime-integrity";
import { publishedRuntimeSourceUrl } from "../code/published-runtime-source";
import { shouldMountArtifactEmbedRuntime } from "../components/artifact-embed-runtime";
import { embeddedQuizIsPublished } from "../components/artifact-embed-quiz";
import {
  changeReferenceView,
  referenceIdentity,
  resizeReference,
  setReferenceMode,
  type ReferenceNode,
} from "../references";
import { referenceFallbackSvg } from "../references/export/reference-fallback";
import { createWhiteboardNode } from "../whiteboard/model";
import type { SpectraArtifactEmbed } from "../data/api";

function reference(): ReferenceNode {
  return {
    embedId: "embed-1",
    containerType: "artifact",
    containerId: "document-1",
    containerRegionId: "artifact:structure",
    sourceArtifactId: "quiz-1",
    mode: "compact",
    interaction: "interact",
    versionPolicy: "live",
    contextPolicy: "summary",
    state: "ready",
  };
}

describe("P5.I3 embed convergence", () => {
  it("keeps removed placements in the canonical state model for honest cleanup", () => {
    expect(ARTIFACT_EMBED_STATES).toContain("removed");
  });

  it("keeps Convex and client enum values in one canonical runtime schema", () => {
    expect(ARTIFACT_EMBED_MODES).toEqual(["compact", "expanded"]);
    expect(ARTIFACT_EMBED_INTERACTIONS).toEqual([
      "read",
      "interact",
      "edit",
    ]);
    expect(ARTIFACT_EMBED_VERSION_POLICIES).toEqual(["live", "pinned"]);
    expect(ARTIFACT_EMBED_CONTEXT_POLICIES).toEqual([
      "none",
      "summary",
      "visible_region",
    ]);
  });

  it("keeps one canonical identity across host presentation changes", () => {
    const initial = reference();
    const changed = changeReferenceView(
      resizeReference(setReferenceMode(initial, "expanded"), 900, 700, {
        width: 620,
        height: 480,
      }),
      "practice",
    );
    expect(referenceIdentity(changed)).toBe("embed-1");
    expect(changed).toMatchObject({
      sourceArtifactId: "quiz-1",
      mode: "expanded",
      displayPreferences: { width: 620, height: 480, view: "practice" },
    });
  });

  it("derives embedded interaction from exact IR operations", () => {
    expect(suggestedEmbedInteraction("quiz")).toBe("interact");
    expect(suggestedEmbedInteraction("document")).toBe("read");
    expect(embedCapabilityEnabled("quiz", "interact", "attempt.answer")).toBe(
      true,
    );
    expect(embedCapabilityEnabled("quiz", "read", "attempt.answer")).toBe(
      false,
    );
    expect(
      embedCapabilityEnabled("flashcard_deck", "interact", "study.reveal"),
    ).toBe(true);
    expect(embedCapabilityEnabled("code", "interact", "runtime.interact")).toBe(
      true,
    );
    expect(
      embedCapabilitiesFor("quiz", "interact").map((row) => row.id),
    ).toEqual(
      expect.arrayContaining([
        "quiz.attempt.answer",
        "quiz.attempt.navigate",
        "quiz.attempt.submit",
      ]),
    );
  });

  it("does not offer a private attempt for an unpublished live quiz", () => {
    const embed: SpectraArtifactEmbed = {
      ...reference(),
      source: {
        artifactId: "quiz-1",
        title: "Draft quiz",
        blueprintKey: "quiz",
        snapshot: { content: { published: false, questions: [] } },
      },
    };
    expect(embeddedQuizIsPublished(embed)).toBe(false);
    expect(
      embeddedQuizIsPublished({
        ...embed,
        source: {
          ...embed.source!,
          snapshot: { content: { published: true, questions: [] } },
        },
      }),
    ).toBe(true);
  });

  it("builds an escaped native fallback with a stable source link", () => {
    const svg = referenceFallbackSvg({
      title: "Vectors < limits & proof",
      typeLabel: "Quiz",
      sourceArtifactId: "quiz-1",
      sourceUrl: "https://spectra.test/library/quiz-1?a=1&b=2",
      versionLabel: "Live",
    });
    expect(svg).toContain("Vectors &lt; limits &amp; proof");
    expect(svg).toContain("https://spectra.test/library/quiz-1?a=1&amp;b=2");
    expect(svg).not.toContain("<script");
  });

  it("enforces retained runtime size and SHA-256 before execution", () => {
    const bytes = new TextEncoder().encode('{"ok":true}');
    const payloadHash = createHash("sha256").update(bytes).digest("hex");
    expect(() =>
      verifyEmbeddedRuntimeBytes(bytes, {
        payloadHash,
        payloadBytes: bytes.byteLength,
      }),
    ).not.toThrow();
    expect(() =>
      verifyEmbeddedRuntimeBytes(bytes, {
        payloadHash: "0".repeat(64),
        payloadBytes: bytes.byteLength,
      }),
    ).toThrow("RUNTIME_BUILD_INTEGRITY_FAILED");
    expect(() =>
      verifyEmbeddedRuntimeBytes(bytes, {
        payloadHash,
        payloadBytes: bytes.byteLength + 1,
      }),
    ).toThrow("RUNTIME_BUILD_SIZE_MISMATCH");
  });

  it("stops reading a retained runtime as soon as the byte budget is crossed", async () => {
    await expect(
      readBoundedRuntimeResponse(
        new Response(new Uint8Array([1, 2, 3, 4, 5])),
        4,
      ),
    ).rejects.toThrow("RUNTIME_BUILD_LIMIT");
    await expect(
      readBoundedRuntimeResponse(new Response(new Uint8Array([1, 2, 3, 4])), 4),
    ).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("uses a same-origin source for private embeds and preserves public shares", () => {
    expect(
      publishedRuntimeSourceUrl(
        { storageUrl: "https://storage.example/bearer" },
        "embed private/1",
      ),
    ).toBe("/api/spectra/runtime/embed?embedId=embed%20private%2F1");
    expect(
      publishedRuntimeSourceUrl({
        storageUrl: "https://storage.example/public-share",
      }),
    ).toBe("https://storage.example/public-share");
  });

  it("unmounts only code runtimes off-screen or on hidden pages", () => {
    expect(
      shouldMountArtifactEmbedRuntime({
        sourceType: "code",
        nearViewport: false,
        pageVisible: true,
      }),
    ).toBe(false);
    expect(
      shouldMountArtifactEmbedRuntime({
        sourceType: "code",
        nearViewport: true,
        pageVisible: false,
      }),
    ).toBe(false);
    expect(
      shouldMountArtifactEmbedRuntime({
        sourceType: "quiz",
        nearViewport: false,
        pageVisible: false,
      }),
    ).toBe(true);
  });

  it("gives a whiteboard embed a stable 4:3 host instead of note dimensions", () => {
    const node = createWhiteboardNode("embed", "page-1", "layer-1", 10, 20, 1);
    expect(node).toMatchObject({
      type: "embed",
      width: 400,
      height: 300,
      x: 10,
      y: 20,
    });
  });

  it("lists embeds as empty when the reader is not yet signed in", () => {
    const source = readFileSync(
      path.join(process.cwd(), "convex/artifactEmbeds.ts"),
      "utf8",
    );
    expect(source).toContain("getOptionalAuthenticatedActor");
    expect(source).toContain(
      "if (!actorValue) return { canConfigure: false, embeds: [] };",
    );
  });
});
