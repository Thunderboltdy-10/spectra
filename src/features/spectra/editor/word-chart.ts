import { Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isYjsOriginDocumentTransaction } from "./collaboration-change";

const EMU_PER_PIXEL = 9525;
const OBJECT_NAMES: Record<string, string> = { textBox: "Text box from Word", smartArt: "SmartArt from Word", object: "Object from Word" };

/** Each paragraph's Word charts, by block id. */
function chartsByBlock(doc: ProseMirrorNode) {
  const counts = new Map<string, number>();
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const blockId = node.attrs.blockId;
    if (typeof blockId !== "string" || !blockId) return false;
    let count = 0;
    node.forEach((child) => {
      if (child.type.name === "wordChart") count += 1;
    });
    if (count) counts.set(blockId, count);
    return false;
  });
  return counts;
}

/** False when an edit takes a chart out of a paragraph that is still there. */
export function keepsWordCharts(before: ProseMirrorNode, after: ProseMirrorNode) {
  const had = chartsByBlock(before);
  if (!had.size) return true;
  const has = chartsByBlock(after);
  const kept = new Set<string>();
  after.descendants((node) => {
    if (typeof node.attrs.blockId === "string") kept.add(node.attrs.blockId);
    return !node.isTextblock;
  });
  for (const [blockId, count] of had)
    if (kept.has(blockId) && (has.get(blockId) ?? 0) < count) return false;
  return true;
}

/**
 * A chart from the Word file, drawn from the values Word cached, or a text
 * box, SmartArt or embedded object shown as a frame at its size (a text box
 * with its words). None is edited here: Word keeps it, and the paragraph
 * around it stays editable. Removing the whole paragraph removes it from Word too.
 */
export const WordChart = Node.create({
  name: "wordChart",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      partName: { default: null },
      /** Not a chart: "textBox", "smartArt" or "object", shown as a frame. */
      kind: { default: null },
      text: { default: "" },
      widthEmu: { default: null },
      heightEmu: { default: null },
      src: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-word-chart]" }];
  },

  renderHTML({ node }) {
    const width = Math.max(1, Math.round(Number(node.attrs.widthEmu) / EMU_PER_PIXEL) || 576);
    const height = Math.max(1, Math.round(Number(node.attrs.heightEmu) / EMU_PER_PIXEL) || 336);
    const kind = typeof node.attrs.kind === "string" ? node.attrs.kind : "";
    if (kind) {
      const text = kind === "textBox" && typeof node.attrs.text === "string" ? node.attrs.text : "";
      const name = OBJECT_NAMES[kind] ?? "Object from Word";
      return ["span", {
        "data-word-chart": "",
        "data-word-object": kind,
        ...(text ? {} : { "data-empty": "true" }),
        class: "spectra-word-chart",
        contenteditable: "false",
        title: `${name}. Edit it in Word.`,
        style: text ? `width: ${width}px; min-height: ${Math.min(height, 2000)}px;` : `aspect-ratio: ${width} / ${height}; width: ${width}px;`,
      }, text || name];
    }
    const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
    const frame = {
      "data-word-chart": typeof node.attrs.partName === "string" ? node.attrs.partName : "",
      class: "spectra-word-chart",
      contenteditable: "false",
      title: "Chart from Word. Edit it in Word.",
      style: `aspect-ratio: ${width} / ${height}; width: ${width}px;`,
    };
    return src
      ? ["span", frame, ["img", { src, alt: "Chart from Word", width: String(width), height: String(height), loading: "lazy", draggable: "false" }]]
      : ["span", { ...frame, "data-empty": "true" }, "Chart from Word"];
  },

  renderText() {
    return "";
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("spectraWordChart"),
        // A chart can't be cut out of its paragraph here: Word would keep it.
        // The paragraph itself may still go, and the chart with it.
        filterTransaction: (transaction, state) =>
          !transaction.docChanged || isYjsOriginDocumentTransaction(transaction) || keepsWordCharts(state.doc, transaction.doc),
      }),
    ];
  },
});
