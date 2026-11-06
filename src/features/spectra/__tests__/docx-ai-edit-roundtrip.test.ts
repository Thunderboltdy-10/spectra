import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { initializeNativeArtifactDocument } from "../../../../scripts/collaboration-native-projection.mjs";
import { durableFrontierHash, stateVectorHash } from "../../../../scripts/collaboration-canonical-room.mjs";
import { authorEdit } from "../ai/harness/authoring";
import { documentToMarkdown } from "../ai/harness/authoring/document";
import { prepareCanonicalAiUpdate, type NativeAiHead } from "../ai/canonical-ai-update";
import { bindDocxProjectionSource, compactDocxProjectionForStorage, docxProjectionFromContent } from "../lenses/document-projection";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest, docxReadbackDifference } from "../lenses/docx-lens";

type Op = Record<string, unknown>;

/** The AI edit pipeline without Convex: Yjs base, authoring, Word write and
 * readback, then the same admission evidence the sink verifies. */
async function runEdit(payload: Uint8Array, opsFor: (markdown: string) => Op[]) {
  const opened = await docxLens.open(payload, "strict-native");
  const bound = bindDocxProjectionSource(opened.projection, "artifact", "a".repeat(64));
  const document = new Y.Doc();
  initializeNativeArtifactDocument(document, { title: "Doc", tags: [], content: compactDocxProjectionForStorage(bound), typeKey: "document", schemaVersion: 4 });
  const stored = { roomId: "room", nextSequence: 2, liveStateVectorHash: stateVectorHash(document),
    updates: [{ sequence: 1, update: Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64") }] };
  const bridge = vi.fn(async () => stored);
  const head = { accountId: "account", artifact: { _id: "artifact", blueprintKey: "document", schemaVersion: 4, updatedAt: 100, contentHash: "h" },
    operationDigest: "op", prompt: "Edit", operation: { id: "op", type: "artifact.update", input: {} }, sourceContentIdentity: "s",
    room: { _id: "room", nextSequence: 2, policyVersion: 3 }, committedResult: null } as unknown as NativeAiHead;
  const { artifactProjection } = await import("../../../../scripts/collaboration-artifact-projection.mjs");
  const before = JSON.parse(artifactProjection(document, 4)!).content as Record<string, unknown>;
  const authored = authorEdit("document", before, opsFor(documentToMarkdown(before)), { timeZone: "UTC" });
  head.operation.input = { content: authored.content };
  const update = docxProjectionFromContent(authored.content, opened.projection);
  const output = update.operations.length ? await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations }, {}) : payload;
  const next = await docxLens.open(output, "strict-native");
  const nextBound = bindDocxProjectionSource(next.projection, "artifact", "b".repeat(64));
  const requested = await docxProjectionSemanticDigest(update.projection);
  const readback = await docxProjectionReadbackDigest(nextBound, update.projection);
  const readbackProblem = requested === readback ? null : await docxReadbackDifference(nextBound, update.projection);
  const desired = { title: "Doc", tags: [], content: compactDocxProjectionForStorage(nextBound) };
  try {
    const prepared = await prepareCanonicalAiUpdate({ head, bridge, authoredFrontier: durableFrontierHash(document), desired, clientId: "ai", operationId: "op" });
    return { output, readbackProblem, after: prepared.after };
  } finally { document.destroy(); }
}

const unique = (markdown: string, chunk: string) => markdown.split(chunk).length === 2;
function firstProse(markdown: string) {
  return markdown.split("\n\n").find((chunk) => /^[A-Z]/.test(chunk) && chunk.length > 12 && unique(markdown, chunk))!;
}
function firstHeading(markdown: string) {
  return markdown.split("\n\n").find((chunk) => /^#{1,6} /.test(chunk) && unique(markdown, chunk)) ?? firstProse(markdown);
}

const cases: Record<string, (markdown: string) => Op[]> = {
  "replace words": (markdown) => {
    const paragraph = firstProse(markdown);
    return [{ op: "replace", find: paragraph, replace: `${paragraph} Extra sentence.` }];
  },
  "rename heading": (markdown) => {
    const heading = firstHeading(markdown);
    return [{ op: "replace", find: heading, replace: `${heading} revised` }];
  },
  "insert section": () => [{ op: "insert", position: "end", markdown: "## New section\n\nSome *new* text with **bold**.\n\n- one\n- two" }],
  "rewrite paragraph as list": (markdown) => {
    const paragraph = firstProse(markdown);
    return [{ op: "replace", find: paragraph, replace: "- first point\n- second point" }];
  },
  "delete paragraph": (markdown) => [{ op: "replace", find: firstProse(markdown), replace: "" }],
  "plain heading": (markdown) => {
    const heading = firstHeading(markdown);
    return [{ op: "replace", find: heading, replace: heading.replace(/\*\*/g, "") }];
  },
  "bold paragraph": (markdown) => {
    const paragraph = firstProse(markdown);
    return [{ op: "replace", find: paragraph, replace: `**${paragraph}**` }];
  },
};

/*
 * A file with no Word paragraph ids, as python-docx and many other writers make
 * them. Every one of these used to fail: the first save gives the file its ids,
 * Word assigns block ids, merges runs and resolves style formatting, and each of
 * those read as an unauthorised change.
 */
describe("AI edits to an imported Word file", () => {
  const payload = () => new Uint8Array(readFileSync(join(process.cwd(), "fixtures", "office", "docx", "python-docx-notes.docx")));
  for (const [label, ops] of Object.entries(cases)) {
    it(label, async () => {
      const result = await runEdit(payload(), ops);
      expect(result.readbackProblem).toBeNull();
    }, 60_000);
  }

  it("takes a second edit after the first gave the file its ids", async () => {
    const first = await runEdit(payload(), cases["replace words"]!);
    const second = await runEdit(new Uint8Array(first.output), cases["insert section"]!);
    expect(second.readbackProblem).toBeNull();
  }, 60_000);

  it("keeps the equations students write", async () => {
    const equations = [
      "\\frac{a}{b} \\quad \\qquad c",
      "\\hat{x} + \\bar{y} = \\vec{F}",
      "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
      "\\displaystyle \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
      "\\mathbf{v} \\cdot \\mathbb{R}^3 \\leq \\infty",
      "\\partial_t u = \\nabla^2 u",
    ];
    const result = await runEdit(payload(), () => [{ op: "insert", position: "end", markdown: equations.map((equation) => `$$${equation}$$`).join("\n\n") }]);
    expect(result.readbackProblem).toBeNull();
  }, 60_000);

  it("reads list text in its own font, not the bullet's", async () => {
    const opened = await docxLens.open(payload(), "strict-native");
    const fonts = opened.projection.blocks.filter((block) => block.type === "list")
      .flatMap((block) => block.inlineContent ?? [])
      .map((item) => (item.kind === "text" ? item.format?.fontFamily : undefined));
    expect(fonts).not.toContain("Symbol");
  }, 60_000);
});
