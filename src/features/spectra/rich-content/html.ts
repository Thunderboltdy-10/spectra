import {
  richContentAst,
  type RichAlign,
  type RichBlock,
  type RichBlockDraft,
  type RichCalloutTone,
  type RichInline,
  type RichMark,
  type SpectraRichContentAst,
} from "./ast";

/*
 * Editor HTML into the shared model.
 *
 * Quiz questions and answers and flashcard faces are stored as the HTML their
 * TipTap field writes. This reads that HTML (and anything a sanitiser lets
 * through) into the model, so the face a learner studies is drawn by the same
 * renderer as the field that wrote it. Nothing is ever injected as HTML.
 */

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE", "PRE", "HR", "TABLE",
  "ASIDE", "FIGURE", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN",
]);
const MARK_TAGS: Record<string, RichMark> = {
  STRONG: "bold", B: "bold", EM: "italic", I: "italic", U: "underline", S: "strike", DEL: "strike", STRIKE: "strike",
};
const CALLOUT_TONES = new Set<RichCalloutTone>(["info", "tip", "warning"]);

function alignOf(element: Element): RichAlign | undefined {
  const value = (element as HTMLElement).style?.textAlign || element.getAttribute("align") || "";
  return value === "left" || value === "center" || value === "right" || value === "justify" ? value : undefined;
}

function isBlockElement(node: Node) {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  if (element.hasAttribute("data-equation") && element.getAttribute("display") !== "inline") return true;
  if (element.tagName === "IMG") return false;
  return BLOCK_TAGS.has(element.tagName) || element.hasAttribute("data-spectra-reference");
}

function inlinesOf(nodes: Iterable<Node>, marks: readonly RichMark[] = []): RichInline[] {
  const output: RichInline[] = [];
  const text = (value: string) => {
    if (!value) return;
    const last = output[output.length - 1];
    if (last?.type === "text" && (last.marks ?? []).join() === marks.join()) last.text += value;
    else output.push(marks.length ? { type: "text", text: value, marks: [...marks] } : { type: "text", text: value });
  };
  for (const node of nodes) {
    if (node.nodeType === 3) { text((node.textContent ?? "").replace(/\s+/g, " ")); continue; }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const tag = element.tagName;
    if (tag === "BR") { output.push({ type: "break" }); continue; }
    if (element.hasAttribute("data-inline-equation") || (element.hasAttribute("data-equation") && element.getAttribute("display") === "inline")) {
      output.push({ type: "inline_math", math: element.getAttribute("latex") ?? element.textContent ?? "", complete: true });
      continue;
    }
    if (element.hasAttribute("data-spectra-citation")) {
      const sourceId = element.getAttribute("sourceid") ?? element.getAttribute("data-source-id") ?? "";
      const evidence = element.getAttribute("evidencespanid") ?? "";
      const label = element.getAttribute("label") ?? element.textContent ?? undefined;
      output.push({ type: "citation", sourceId, evidenceIds: evidence ? [evidence] : [], ...(label ? { label } : {}) });
      continue;
    }
    if (tag === "CODE") { output.push({ type: "inline_code", code: element.textContent ?? "" }); continue; }
    if (tag === "IMG") {
      output.push({ type: "image", url: element.getAttribute("src") ?? "", alt: element.getAttribute("alt") ?? "" });
      continue;
    }
    if (tag === "A" && element.getAttribute("href")) {
      output.push({ type: "link", href: element.getAttribute("href")!, content: inlinesOf(element.childNodes, marks) });
      continue;
    }
    const mark = MARK_TAGS[tag];
    const style = (element as HTMLElement).style;
    let next = marks;
    if (mark && !next.includes(mark)) next = [...next, mark];
    if (style?.fontWeight && (style.fontWeight === "bold" || Number(style.fontWeight) >= 600) && !next.includes("bold")) next = [...next, "bold"];
    if (style?.fontStyle === "italic" && !next.includes("italic")) next = [...next, "italic"];
    for (const inline of inlinesOf(element.childNodes, next)) {
      const last = output[output.length - 1];
      if (inline.type === "text" && last?.type === "text" && (last.marks ?? []).join() === (inline.marks ?? []).join()) last.text += inline.text;
      else output.push(inline);
    }
  }
  return output;
}

