import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { EditorState } from "@tiptap/pm/state";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest, docxReadbackDifference } from "../lenses/docx-lens";
import { docxProjectionFromContent, documentBlocksFromJson, documentContentToProseMirrorJson } from "../lenses/document-projection";
import { formatChartNumber, parseWordChart, renderWordChartSvg } from "../lenses/docx-chart-svg";
import { documentSchema } from "../editor/document-extensions";
import { keepsWordCharts } from "../editor/word-chart";

const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

const cache = (values: Array<number | string>, kind = "numCache") =>
  `<c:${kind}><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join("")}</c:${kind}>`;

const scatterXml = `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:scatterChart><c:scatterStyle val="lineMarker"/>
<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>D!$B$1</c:f>${cache(["Measured &amp; fitted"], "strCache")}</c:strRef></c:tx>
<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="square"/><c:size val="5"/></c:marker>
<c:trendline><c:trendlineType val="linear"/></c:trendline>
<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="cust"/><c:plus><c:numRef><c:f>x</c:f>${cache([0.1, 0.1, 0.2])}</c:numRef></c:plus><c:minus><c:numRef><c:f>x</c:f>${cache([0.1, 0.1, 0.2])}</c:numRef></c:minus></c:errBars>
<c:xVal><c:numRef><c:f>x</c:f>${cache([1, 2, 3])}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>y</c:f>${cache([2, 4.1, 5.9])}</c:numRef></c:yVal></c:ser>
<c:axId val="1"/><c:axId val="2"/></c:scatterChart>
<c:valAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Time / s</a:t></a:r></a:p></c:rich></c:tx></c:title><c:numFmt formatCode="0.0"/></c:valAx>
<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:title><c:tx><c:rich><a:p><a:r><a:t>Distance &lt;m&gt;</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>
</c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>`;

