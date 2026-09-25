import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildAttachmentEvidence } from "../ai/attachment-evidence";
import { prepareContentEvidence } from "../ai/source-evidence-content";
import { enforceAiPresentationContentPolicy } from "../presentation/ai-content-policy";
import { buildPresentationPptx } from "../presentation/io";
import { normalizePresentationContent, type PresentationContent } from "../presentation/model";
import { pptxLens } from "../lenses/pptx-lens";
import { workYjsAdapter } from "../work/models/yjs/registry";

const excerpt = "In this synthetic trial, sheltered trays lost 18 mL of water and exposed trays lost 31 mL over two hours. One tray was measured per condition; the trial does not establish causation.";
const evidence = buildAttachmentEvidence([{
  id: "tray-trial", name: "Tray trial.txt", mimeType: "text/plain", size: excerpt.length,
  handling: "text", extractedText: excerpt,
  sourceMap: [{ kind: "page", label: "Page 2", startOffset: 0, endOffset: excerpt.length }],
}])!;

function trialDeck(sourceRef = evidence.evidence[0]!.id) {
  const text = (id: string, value: string, y: number, fontSize = 32) => ({
    id, type: "text", x: 70, y, width: 840, height: 90, rotation: 0,
    content: { text: value }, style: { fontSize },
  });
  return {
    theme: { id: "trial", tokens: { background: "var(--bg-primary)", heading: "var(--text-primary)", body: "var(--text-primary)" } },
    settings: { aspectRatio: "16:9" },
    slides: [
      { id: "finding", title: "Less water lost under shelter", sourceRefs: [sourceRef],
        speakerNotes: "These observations come from a synthetic trial, not a general causal result.",
        objects: [text("finding-title", "Less water lost under shelter", 50, 40), text("finding-body", "A small trial suggests a useful next experiment.", 170)] },
      { id: "measurement", title: "Compare the measured loss", sourceRefs: [sourceRef],
        speakerNotes: "Water loss was measured after two hours. Each condition had one tray.",
        objects: [text("measurement-title", "Compare the measured loss", 35, 40), {
          id: "water-loss", type: "chart", x: 80, y: 150, width: 820, height: 300, rotation: 0,
          style: { fontSize: 24 }, altText: "Sheltered tray: 18 mL. Exposed tray: 31 mL.",
          content: { chartType: "column", categories: ["Sheltered", "Exposed"], valueAxisTitle: "Water loss (mL)",
            series: [{ name: "Water loss (mL)", categories: ["Sheltered", "Exposed"], values: [18, 31] }] },
        }] },
      { id: "next", title: "Repeat before generalizing", objects: [
        text("next-title", "Repeat before generalizing", 50, 40),
        text("next-body", "Use more trays per condition and hold exposure time constant.", 170),
      ], speakerNotes: "This is a proposed next step, not a reported finding." },
    ],
  };
}

describe("citation policy through saved editable output", () => {
  it("rejects invented evidence, then saves the repaired three-slide deck without adding references", async () => {
    expect(() => prepareContentEvidence("presentation", trialDeck("evidence:invented"), evidence))
      .toThrow("RESEARCH_EVIDENCE_REF_NOT_ISSUED");

    const content = normalizePresentationContent(prepareContentEvidence("presentation", trialDeck(), evidence));
    const prepared = enforceAiPresentationContentPolicy(content, "Make a three-slide explanation of the tray trial.");
    const adapter = workYjsAdapter<PresentationContent>("presentation");
    const written = adapter.createDocument(prepared);
    const reopened = new Y.Doc();
    let snapshot = Y.encodeStateAsUpdate(written);
    const captureDir = process.env.SPECTRA_CRAFT_CAPTURE === "1"
      ? path.resolve(".spectra-local/launch-s11/craft/citation-policy") : undefined;
    try {
      if (captureDir) {
        mkdirSync(captureDir, { recursive: true });
        writeFileSync(path.join(captureDir, "saved.yjs"), snapshot);
        snapshot = readFileSync(path.join(captureDir, "saved.yjs"));
      }
      Y.applyUpdate(reopened, snapshot);
      let saved = adapter.project(reopened);
      expect(saved.slides.map((slide) => slide.id)).toEqual(["finding", "measurement", "next"]);
      expect(saved.slides[0]!.citations).toEqual(prepared.slides[0]!.citations);
      expect(saved.slides[1]!.citations?.[0]).toMatchObject({
        label: "Tray trial.txt, p. 2", sourceRefs: [evidence.evidence[0]!.id],
      });
      expect(saved.slides[2]!.citations ?? []).toEqual([]);

      // A subsequent unrelated write must preserve the chosen sequence and evidence.
      saved.slides[2]!.speakerNotes = "Invite the audience to propose one control variable.";
      enforceAiPresentationContentPolicy(saved, "Revise the final delivery cue.");
      adapter.applyProjection(reopened, saved, adapter.origins({ clientId: "craft-test", kind: "ai" }).ai);
      // Export the committed projection, not the mutable proposal used above.
      saved = adapter.project(reopened);
      expect(saved.slides.map((slide) => slide.id)).toEqual(["finding", "measurement", "next"]);
      const bytes = new Uint8Array(await (await buildPresentationPptx(saved, [])).arrayBuffer());
      const zip = unzipSync(bytes);
      const slideParts = Object.keys(zip).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
      expect(slideParts).toHaveLength(3);
      expect(strFromU8(zip["ppt/notesSlides/notesSlide1.xml"]!)).toContain("Tray trial.txt, p. 2");
      expect(strFromU8(zip["ppt/notesSlides/notesSlide3.xml"]!)).toContain("Invite the audience");
      const chart = Object.entries(zip).find(([name]) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
      expect(chart).toBeDefined();
      const chartXml = strFromU8(chart![1]);
      expect(chartXml).toContain("Water loss (mL)");
      expect(chartXml).toContain("<c:v>18</c:v>");
      expect(chartXml).toContain("<c:v>31</c:v>");
      expect(Object.keys(zip).some((name) => /^ppt\/embeddings\/.*\.xlsx$/.test(name))).toBe(true);
      const native = await pptxLens.open(bytes);
      expect(native.projection.slides).toHaveLength(3);

      if (captureDir) {
        writeFileSync(path.join(captureDir, "saved.yjs"), Y.encodeStateAsUpdate(reopened));
        writeFileSync(path.join(captureDir, "saved.json"), JSON.stringify(saved, null, 2));
        writeFileSync(path.join(captureDir, "saved.pptx"), bytes);
        writeFileSync(path.join(captureDir, "native-readback.json"), JSON.stringify(native.projection, null, 2));
      }
    } finally {
      written.destroy();
      reopened.destroy();
    }
  });
});
