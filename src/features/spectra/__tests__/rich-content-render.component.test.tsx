// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpectraRichContent, SpectraStoredText } from "../components/spectra-rich-content";
import { richContentFromHtml, richContentFromSlideParagraphs } from "../rich-content";

vi.mock("../components/artifact-embed-host", () => ({
  ArtifactEmbedById: ({ embedId }: { embedId: string }) => <div data-testid="embed">{embedId}</div>,
}));

describe("the shared rich-content renderer", () => {
  let container: HTMLDivElement;
  let root: Root;
  const env = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    env.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (content: string) => act(() => root.render(<SpectraRichContent content={content} />));
  const prose = () => container.querySelector(".spectra-prose")!;

  it("writes the same DOM the editors write, so one stylesheet draws both", () => {
    render([
      "## Heading",
      "",
      "Some **bold**, *italic*, <u>underlined</u> and ~~struck~~ text with `code`.",
      "",
      "- [ ] open",
      "- [x] done",
      "",
      "> [!WARNING]",
      "> Careful",
      "",
      "$$",
      "x^2",
      "$$",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n"));
    expect(prose().querySelector("h2")?.textContent).toBe("Heading");
    expect(prose().querySelector("p strong")?.textContent).toBe("bold");
    expect(prose().querySelector("p em")?.textContent).toBe("italic");
    expect(prose().querySelector("p u")?.textContent).toBe("underlined");
    expect(prose().querySelector("p s")?.textContent).toBe("struck");
    expect(prose().querySelector("p code")?.textContent).toBe("code");
    const items = prose().querySelectorAll('ul[data-type="taskList"] > li[data-type="taskItem"]');
    expect([...items].map((item) => item.getAttribute("data-checked"))).toEqual(["false", "true"]);
    expect(items[1]!.querySelector<HTMLInputElement>(":scope > label > input[type=checkbox]")!.checked).toBe(true);
    expect(items[1]!.querySelector(":scope > div > p")?.textContent).toBe("done");
    const callout = prose().querySelector("aside[data-spectra-callout]");
    expect(callout?.getAttribute("data-callout-type")).toBe("warning");
    expect(callout?.className).toBe("callout callout-warning");
    expect(prose().querySelector("div[data-equation].spectra-equation")).not.toBeNull();
    expect(prose().querySelector(".tableWrapper table thead th")?.textContent).toBe("A");
  });

  it("gives no primitive a style of its own", () => {
    render("# Title\n\nText with [a link](https://example.org).\n\n- one\n\n> quote\n\n```ts\nconst a = 1;\n```");
    const styled = [...prose().querySelectorAll("h1, p, ul, li, blockquote, pre, a, strong")].filter((element) => element.getAttribute("class"));
    expect(styled).toEqual([]);
  });

  it("opens web links in a new tab and drops unsafe ones", () => {
    render("[web](https://example.org) [here](/library) [bad](javascript:alert(1))");
    const links = [...prose().querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://example.org/", "/library"]);
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[1]!.hasAttribute("target")).toBe(false);
    expect(prose().textContent).toContain("bad");
  });

  it("draws a model an adapter read from editor HTML", () => {
    const ast = richContentFromHtml('<p>Q: <strong>why</strong> <span data-inline-equation="" latex="x"></span>?</p><ol><li><p>a</p></li></ol>');
    act(() => root.render(<SpectraRichContent ast={ast} />));
    expect(prose().querySelector("p strong")?.textContent).toBe("why");
    expect(prose().querySelector("span[data-inline-equation].spectra-equation-inline")).not.toBeNull();
    expect(prose().querySelector("ol > li > p")?.textContent).toBe("a");
  });

  it("keeps a run's own typeface, size and colour", () => {
    const ast = richContentFromHtml("<p>x</p>");
    ast.blocks[0] = { ...ast.blocks[0]!, type: "paragraph", content: [{ type: "text", text: "Styled", marks: ["bold"], style: { fontFamily: "Georgia", fontSizePt: 20, color: ["#", "123456"].join("") } }] } as never;
    act(() => root.render(<SpectraRichContent ast={ast} />));
    const span = prose().querySelector<HTMLElement>("p strong > span")!;
    expect(span.style.fontFamily).toBe("Georgia");
    expect(span.style.fontSize).toBe("20pt");
  });

  it("draws a stored quiz or card field as written, not as raw tags", () => {
    act(() => root.render(<SpectraStoredText value={'<p>Solve <strong>for</strong> <span data-inline-equation latex="x"></span></p><ul><li><p>step</p></li></ul>'} />));
    expect(container.textContent).not.toContain("<strong>");
    expect(prose().querySelector("p strong")?.textContent).toBe("for");
    expect(prose().querySelector("[data-inline-equation]")).not.toBeNull();
    expect(prose().querySelector("ul > li")?.textContent).toBe("step");
  });

  it("keeps a one-paragraph option inside its line, and an empty field reads as its fallback", () => {
    act(() => root.render(<button type="button"><SpectraStoredText inline value="<p><em>Paris</em></p>" /></button>));
    const inline = container.querySelector("button > span.spectra-prose.spectra-prose-inline")!;
    expect(inline.querySelector("em")?.textContent).toBe("Paris");
    expect(container.querySelector("button div")).toBeNull();
    act(() => root.render(<SpectraStoredText value="<p></p>" fallback="Empty card" />));
    expect(prose().textContent).toBe("Empty card");
  });

  it("shows a slide's runs and bullets as the deck wrote them", () => {
    const ast = richContentFromSlideParagraphs([
      { runs: [{ text: "Key ", bold: true }, { text: "idea" }], alignment: "center" },
      { runs: [{ text: "First" }], bullet: "bullet" },
      { runs: [{ text: "Second" }], bullet: "bullet" },
    ]);
    act(() => root.render(<SpectraRichContent ast={ast} className="spectra-prose-inherit" />));
    expect(prose().querySelector("p strong")?.textContent).toBe("Key ");
    expect([...prose().querySelectorAll("ul > li")].map((item) => item.textContent)).toEqual(["First", "Second"]);
  });

  it("is styled by one stylesheet scope that the document and every field share", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/spectra-prose.css"), "utf8");
    const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(globals).toContain('@import "../styles/spectra-prose.css";');
    for (const selector of ['ul[data-type="taskList"]', "aside[data-spectra-callout]", "[data-spectra-citation]", "[data-equation]", "blockquote", "pre"]) {
      expect(css).toContain(selector);
    }
    const app = readFileSync(join(process.cwd(), "src/styles/spectra-app.css"), "utf8");
    // No editor restyles a primitive locally any more.
    expect(app).not.toMatch(/\.ProseMirror\s+(?:h[1-6]|p|blockquote|ul|ol|li|code|pre|a)\s*[,{]/);
    expect(app).not.toContain(".chat-rich");
    const document = readFileSync(join(process.cwd(), "src/features/spectra/components/document-studio.tsx"), "utf8");
    expect(document).toContain('"spectra-prose spectra-composer-clearance');
    expect(document).not.toMatch(/\[&_\.ProseMirror_(?:h1|h2|p|li|blockquote)\]/);
    const field = readFileSync(join(process.cwd(), "src/features/spectra/components/artifact-rich-text-editor.tsx"), "utf8");
    expect(field.match(/"spectra-prose /g)?.length).toBe(4);
    // Board text and slide text are drawn by the shared renderer, not a textarea look.
    expect(app).not.toContain(".whiteboard-node textarea");
    expect(app).not.toMatch(/\.spectra-task-notes \{[^}]*font-size/);
    // Every field's bar carries the same commands, checklist included.
    const studio = readFileSync(join(process.cwd(), "src/features/spectra/components/artifact-studio.tsx"), "utf8");
    for (const command of ["toggleBold", "toggleItalic", "toggleUnderline", "toggleStrike", "toggleBulletList", "toggleOrderedList", "toggleTaskList", "toggleBlockquote", "toggleCode", "setLink", "inlineEquation"]) {
      expect(studio).toContain(command);
    }
  });
});