/** Trims the whitespace HTML formatting leaves at a block's edges. */
function trimmed(content: RichInline[]) {
  const first = content[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = content[content.length - 1];
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return content.filter((inline) => inline.type !== "text" || inline.text);
}

function blocksOf(nodes: Iterable<Node>): RichBlockDraft[] {
  const blocks: RichBlockDraft[] = [];
  let pending: Node[] = [];
  const flush = () => {
    if (!pending.length) return;
    const content = trimmed(inlinesOf(pending));
    pending = [];
    if (content.length) blocks.push({ type: "paragraph", content });
  };
  for (const node of nodes) {
    if (!isBlockElement(node)) {
      if (node.nodeType === 1 && (node as Element).tagName === "IMG" && !pending.some((item) => (item.textContent ?? "").trim())) {
        flush();
        const image = node as Element;
        blocks.push({ type: "media", url: image.getAttribute("src") ?? "", alt: image.getAttribute("alt") ?? "" });
        continue;
      }
      pending.push(node);
      continue;
    }
    flush();
    const element = node as Element;
    const tag = element.tagName;
    if (element.hasAttribute("data-equation")) {
      blocks.push({ type: "math_block", math: element.getAttribute("latex") ?? element.textContent ?? "" });
    } else if (element.hasAttribute("data-spectra-reference")) {
      const embedId = element.getAttribute("data-reference-id") ?? element.getAttribute("embedid") ?? undefined;
      const workId = element.getAttribute("sourceartifactid") ?? element.getAttribute("workid") ?? undefined;
      blocks.push({ type: "embed", ...(embedId ? { embedId } : {}), ...(workId ? { workId } : {}) });
    } else if (tag === "P") {
      const content = trimmed(inlinesOf(element.childNodes));
      const align = alignOf(element);
      if (content.length) blocks.push({ type: "paragraph", content, ...(align ? { align } : {}) });
    } else if (/^H[1-6]$/.test(tag)) {
      const align = alignOf(element);
      blocks.push({ type: "heading", level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, content: trimmed(inlinesOf(element.childNodes)), ...(align ? { align } : {}) });
    } else if (tag === "UL" || tag === "OL") {
      const task = element.getAttribute("data-type") === "taskList";
      const items = [...element.children].filter((child) => child.tagName === "LI").map((item) => {
        const body = task ? (item.querySelector(":scope > div") ?? item) : item;
        const children = [...body.childNodes].filter((child) => !(child.nodeType === 1 && (child as Element).tagName === "LABEL"));
        return {
          ...(task ? { checked: item.getAttribute("data-checked") === "true" } : {}),
          blocks: blocksOf(children) as RichBlock[],
        };
      });
      const start = Number(element.getAttribute("start"));
      blocks.push({
        type: "list",
        kind: task ? "task" : tag === "OL" ? "ordered" : "bullet",
        ...(tag === "OL" && Number.isInteger(start) && start > 1 ? { start } : {}),
        items,
      });
    } else if (tag === "BLOCKQUOTE") {
      blocks.push({ type: "quote", blocks: blocksOf(element.childNodes) as RichBlock[] });
    } else if (tag === "ASIDE" || element.hasAttribute("data-callout")) {
      const tone = (element.getAttribute("data-callout-type") ?? "info") as RichCalloutTone;
      blocks.push({ type: "callout", tone: CALLOUT_TONES.has(tone) ? tone : "info", blocks: blocksOf(element.childNodes) as RichBlock[] });
    } else if (tag === "PRE") {
      const code = element.querySelector("code");
      const language = code?.className.match(/language-([\w-]+)/)?.[1];
      blocks.push({ type: "code_block", code: (code ?? element).textContent ?? "", ...(language ? { language } : {}) });
    } else if (tag === "HR") {
      blocks.push({ type: "rule" });
    } else if (tag === "TABLE") {
      const rows = [...element.querySelectorAll("tr")].map((row) =>
        [...row.children].filter((cell) => cell.tagName === "TD" || cell.tagName === "TH").map((cell) => trimmed(inlinesOf(cell.childNodes))),
      );
      const header = Boolean(element.querySelector("tr")?.querySelector("th"));
      if (rows.length) blocks.push({ type: "table", header, rows });
    } else if (tag === "FIGURE") {
      const image = element.querySelector("img");
      if (image) blocks.push({ type: "media", url: image.getAttribute("src") ?? "", alt: image.getAttribute("alt") ?? "" });
      else blocks.push(...blocksOf(element.childNodes));
    } else {
      blocks.push(...blocksOf(element.childNodes));
    }
  }
  flush();
  return blocks;
}

function fallbackText(html: string) {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

/** Editor HTML as the shared model. */
export function richContentFromHtml(html: string): SpectraRichContentAst {
  if (typeof DOMParser === "undefined") {
    const paragraphs = fallbackText(html).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return richContentAst(paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })), html);
  }
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return richContentAst(blocksOf(document.body.childNodes), html);
}
