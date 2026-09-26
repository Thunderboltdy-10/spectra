import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseXml, serializeNode } from "@ariadng/office/xml";
import { PML_NAMESPACE } from "@ariadng/office/pptx";
import { P14_NAMESPACE, readPptxTransition, writePptxTransition } from "../lenses/pptx-transition";
import { pptxLens, pptxProjectionSemanticDigest } from "../lenses/pptx-lens";
import { pptxArtifactContent, pptxProjectionUpdateFromContent } from "../lenses/office-content";
import { presentationYjsAdapter } from "../work/models/yjs/structured-adapters";

const xml = (body: string) => parseXml(`<p:sld xmlns:p="${PML_NAMESPACE}" xmlns:p14="${P14_NAMESPACE}" xmlns:x="urn:s11:unknown"><p:cSld/>${body}<p:timing><x:timing keep="true"/></p:timing></p:sld>`).root;

describe("native PPTX transitions", () => {
  it("authors and reopens supported effects and exact duration through complete editor content", async () => {
    let opened = await pptxLens.open(await readFile("fixtures/office/pptx/typical-preservation.pptx"));
    for (const kind of ["fade", "push", "dissolve", "none"] as const) {
      const content = pptxArtifactContent(opened.projection);
      const target = content.slides[0]!;
      if (kind === "none") delete target.transition;
      else target.transition = { kind, durationMs: 720 };
      const update = pptxProjectionUpdateFromContent(content, opened.projection, { objectLists: "complete" });
      expect(update.operations).toContainEqual({ kind: "set-transition", slideId: target.id, transition: kind === "none" ? { kind } : { kind, durationMs: 720 } });
      const output = await pptxLens.materialize({ carry: opened.preservedCarry, projection: update.projection });
      const actual = await pptxLens.open(output);
      expect(actual.projection.slides[0]!.transition).toEqual(kind === "none" ? { kind } : { kind, durationMs: 720 });
      expect(actual.projection.slides[0]!.objects).toEqual(opened.projection.slides[0]!.objects);
      expect(await pptxProjectionSemanticDigest(update.projection)).toBe(actual.projection.nativeBinding.semanticDigest);
      expect(actual.projection.nativeBinding.semanticDigest).not.toBe(opened.projection.nativeBinding.semanticDigest);
      opened = actual;
    }
  });

  it("keeps long imported durations through the hydrated collaborative model", async () => {
    const opened = await pptxLens.open(await readFile("fixtures/office/pptx/typical-preservation.pptx"));
    const bytes = await pptxLens.mutate(opened.preservedCarry, { kind: "set-transition", slideId: opened.projection.slides[0]!.id, transition: { kind: "fade", durationMs: 20_000 } });
    const actual = await pptxLens.open(bytes);
    const document = presentationYjsAdapter.createDocument(pptxArtifactContent(actual.projection));
    try {
      const content = presentationYjsAdapter.project(document);
      expect(content.slides[0]!.transition).toEqual({ kind: "fade", durationMs: 20_000 });
      const next = pptxProjectionUpdateFromContent(content, actual.projection, { objectLists: "complete" });
      expect(next.operations.filter((operation) => operation.kind === "set-transition")).toEqual([]);
    } finally { document.destroy(); }
  });

  it("preserves advance, speed, sound, extension, unknown attributes and timing while editing/removing an effect", () => {
    const root = xml('<p:transition spd="slow" advClick="0" advTm="9000" x:keep="native" p14:dur="650"><p:fade/><p:sndAc><x:sound keep="yes"/></p:sndAc><p:extLst><x:extra value="42"/></p:extLst></p:transition>');
    const before = readPptxTransition(root).node!;
    const carried = before.elements().filter((node) => ["sndAc", "extLst"].includes(node.localName)).map(serializeNode);
    const timing = serializeNode(root.find(PML_NAMESPACE, "timing")!);
    writePptxTransition(root, { kind: "push", durationMs: 850 });
    expect(readPptxTransition(root).transition).toEqual({ kind: "push", durationMs: 850 });
    writePptxTransition(root, { kind: "none" });
    const after = readPptxTransition(root).node!;
    expect(readPptxTransition(root).transition).toEqual({ kind: "none" });
    expect(after).toBe(before);
    for (const [key, value] of [["spd", "slow"], ["advClick", "0"], ["advTm", "9000"], ["x:keep", "native"]]) expect(after.getAttribute(key!)).toBe(value);
    expect(after.elements().map(serializeNode)).toEqual(carried);
    expect(serializeNode(root.find(PML_NAMESPACE, "timing")!)).toBe(timing);
  });

  it.each(['<p:wipe dir="l"/>', '<p:push dir="r"/>', '<p:fade thruBlk="1"/>', '<p:fade x:setting="unknown"/>', '<p:dissolve><x:effect/></p:dissolve>'])("refuses unmodeled effect markup without mutating it: %s", (effect) => {
    const root = xml(`<p:transition>${effect}</p:transition>`);
    const before = serializeNode(root);
    expect(readPptxTransition(root).transition).toBeUndefined();
    expect(() => writePptxTransition(root, { kind: "fade", durationMs: 350 })).toThrow(/cannot replace losslessly/);
    expect(serializeNode(root)).toBe(before);
  });

  it("rejects a transition hidden in compatibility markup and keeps omitted duration", () => {
    const root = xml('<x:Alternate><p:transition><p:fade/></p:transition></x:Alternate>');
    expect(() => writePptxTransition(root, { kind: "fade" })).toThrow();
    const direct = xml('<p:transition p14:dur="777"><p:fade/></p:transition>');
    writePptxTransition(direct, { kind: "push" });
    expect(readPptxTransition(direct).transition).toEqual({ kind: "push", durationMs: 777 });
  });

  it.each([
    '<p:transition><p:fade/></p:transition><p:transition><p:push/></p:transition>',
    '<p:transition><p:fade/></p:transition><x:Alternate><p:transition><p:push/></p:transition></x:Alternate>',
  ])("refuses duplicate transitions including mixed direct and compatibility nodes", (body) => {
    const root = xml(body);
    const before = serializeNode(root);
    expect(readPptxTransition(root).transition).toBeUndefined();
    expect(() => writePptxTransition(root, { kind: "none" })).toThrow();
    expect(serializeNode(root)).toBe(before);
  });

  it("validates exact uint32 duration and refuses duration without an effect before mutation", () => {
    const root = xml("");
    writePptxTransition(root, { kind: "fade", durationMs: 4_294_967_295 });
    expect(readPptxTransition(root).transition).toEqual({ kind: "fade", durationMs: 4_294_967_295 });
    const before = serializeNode(root);
    for (const durationMs of [-1, 0.5, 4_294_967_296, Number.NaN])
      expect(() => writePptxTransition(root, { kind: "fade", durationMs })).toThrow();
    expect(() => writePptxTransition(root, { kind: "none", durationMs: 100 })).toThrow();
    expect(serializeNode(root)).toBe(before);
  });

  it("keeps sparse omission and treats complete omission as explicit removal", async () => {
    const initial = await pptxLens.open(await readFile("fixtures/office/pptx/typical-preservation.pptx"));
    const opened = await pptxLens.open(await pptxLens.mutate(initial.preservedCarry, { kind: "set-transition", slideId: initial.projection.slides[0]!.id, transition: { kind: "fade", durationMs: 350 } }));
    const content = pptxArtifactContent(opened.projection);
    delete content.slides[0]!.transition;
    expect(pptxProjectionUpdateFromContent(content, opened.projection).operations.filter((operation) => operation.kind === "set-transition")).toEqual([]);
    expect(pptxProjectionUpdateFromContent(content, opened.projection, { objectLists: "complete" }).operations).toContainEqual({ kind: "set-transition", slideId: content.slides[0]!.id, transition: { kind: "none" } });
  });
});
