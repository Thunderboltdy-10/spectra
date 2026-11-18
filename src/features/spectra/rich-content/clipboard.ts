/*
 * What a paste carries, read the same way everywhere. Word, PowerPoint and
 * Outlook put a picture of the selection on the clipboard beside its text, so
 * a paste that has text is text: the files are attached only when the paste is
 * nothing else (a screenshot, an image copied on its own).
 */

/** The files a paste brings, unless it brings text, which wins. */
export function pastedFiles(data: DataTransfer | null | undefined): File[] {
  if (!data?.files.length) return [];
  if (pastedText(data)) return [];
  return Array.from(data.files);
}

/** The paste's plain text, when it has any beyond white space. */
export function pastedText(data: DataTransfer | null | undefined) {
  const text = data?.getData("text/plain") ?? "";
  return text.trim() ? text : "";
}

const WORD_MARKER = /<!\[if !supportLists\]>([\s\S]*?)<!\[endif\]>/gi;
const CONDITIONAL = /<!--\[if[\s\S]*?<!\[endif\]-->/gi;
const ORDERED_MARKER = /^(\(?([0-9]+|[a-z]|[ivxlc]+)[.)])$/i;

/** Whether some pasted HTML came from Word or another Office app. */
export function isOfficeHtml(html: string) {
  return /urn:schemas-microsoft-com:office|class="?Mso|mso-/i.test(html);
}

/**
 * Word's HTML made plain HTML a document reads as Word meant it: its list
 * paragraphs (a paragraph per item, the bullet drawn as text) become real
 * nested lists, and its own markup (o:p, conditional comments, mso styles,
 * class names) goes. Bold, italics, colours, headings, tables and links stay.
 * Any other HTML comes back as it was.
 */
export function cleanOfficeHtml(html: string): string {
  if (!isOfficeHtml(html) || typeof DOMParser === "undefined") return html;
  const marked = html
    .replace(CONDITIONAL, "")
    .replace(WORD_MARKER, (_, marker: string) => {
      const text = marker.replace(/<[^>]*>/g, "").replace(/&nbsp;| /g, " ").trim();
      return `<span data-word-marker="${ORDERED_MARKER.test(text) ? "ol" : "ul"}"></span>`;
    });
  const doc = new DOMParser().parseFromString(marked, "text/html");
  const body = doc.body;
  for (const element of Array.from(body.getElementsByTagName("*"))) {
    if (element.tagName.toLowerCase() === "o:p") {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    // Word's own styling is noise to a document; a colour or a highlight is kept.
    const style = element.getAttribute("style");
    if (style) {
      const kept = style
        .split(";")
        .map((rule) => rule.trim())
        .filter((rule) => /^(color|background(-color)?|font-weight|font-style|text-decoration)\s*:/i.test(rule))
        .filter((rule) => !/windowtext|auto/i.test(rule));
      const listRule = /mso-list:\s*l(\d+)\s+level(\d+)/i.exec(style);
      if (listRule) {
        element.setAttribute("data-word-list", listRule[1]!);
        element.setAttribute("data-word-level", listRule[2]!);
      }
      if (kept.length) element.setAttribute("style", kept.join("; "));
      else element.removeAttribute("style");
    }
    if (/^Mso/i.test(element.getAttribute("class") ?? "")) element.removeAttribute("class");
  }
  const comments = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const found: Node[] = [];
  while (comments.nextNode()) found.push(comments.currentNode);
  for (const comment of found) comment.parentNode?.removeChild(comment);
  buildLists(body);
  for (const marker of Array.from(body.querySelectorAll("[data-word-marker]"))) marker.remove();
  return body.innerHTML;
}

/**
 * Runs of Word list paragraphs, each made a list item nested by its level.
 * A run is paragraphs side by side under one parent (the page or a table cell).
 */
function buildLists(body: HTMLElement) {
  const doc = body.ownerDocument;
  const parents = new Set(Array.from(body.querySelectorAll("[data-word-list]"), (element) => element.parentElement!));
  for (const parent of parents) {
    let stack: HTMLElement[] = [];
    for (const paragraph of Array.from(parent.children) as HTMLElement[]) {
      if (!paragraph.hasAttribute("data-word-list")) {
        stack = [];
        continue;
      }
      const level = Math.min(9, Math.max(1, Number(paragraph.getAttribute("data-word-level")) || 1));
      const kind = paragraph.querySelector("[data-word-marker]")?.getAttribute("data-word-marker") === "ol" ? "ol" : "ul";
      paragraph.removeAttribute("data-word-list");
      paragraph.removeAttribute("data-word-level");
      if (!stack.length) {
        const root = doc.createElement(kind);
        paragraph.before(root);
        stack = [root];
      }
      while (stack.length > level) stack.pop();
      while (stack.length < level) {
        const list = stack[stack.length - 1]!;
        const owner = (list.lastElementChild as HTMLElement | null) ?? list.appendChild(doc.createElement("li"));
        const nested = doc.createElement(kind);
        owner.appendChild(nested);
        stack.push(nested);
      }
      const item = doc.createElement("li");
      item.appendChild(paragraph);
      stack[stack.length - 1]!.appendChild(item);
    }
  }
}
