import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildPresentationPptx } from "../presentation/io";
import { normalizePresentationContent } from "../presentation/model";

describe("presentation citation export", () => {
  it("exports page attribution, preserves notes and content order, and excludes unsafe links", async () => {
    const object = (id: string, text: string, y: number) => ({ id, type: "text", x: 50, y, width: 800, height: 80, rotation: 0, content: { text }, readingOrder: y });
    const deck = normalizePresentationContent({ theme: { id: "plain" }, slides: [
      { id: "s1", title: "First", speakerNotes: "Explain the original experimental limitation.", objects: [object("a", "First editable claim", 40), object("b", "Second editable claim", 140)], citations: [{ id: "c1", label: "Cooling study.pdf, p. 3", sourceRefs: ["evidence:fixture"] }] },
      { id: "s2", title: "Safe source", objects: [], citations: [{ id: "c2", label: "Open source, p. 2", url: "https://example.com/study" }] },
      { id: "s3", title: "Unsafe source", objects: [], citations: [{ id: "c3", label: "Uploaded source", url: "javascript:alert(1)" }] },
      { id: "s4", title: "Uncited", speakerNotes: "Keep these notes exactly.", objects: [object("d", "Uncited editable content", 40)] },
    ] });
    const blob = await buildPresentationPptx(deck, []);
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const xml = (path: string) => strFromU8(zip[path]!);
    const first = xml("ppt/slides/slide1.xml");
    expect(first).toContain("Cooling study.pdf, p. 3");
    expect(first.indexOf("First editable claim")).toBeLessThan(first.indexOf("Second editable claim"));
    const notes = xml("ppt/notesSlides/notesSlide1.xml");
    expect(notes).toContain("Explain the original experimental limitation.");
    expect(notes).toContain("Cooling study.pdf, p. 3");
    expect(xml("ppt/slides/_rels/slide2.xml.rels")).toContain('Target="https://example.com/study"');
    expect(Object.entries(zip).filter(([path]) => path.endsWith(".rels")).some(([, bytes]) => strFromU8(bytes).includes("javascript:"))).toBe(false);
    expect(xml("ppt/slides/slide4.xml")).not.toContain("Sources:");
    expect(xml("ppt/notesSlides/notesSlide4.xml")).toContain("Keep these notes exactly.");
    expect(xml("ppt/notesSlides/notesSlide4.xml")).not.toContain("Sources:");
  });
});