describe("a Word chart, drawn from its cached values", () => {
  it("reads series, markers, error bars, trendline and axis titles", () => {
    const chart = parseWordChart(scatterXml)!;
    expect(chart.kind).toBe("scatter");
    expect(chart.series[0]).toMatchObject({ name: "Measured & fitted", line: false, marker: "square", x: [1, 2, 3], y: [2, 4.1, 5.9] });
    expect(chart.series[0]!.errorBars[0]!.plus(2, 5.9)).toBe(0.2);
    expect(chart.series[0]!.trendlines[0]!.kind).toBe("linear");
    expect(chart.x.title).toBe("Time / s");
    expect(chart.y.title).toBe("Distance <m>");
    expect(chart.legend).toBe("b");
  });

  it("draws an SVG with its words escaped, and a frame for a kind it does not draw", () => {
    const svg = renderWordChartSvg(scatterXml, 600, 340);
    expect(svg).toMatch(/^<svg [^>]*width="600" height="340"/u);
    expect(svg).toContain("Distance &lt;m&gt;");
    expect(svg).toContain("Measured &amp; fitted");
    expect(svg).toContain('stroke-dasharray="4 3"');
    expect(svg).not.toMatch(/<script|on\w+=/iu);
    const pie = `<c:chartSpace xmlns:c="${C}"><c:chart><c:plotArea><c:pieChart><c:ser><c:idx val="0"/></c:ser></c:pieChart></c:plotArea></c:chart></c:chartSpace>`;
    expect(parseWordChart(pie)).toBeNull();
    expect(renderWordChartSvg(pie, 400, 200)).toContain("Edit it in Word");
    expect(renderWordChartSvg("<not xml", 400, 200)).toContain("Edit it in Word");
  });

  it("formats numbers as the axis asks", () => {
    expect(formatChartNumber(0.5236, "0.00")).toBe("0.52");
    expect(formatChartNumber(0.25, "0%")).toBe("25%");
    expect(formatChartNumber(1234567, "#,##0")).toBe("1,234,567");
    expect(formatChartNumber(0.1 + 0.2)).toBe("0.3");
  });

  it("shows in the paragraph that holds it, and a save leaves Word's chart and readback alone", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Results." }] }, { type: "paragraph" }] });
    const zip = await JSZip.loadAsync(bytes);
    zip.file("word/charts/chart1.xml", scatterXml);
    const types = await zip.file("[Content_Types].xml")!.async("string");
    zip.file("[Content_Types].xml", types.replace("</Types>", `<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`));
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    zip.file("word/_rels/document.xml.rels", rels.replace("</Relationships>", `<Relationship Id="rIdChart1" Type="${R}/chart" Target="charts/chart1.xml"/></Relationships>`));
    const main = await zip.file("word/document.xml")!.async("string");
    const drawing = `<w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:extent cx="5486400" cy="3200400"/><wp:docPr id="7" name="Chart 1"/><a:graphic xmlns:a="${A}"><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" xmlns:r="${R}" r:id="rIdChart1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    let index = 0;
    zip.file("word/document.xml", main.replace(/<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/gu, (paragraph) => (index++ === 1 ? `<w:p xmlns:w="${W}">${drawing}</w:p>` : paragraph)));
    const withChart = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));

    const opened = await docxLens.open(withChart, "strict-native");
    const chartBlock = opened.projection.blocks.find((block) => Array.isArray(block.attrs?.wordCharts));
    expect(chartBlock?.attrs?.wordCharts).toEqual([{ partName: "/word/charts/chart1.xml", widthEmu: 5486400, heightEmu: 3200400 }]);

    const binding = { sourceArtifactId: "artifact-1", sourcePayloadHash: "a".repeat(64) };
    const json = documentContentToProseMirrorJson({ ...opened.projection, nativeBinding: binding } as never) as { type: string; content: Array<{ type: string; content?: Array<{ type: string; attrs?: Record<string, unknown> }> }> };
    const node = json.content.flatMap((block) => block.content ?? []).find((child) => child.type === "wordChart");
    expect(node?.attrs).toMatchObject({ partName: "/word/charts/chart1.xml", widthEmu: 5486400 });
    expect(String(node?.attrs?.src)).toMatch(/^\/api\/spectra\/lenses\/docx\/chart\?.*width=576&height=336/u);
    expect(() => documentSchema().nodeFromJSON(json)).not.toThrow();

    // Type beside the chart, then save.
    const chartParagraph = json.content.find((block) => block.content?.some((child) => child.type === "wordChart"))!;
    chartParagraph.content!.push({ type: "text", text: " Figure above." } as never);
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json as never) }, opened.projection);
    const output = new Uint8Array(await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations }));
    const savedMain = await (await JSZip.loadAsync(output)).file("word/document.xml")!.async("string");
    expect(savedMain).toContain('r:id="rIdChart1"');
    expect(savedMain).toContain("Figure above.");
    const reopened = await docxLens.open(output, "strict-native");
    const requested = await docxProjectionSemanticDigest(update.projection);
    const readback = await docxProjectionReadbackDigest(reopened.projection, update.projection);
    expect(requested === readback ? null : await docxReadbackDifference(reopened.projection, update.projection)).toBeNull();
  });

  it("can't be cut out of its paragraph, but goes with the paragraph", () => {
    const schema = documentSchema();
    const doc = schema.nodeFromJSON({ type: "doc", content: [
      { type: "paragraph", attrs: { blockId: "a" }, content: [{ type: "text", text: "Before" }] },
      { type: "paragraph", attrs: { blockId: "b" }, content: [{ type: "wordChart", attrs: { partName: "/word/charts/chart1.xml", widthEmu: 9525, heightEmu: 9525, src: "" } }, { type: "text", text: "x" }] },
    ] });
    const state = EditorState.create({ doc });
    const chartStart = doc.child(0).nodeSize + 1;
    const cut = state.tr.delete(chartStart, chartStart + 1);
    const whole = state.tr.delete(doc.child(0).nodeSize, doc.content.size);
    expect(keepsWordCharts(doc, cut.doc)).toBe(false);
    expect(keepsWordCharts(doc, whole.doc)).toBe(true);
    expect(keepsWordCharts(doc, state.tr.insertText("more", 2).doc)).toBe(true);
  });

  it("shows text boxes, SmartArt and embedded objects as frames, counting Word's fallback copy once", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Intro." }] }, { type: "paragraph" }, { type: "paragraph" }, { type: "paragraph" }] });
    const zip = await JSZip.loadAsync(bytes);
    const WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
    const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
    const V = "urn:schemas-microsoft-com:vml";
    const DGM = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
    const box = (text: string) => `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:t>Line two</w:t></w:r></w:p></w:txbxContent>`;
    const textBox = `<w:r><mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="wps"><w:drawing><wp:anchor xmlns:wp="${WP}"><wp:extent cx="1905000" cy="952500"/><wp:docPr id="3" name="Text Box 3"/><a:graphic xmlns:a="${A}"><a:graphicData uri="${WPS}"><wps:wsp xmlns:wps="${WPS}"><wps:txbx>${box("Note &amp; aside")}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape xmlns:v="${V}" style="width:150pt;height:75pt"><v:textbox>${box("Note &amp; aside")}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
    const smartArt = `<w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:extent cx="4572000" cy="2743200"/><wp:docPr id="4" name="Diagram 4"/><a:graphic xmlns:a="${A}"><a:graphicData uri="${DGM}"><dgm:relIds xmlns:dgm="${DGM}" xmlns:r="${R}" r:dm="rId90" r:lo="rId91" r:qs="rId92" r:cs="rId93"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const object = `<w:r><w:object><v:shape xmlns:v="${V}" style="width:1in;height:0.5in"/></w:object></w:r>`;
    const main = await zip.file("word/document.xml")!.async("string");
    const inserts = [textBox, smartArt, object];
    let index = 0;
    zip.file("word/document.xml", main.replace(/<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/gu, (paragraph) => {
      const insert = index > 0 ? inserts[index - 1] : undefined;
      index += 1;
      return insert ? `<w:p xmlns:w="${W}">${insert}</w:p>` : paragraph;
    }));
    const opened = await docxLens.open(new Uint8Array(await zip.generateAsync({ type: "uint8array" })), "strict-native");
    const objects = opened.projection.blocks.flatMap((block) => (block.attrs?.wordCharts as unknown[] | undefined) ?? []);
    expect(objects).toEqual([
      { kind: "textBox", text: "Note & aside\nLine two", widthEmu: 1905000, heightEmu: 952500 },
      { kind: "smartArt", widthEmu: 4572000, heightEmu: 2743200 },
      { kind: "object", widthEmu: 914400, heightEmu: 457200 },
    ]);
    expect(opened.projection.blocks.map((block) => block.text).join("")).not.toContain("Note");

    const json = documentContentToProseMirrorJson(opened.projection) as { content: Array<{ content?: Array<{ type: string; attrs?: Record<string, unknown> }> }> };
    const nodes = json.content.flatMap((block) => block.content ?? []).filter((child) => child.type === "wordChart");
    expect(nodes.map((node) => node.attrs?.kind)).toEqual(["textBox", "smartArt", "object"]);
    const schema = documentSchema();
    const doc = schema.nodeFromJSON(json);
    const rendered: string[] = [];
    doc.descendants((node) => {
      if (node.type.name !== "wordChart") return true;
      const spec = node.type.spec.toDOM!(node) as unknown as [string, Record<string, string>, string];
      rendered.push(`${spec[1]["data-word-object"]}:${spec[2]}`);
      return false;
    });
    expect(rendered).toEqual(["textBox:Note & aside\nLine two", "smartArt:SmartArt from Word", "object:Object from Word"]);
  });
});
