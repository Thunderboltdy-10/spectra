// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LocalTrailingParagraph } from "../editor/local-trailing-paragraph";
import { StableBlockId } from "../editor/stable-block-id";

const FRAGMENT = "spectra:document-v2";

/** A shared document as another client left it: ending in a list, ids only on top. */
function sharedDocument() {
  const document = new Y.Doc();
  const fragment = document.getXmlFragment(FRAGMENT);
  document.transact(() => {
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.setAttribute("blockId", "block_intro");
    paragraph.insert(0, [new Y.XmlText("Intro")]);
    const item = new Y.XmlElement("listItem");
    const inner = new Y.XmlElement("paragraph");
    inner.insert(0, [new Y.XmlText("Point")]);
    item.insert(0, [inner]);
    const list = new Y.XmlElement("bulletList");
    list.setAttribute("blockId", "block_list");
    list.insert(0, [item]);
    fragment.insert(0, [paragraph, list]);
  });
  return document;
}

function open(document: Y.Doc) {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, trailingNode: false }),
      LocalTrailingParagraph,
      StableBlockId,
      Collaboration.configure({ fragment: document.getXmlFragment(FRAGMENT) }),
    ],
  });
}

describe("opening a shared document", () => {
  it("writes nothing to it", async () => {
    const document = sharedDocument();
    const before = Y.encodeStateAsUpdate(document);
    let writes = 0;
    document.on("update", () => {
      writes += 1;
    });
    const editor = open(document);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes).toBe(0);
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
    expect(editor.getJSON().content?.at(-1)?.type).toBe("bulletList");
    editor.destroy();
  });

  it("stays silent when another client's change arrives", async () => {
    const document = sharedDocument();
    const editor = open(document);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(document));
    const added = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    const inner = new Y.XmlElement("paragraph");
    inner.insert(0, [new Y.XmlText("From someone else")]);
    item.insert(0, [inner]);
    added.insert(0, [item]);
    const fragment = remote.getXmlFragment(FRAGMENT);
    fragment.insert(fragment.length, [added]);
    let localWrites = 0;
    document.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") localWrites += 1;
    });
    Y.applyUpdate(document, Y.encodeStateAsUpdate(remote), "remote");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editor.getText()).toContain("From someone else");
    expect(localWrites).toBe(0);
    editor.destroy();
  });

  it("gives blocks an identity and a place to type once the person edits", async () => {
    const document = sharedDocument();
    const editor = open(document);
    await new Promise((resolve) => setTimeout(resolve, 20));
    editor.commands.insertContentAt(1, "Hello ");
    const content = editor.getJSON().content ?? [];
    expect(content.at(-1)?.type).toBe("paragraph");
    expect(content.at(-1)?.attrs?.blockId).toBeTruthy();
    expect((content[1]?.content?.[0] as { attrs?: { blockId?: string } } | undefined)?.attrs?.blockId).toBeTruthy();
    expect(document.getXmlFragment(FRAGMENT).length).toBe(3);
    editor.destroy();
  });
});
