import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { textHunks } from "../collaboration/hand/text";

/*
 * Someone else's words while they are still writing them.
 *
 * A shared document is bound to the room, so a collaborator's in-flight value
 * cannot replace what the editor shows. Instead each block they are writing is
 * drawn as they have it right now, over whatever the room holds: words they
 * have not typed yet are hidden, and words still on their screen (old text not
 * yet deleted, new text the room has not received) are drawn in place with the
 * marks around them. The document itself is never touched.
 */

export type SpeculativeBlockText = {
  /** The block's stable id, when known. */
  blockId?: string;
  /** The block's position among the top-level blocks, when there is no id. */
  index?: number;
  /** The block's whole text as the writer has it now (lines joined by \n). */
  text: string;
};

export const aiSpeculationKey = new PluginKey<DecorationSet>("spectraAiSpeculation");

/** Hidden text the presence layer must not count when it finds a caret. */
export const UNWRITTEN_ATTRIBUTE = "data-spectra-unwritten";

/** Above this many places differing, the block is mid-rewrite; show the room's text. */
const MAX_HUNKS = 12;

type Glyph = { char: string; pos: number | null };

/** The block's text as its semantic block reads it, with where each character is. */
function glyphsOf(node: ProseMirrorNode, start: number): Glyph[] {
  const glyphs: Glyph[] = [];
  const walk = (current: ProseMirrorNode, pos: number) => {
    if (current.isText) {
      const text = current.text ?? "";
      for (let index = 0; index < text.length; index += 1) glyphs.push({ char: text[index]!, pos: pos + index });
      return;
    }
    if (current.type.name === "hardBreak") {
      glyphs.push({ char: "\n", pos });
      return;
    }
    // Runs inside a paragraph read on as one line; anything holding blocks
    // stacks them on lines (documentNodeText reads them the same way).
    const inline =
      current.type.name === "listItem" ||
      current.type.name === "taskItem" ||
      current.isTextblock;
    let childPos = pos + 1;
    current.forEach((child, _offset, index) => {
      if (index > 0 && !inline) glyphs.push({ char: "\n", pos: null });
      walk(child, childPos);
      childPos += child.nodeSize;
    });
  };
  walk(node, start);
  return glyphs;
}

function findBlock(doc: ProseMirrorNode, target: SpeculativeBlockText) {
  let byId: { node: ProseMirrorNode; pos: number } | null = null;
  let byIndex: { node: ProseMirrorNode; pos: number } | null = null;
  doc.forEach((node, offset, index) => {
    if (target.blockId && node.attrs.blockId === target.blockId) byId ??= { node, pos: offset };
    if (index === target.index) byIndex = { node, pos: offset };
  });
  return byId ?? (byIndex as { node: ProseMirrorNode; pos: number } | null);
}

function writtenWidget(text: string) {
  return () => {
    const span = document.createElement("span");
    span.className = "spectra-ai-written";
    span.textContent = text;
    return span;
  };
}

function decorationsFor(doc: ProseMirrorNode, targets: readonly SpeculativeBlockText[]) {
  const decorations: Decoration[] = [];
  for (const target of targets) {
    const block = findBlock(doc, target);
    if (!block) continue;
    const glyphs = glyphsOf(block.node, block.pos);
    const held = glyphs.map((glyph) => glyph.char).join("");
    if (held === target.text) continue;
    const hunks = textHunks(held, target.text);
    if (hunks.length > MAX_HUNKS) continue;
    const end = block.pos + block.node.nodeSize - 1;
    const positionAt = (offset: number) => {
      for (let index = offset; index < glyphs.length; index += 1)
        if (glyphs[index]!.pos !== null) return glyphs[index]!.pos!;
      for (let index = Math.min(offset, glyphs.length) - 1; index >= 0; index -= 1)
        if (glyphs[index]!.pos !== null) return glyphs[index]!.pos! + 1;
      return Math.min(end, block.pos + 1);
    };
    for (const hunk of hunks) {
      // Not yet written here: hidden, run by run.
      let runFrom: number | null = null;
      let runTo = 0;
      const closeRun = () => {
        if (runFrom !== null)
          decorations.push(Decoration.inline(runFrom, runTo, { class: "spectra-ai-unwritten", [UNWRITTEN_ATTRIBUTE]: "true" }));
        runFrom = null;
      };
      for (let index = hunk.start; index < hunk.start + hunk.removed.length; index += 1) {
        const pos = glyphs[index]?.pos;
        if (pos === null || pos === undefined) {
          closeRun();
          continue;
        }
        if (runFrom !== null && pos === runTo) runTo = pos + 1;
        else {
          closeRun();
          runFrom = pos;
          runTo = pos + 1;
        }
      }
      closeRun();
      // Still on the writer's screen: drawn in, in the marks around it.
      if (hunk.inserted) {
        const pos = positionAt(hunk.start);
        const marks = doc.resolve(Math.min(pos, doc.content.size)).marks();
        decorations.push(
          Decoration.widget(pos, writtenWidget(hunk.inserted), {
            side: -1,
            marks,
            key: `spectra-ai-written:${pos}:${hunk.inserted}`,
          }),
        );
      }
    }
  }
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

type SpeculationState = { targets: readonly SpeculativeBlockText[]; decorations: DecorationSet };

export const AiSpeculationDecoration = Extension.create({
  name: "spectraAiSpeculation",
  addProseMirrorPlugins() {
    const key = new PluginKey<SpeculationState>("spectraAiSpeculationState");
    return [
      new Plugin<SpeculationState>({
        key,
        state: {
          init: () => ({ targets: [], decorations: DecorationSet.empty }),
          apply(transaction, previous) {
            const meta = transaction.getMeta(aiSpeculationKey) as readonly SpeculativeBlockText[] | undefined;
            if (meta === undefined && !transaction.docChanged) return previous;
            const targets = meta ?? previous.targets;
            if (!targets.length) return { targets, decorations: DecorationSet.empty };
            return { targets, decorations: decorationsFor(transaction.doc, targets) };
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.decorations,
        },
      }),
    ];
  },
});
