import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { flashcardDeckYjsAdapter } from "../work/models/yjs/structured-adapters";
import { workYjsOrigins } from "../work/models/yjs/origins";
import {
  draftContentForLiveWrite,
  mergeConcurrentText,
  rebaseCollaborativeValue,
} from "../components/artifact-studio-value-utils";

const actor = (clientId: string) => ({ clientId, kind: "human" as const });
const card = (id: string, front = `front ${id}`) => ({ id, front, back: `back ${id}` });

function pair(initial: unknown) {
  const left = flashcardDeckYjsAdapter.createDocument(initial as never);
  const right = new Y.Doc();
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  return { left, right };
}
function exchange(left: Y.Doc, right: Y.Doc) {
  const toRight = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right));
  const toLeft = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left));
  Y.applyUpdate(right, toRight);
  Y.applyUpdate(left, toLeft);
}
const ids = (doc: Y.Doc) =>
  (flashcardDeckYjsAdapter.project(doc) as { cards: Array<{ id: string }> }).cards.map((entry) => entry.id);

describe("structured Yjs collections under concurrency", () => {
  it("keeps both cards when two collaborators add one at the same time", () => {
    const base = { title: "Deck", cards: [card("a"), card("b"), card("c")] };
    const { left, right } = pair(base);
    flashcardDeckYjsAdapter.applyProjection(left, { ...base, cards: [...base.cards, card("x")] } as never, workYjsOrigins(actor("l")).localHuman);
    flashcardDeckYjsAdapter.applyProjection(right, { ...base, cards: [...base.cards, card("y")] } as never, workYjsOrigins(actor("r")).localHuman);
    exchange(left, right);
    expect(ids(left)).toEqual(ids(right));
    expect([...ids(left)].sort()).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("merges a concurrent delete with a concurrent add without duplicating survivors", () => {
    const base = { title: "Deck", cards: [card("a"), card("b"), card("c")] };
    const { left, right } = pair(base);
    flashcardDeckYjsAdapter.applyProjection(left, { ...base, cards: [...base.cards, card("x")] } as never, workYjsOrigins(actor("l")).localHuman);
    flashcardDeckYjsAdapter.applyProjection(right, { ...base, cards: [card("a"), card("b")] } as never, workYjsOrigins(actor("r")).localHuman);
    exchange(left, right);
    expect(ids(left)).toEqual(["a", "b", "x"]);
    expect(ids(right)).toEqual(["a", "b", "x"]);
  });

  it("never projects an item twice when two collaborators reorder concurrently", () => {
    const base = { title: "Deck", cards: [card("a"), card("b"), card("c")] };
    const { left, right } = pair(base);
    flashcardDeckYjsAdapter.applyProjection(left, { ...base, cards: [card("c"), card("a"), card("b")] } as never, workYjsOrigins(actor("l")).localHuman);
    flashcardDeckYjsAdapter.applyProjection(right, { ...base, cards: [card("b"), card("a"), card("c")] } as never, workYjsOrigins(actor("r")).localHuman);
    exchange(left, right);
    expect(ids(left)).toEqual(ids(right));
    expect([...ids(left)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("structured Yjs collections that become empty", () => {
  it("keeps a card a collaborator adds while another deletes the last one", () => {
    const base = { title: "Deck", cards: [card("a")] };
    const { left, right } = pair(base);
    flashcardDeckYjsAdapter.applyProjection(left, { ...base, cards: [] } as never, workYjsOrigins(actor("l")).localHuman);
    flashcardDeckYjsAdapter.applyProjection(right, { ...base, cards: [card("a"), card("x")] } as never, workYjsOrigins(actor("r")).localHuman);
    exchange(left, right);
    expect(ids(left)).toEqual(["x"]);
    expect(ids(right)).toEqual(["x"]);
  });
});

describe("writing a studio draft into a room a peer already changed", () => {
  it("keeps the peer's unabsorbed card edit and the local edit", () => {
    const base = { title: "Deck", cards: [card("a"), card("b")] };
    const { left, right } = pair(base);
    // The peer edits card b and the update reaches this room first.
    flashcardDeckYjsAdapter.applyProjection(right, { ...base, cards: [card("a"), card("b", "peer front")] } as never, workYjsOrigins(actor("r")).localHuman);
    exchange(left, right);
    // React still shows the baseline and the student typed into card a.
    const draft = { ...base, cards: [card("a", "local front"), card("b")] };
    const live = flashcardDeckYjsAdapter.project(left);
    const content = draftContentForLiveWrite({ baseline: flashcardDeckYjsAdapter.project(pair(base).left), draft, live });
    flashcardDeckYjsAdapter.applyProjection(left, content as never, workYjsOrigins(actor("l")).localHuman);
    exchange(left, right);
    const fronts = (doc: Y.Doc) => (flashcardDeckYjsAdapter.project(doc) as { cards: Array<{ front: string }> }).cards.map((entry) => entry.front);
    expect(fronts(left)).toEqual(["local front", "peer front"]);
    expect(fronts(right)).toEqual(["local front", "peer front"]);
  });

  it("merges two people typing in different places of the same field", () => {
    expect(mergeConcurrentText("The cell divides.", "The animal cell divides.", "The cell divides by mitosis.")).toBe(
      "The animal cell divides by mitosis.",
    );
    expect(
      rebaseCollaborativeValue({ text: "abc def" }, { text: "abc XYZ def" }, { text: "abc def ghi" }),
    ).toEqual({ value: { text: "abc XYZ def ghi" }, conflicts: [] });
  });

  it("still reports overlapping edits of the same words and keeps the local side", () => {
    expect(mergeConcurrentText("colour", "color", "colours")).toBe("colors");
    expect(mergeConcurrentText("the cat sat", "the cut sat", "the cot sat")).toBeNull();
    expect(mergeConcurrentText("ab", "aXb", "aYb")).toBeNull();
    expect(rebaseCollaborativeValue({ text: "the cat" }, { text: "the cut" }, { text: "the cot" })).toEqual({
      value: { text: "the cut" },
      conflicts: ["/text"],
    });
  });
});
