/* eslint-disable spectra/no-raw-hex-in-styles -- Native deck colours read from the fixture, not UI styles. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseXml } from "@ariadng/office/xml";
import { pptxLens } from "../lenses/pptx-lens";
import { drawingColor, drawingFill, drawingPalette } from "../lenses/drawingml-colors";
import { parseOfficePreview } from "../files/office-preview";
import type { PresentationObject } from "../presentation/model";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const typical = () => readFile("fixtures/office/pptx/typical-preservation.pptx").then((buffer) => new Uint8Array(buffer));
const slideOf = (projection: { slides: Array<{ id: string; objects: PresentationObject[] }> }, number: number) =>
  projection.slides.find((slide) => slide.id.endsWith(`/slide${number}.xml`))!;
const objectOf = (slide: { objects: PresentationObject[] }, shapeId: string) => slide.objects.find((object) => object.id.endsWith(`:shape:${shapeId}`))!;
const content = (object: PresentationObject) => object.content as Record<string, unknown>;
const inside = (inner: PresentationObject, outer: PresentationObject) =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

describe("DrawingML colours", () => {
  const palette = drawingPalette(undefined, undefined);
  const color = (xml: string) => drawingColor(parseXml(`<a:x xmlns:a="${A}">${xml}</a:x>`).root.elements()[0], palette);

  it("resolves scheme names through the colour map and applies modifiers", () => {
    expect(color(`<a:schemeClr val="tx1"/>`)).toBe("#000000");
    expect(color(`<a:schemeClr val="accent1"/>`)).toBe("#4472C4");
    expect(color(`<a:srgbClr val="FF0000"><a:shade val="50000"/></a:srgbClr>`)).toBe("#800000");
    expect(color(`<a:srgbClr val="000000"><a:tint val="50000"/></a:srgbClr>`)).toBe("#808080");
    expect(color(`<a:srgbClr val="808080"><a:lumMod val="50000"/></a:srgbClr>`)).toBe("#404040");
    expect(color(`<a:srgbClr val="336699"><a:alpha val="40000"/></a:srgbClr>`)).toBe("color-mix(in srgb, #336699 40%, transparent)");
    expect(color(`<a:prstClr val="white"/>`)).toBe("#FFFFFF");
  });

  it("reads a fill, a gradient's first stop, and no fill", () => {
    const fill = (xml: string) => drawingFill(parseXml(`<a:spPr xmlns:a="${A}">${xml}</a:spPr>`).root, palette);
    expect(fill(`<a:noFill/>`)).toBe("none");
    expect(fill(`<a:solidFill><a:schemeClr val="accent2"/></a:solidFill>`)).toBe("#ED7D31");
    expect(fill(`<a:gradFill><a:gsLst><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst></a:gradFill>`)).toBe("#FFFFFF");
    expect(fill(`<a:blipFill/>`)).toBeUndefined();
  });
});

describe("PowerPoint depth in the lens", () => {
  it("places inherited placeholders where the layout and master put them", async () => {
    const { projection } = await pptxLens.open(await typical());
    // Slide 2's title and body carry no transform of their own.
    const title = objectOf(slideOf(projection, 2), "110594");
    const body = objectOf(slideOf(projection, 2), "110595");
    expect(title.x).toBeGreaterThan(100);
    expect(title.width).toBeGreaterThan(800);
    expect(body.y).toBeGreaterThan(title.y + title.height - 1);
    expect(body.height).toBeGreaterThan(400);
  });

  it("maps grouped shapes out of their group's own coordinate space", async () => {
    const { projection } = await pptxLens.open(await typical());
    const slide = slideOf(projection, 10);
    const groups = slide.objects.filter((object) => object.type === "group");
    expect(groups.length).toBeGreaterThan(2);
    for (const group of groups) {
      const members = slide.objects.filter((object) => object.parentId === group.id);
      expect(members.length).toBeGreaterThan(1);
      for (const member of members) expect(inside(member, group)).toBe(true);
    }
  });

  it("reads shape fills, outlines, presets, connectors and arrowheads", async () => {
    const { projection } = await pptxLens.open(await typical());
    expect(content(objectOf(slideOf(projection, 8), "104539")).nativeAppearance).toMatchObject({ fill: "#3333CC", line: "#000000", anchor: "middle" });
    expect(content(objectOf(slideOf(projection, 10), "120836")).nativeAppearance).toMatchObject({ geometry: "ellipse", fill: "#18185E" });
    const connector = objectOf(slideOf(projection, 10), "120880");
    expect(connector.type).toBe("shape");
    expect(content(connector).nativeAppearance).toMatchObject({ geometry: "straightConnector1", arrowEnd: true, flipH: true, flipV: true });
    expect(content(objectOf(slideOf(projection, 11), "132104")).nativeAppearance).toMatchObject({ geometry: "line", straight: "horizontal" });
  });

  it("names OLE objects instead of drawing them as empty tables", async () => {
    const { projection } = await pptxLens.open(await typical());
    const chart = objectOf(slideOf(projection, 6), "111623");
    expect(chart.type).toBe("embed");
    expect(content(chart).nativeObject).toEqual({ kind: "ole", label: "chart", name: "Chart" });
  });

  it("keeps a grouped shape where it was asked to go, and where it was when ungrouped", async () => {
    const opened = await pptxLens.open(await typical());
    const slide = slideOf(opened.projection, 10);
    const member = objectOf(slide, "120859");
    const moved = await pptxLens.mutate(opened.preservedCarry, {
      kind: "set-geometry",
      slideId: slide.id,
      shapeId: "120859",
      x: member.x + 20,
      y: member.y + 10,
      width: member.width,
      height: member.height,
      rotation: 0,
    });
    // A group's child space can be coarser than an EMU, so its members land to the nearest unit there.
    const after = objectOf(slideOf((await pptxLens.open(moved)).projection, 10), "120859");
    expect(after.x).toBeCloseTo(member.x + 20, 0);
    expect(after.y).toBeCloseTo(member.y + 10, 0);
    expect(after.width).toBeCloseTo(member.width, 1);
    const ungrouped = await pptxLens.mutate(opened.preservedCarry, { kind: "remove-object", slideId: slide.id, shapeId: "120858" });
    const loose = objectOf(slideOf((await pptxLens.open(ungrouped)).projection, 10), "120859");
    expect(loose.parentId).toBeUndefined();
    expect(loose.x).toBeCloseTo(member.x, 1);
    expect(loose.y).toBeCloseTo(member.y, 1);
    expect(loose.width).toBeCloseTo(member.width, 1);
  });

  it("groups loose shapes without moving them", async () => {
    const opened = await pptxLens.open(await typical());
    const slide = slideOf(opened.projection, 11);
    const [first, second] = [objectOf(slide, "132100"), objectOf(slide, "132101")];
    const grouped = await pptxLens.mutate(opened.preservedCarry, {
      kind: "group-objects",
      slideId: slide.id,
      groupId: `${slide.id}:group:test`,
      childShapeIds: ["132100", "132101"],
      x: first.x,
      y: first.y,
      width: second.x + second.width - first.x,
      height: Math.max(first.height, second.height),
      rotation: 0,
    });
    const reopened = slideOf((await pptxLens.open(grouped)).projection, 11);
    const group = reopened.objects.find((object) => object.type === "group")!;
    expect(group.x).toBeCloseTo(first.x, 1);
    expect(group.width).toBeCloseTo(second.x + second.width - first.x, 1);
    for (const original of [first, second]) {
      const after = objectOf(reopened, original.id.split(":shape:")[1]!);
      expect(after.parentId).toBe(group.id);
      expect(after.x).toBeCloseTo(original.x, 1);
      expect(after.y).toBeCloseTo(original.y, 1);
    }
  });
});

describe("PowerPoint depth in the viewer", () => {
  it("hands the slides their shapes and their embedded objects", async () => {
    const preview = await parseOfficePreview("slides", await typical());
    if (preview.kind !== "slides") throw new Error("expected slides");
    const objects = preview.deck.slides.flatMap((slide) => slide.objects);
    expect(objects.filter((object) => object.type === "embed").map((object) => content(object).nativeObject)).toHaveLength(2);
    expect(objects.some((object) => object.type === "shape")).toBe(true);
    expect(structuredClone(preview)).toEqual(preview);
  });
});
