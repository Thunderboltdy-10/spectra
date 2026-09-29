// @vitest-environment jsdom
import { basicSetup } from "@uiw/react-codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  codeEditorBasicSetup,
  codeEditorCollaboration,
} from "../components/code-studio";

const views: EditorView[] = [];
afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

function pressUndo(view: EditorView) {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    code: "KeyZ",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, "editor");
}

describe("code editor undo while collaborating", () => {
  it("undoes this person's typing and keeps a collaborator's", () => {
    const mine = new Y.Doc();
    const peer = new Y.Doc();
    const text = mine.getText("source");
    text.insert(0, "const a = 1;\n");
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(mine));
    mine.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") Y.applyUpdate(peer, update, "remote");
    });
    peer.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") Y.applyUpdate(mine, update, "remote");
    });

    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          basicSetup(codeEditorBasicSetup(true)),
          ...codeEditorCollaboration(text, new Awareness(mine)),
        ],
      }),
    });
    views.push(view);

    // This person types at the end.
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "mine();" },
      userEvent: "input.type",
    });
    // A collaborator then types at the start.
    peer.getText("source").insert(0, "// peer\n");
    expect(view.state.doc.toString()).toBe(
      "// peer\nconst a = 1;\nmine();",
    );

    expect(pressUndo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("// peer\nconst a = 1;\n");
    expect(peer.getText("source").toString()).toBe(
      "// peer\nconst a = 1;\n",
    );
  });
});
