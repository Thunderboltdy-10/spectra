import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { flashcardDeckYjsAdapter } from "../work/models/yjs/structured-adapters";
import { workYjsOrigins } from "../work/models/yjs/origins";

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
