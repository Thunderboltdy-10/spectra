// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  buildPresentationPptx,
  importPresentationFile,
} from "../presentation/io";

describe("PowerPoint import ordering", () => {
  it("follows presentation.xml slide order when slide parts were reordered", async () => {
    const source = readFileSync("fixtures/office/pptx/typical-preservation.pptx");
    const files = unzipSync(source);
    const presentationXml = strFromU8(files["ppt/presentation.xml"]!);
    const slideIds = presentationXml.match(/<p:sldId\b[^>]*\/>/g) ?? [];
    expect(slideIds.length).toBeGreaterThanOrEqual(2);
    const reorderedXml = presentationXml.replace(
      /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
      `<p:sldIdLst>${slideIds[1]}${slideIds[0]}${slideIds
        .slice(2)
        .join("")}</p:sldIdLst>`,
    );
    const reordered = zipSync({
      ...files,
      "ppt/presentation.xml": strToU8(reorderedXml),
    });

    const imported = await importPresentationFile(
      new File([reordered], "reordered.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    );

    expect(imported.content.slides.slice(0, 2).map((slide) => slide.title)).toEqual([
      "Text Only Slide",
      "Typical Presentation",
    ]);
  });

  it("resolves Spectra color tokens before writing a PowerPoint package", async () => {
    const imported = await buildPresentationPptx(
      {
        theme: {
          id: "token-test",
          tokens: {
            background: "var(--bg-primary)",
            body: "var(--text-primary)",
          },
        },
        slides: [
          {
            id: "slide-1",
            title: "Token test",
            objects: [
              {
                id: "text-1",
                type: "text",
                x: 100,
                y: 100,
                width: 800,
                height: 100,
                rotation: 0,
                content: { text: "Readable" },
                style: { color: "var(--text-primary)" },
              },
            ],
          },
        ],
      },
      [],
    );
    const files = unzipSync(new Uint8Array(await imported.arrayBuffer()));
    const slideXml = strFromU8(files["ppt/slides/slide1.xml"]!);

    expect(slideXml).toContain('val="211F1C"');
    expect(slideXml).not.toContain("var(--");
  });
});
