import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  NATIVE_WORK_LIVE_META_MAP,
  NativeArtifactYjsModel,
} from "../work/models/yjs/native-artifact-model";
import { presentationYjsAdapter } from "../work/models/yjs/structured-adapters";
import { workYjsOrigins } from "../work/models/yjs/origins";
import { replaceYArray, shareUnchanged } from "../work/models/yjs/shared";
import { flashcardDeckYjsAdapter } from "../work/models/yjs/structured-adapters";
import { createPresentationObject } from "../presentation/model";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { requireArtifactTypeManifest } from "../artifacts/registry";
import {
  changedArtifactRegionIds,
  decomposeArtifactContent,
  recomposeArtifactContent,
} from "../collaboration/artifact-yjs-model";

/**
 * Hot paths that run per keystroke or per save must scale with the size of an
 * artifact, not with its square. Bounds are deliberately generous (an order
 * of magnitude above the measured cost) so a loaded CI machine stays green
 * while a quadratic regression still fails.
 */
function elapsed(run: () => unknown) {
  const start = performance.now();
  run();
  return performance.now() - start;
}

const sentence =
  "The mitochondria is the powerhouse of the cell and a student writes notes. ";

function largeQuiz(questions: number) {
  return normalizeArtifactContent("quiz", {
    questions: Array.from({ length: questions }, (_, index) => ({
      id: `q${index}`,
      type: "multiple_choice",
      prompt: `Question ${index}: ${sentence}`,
      options: ["Alpha", "Beta", "Gamma", "Delta"],
      correctAnswer: "Alpha",
      explanation: sentence,
    })),
  }) as { questions: Array<Record<string, unknown>> };
}

describe("region decomposition on large artifacts", () => {
  it("finds the region a keystroke changed in a 400-question quiz without a quadratic scan", () => {
    // 7,200 regions. The pairwise ancestor scan took ~3 s here (~800 ms at
    // 200 questions); the path index takes tens of milliseconds.
    const before = largeQuiz(400);
    const after = {
      ...before,
      questions: before.questions.map((question, index) =>
        index === 200 ? { ...question, prompt: `${String(question.prompt)}x` } : question,
      ),
    };
    let changed: string[] = [];
    const ms = elapsed(() => {
      changed = changedArtifactRegionIds("quiz", before, after);
    });
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("q200");
    expect(ms).toBeLessThan(1_000);
  });

  it("nests every region template under its nearest ancestor", () => {
    const quiz = largeQuiz(3);
    const decomposed = decomposeArtifactContent("quiz", quiz);
    expect(
      recomposeArtifactContent(decomposed.rootTemplate, decomposed.regionValues),
    ).toEqual(requireArtifactTypeManifest("quiz").schemas.content.parse(quiz));
    // A question region holds markers for its own children, never their text,
    // and the root holds only the question markers.
    const questionRegion = [...decomposed.descriptors.values()].find(
      (descriptor) => descriptor.path.length === 2 && descriptor.path[0] === "questions",
    )!;
    const template = decomposed.regionValues.get(questionRegion.regionId)!;
    expect(template).not.toContain("Question 0");
    expect(template).toContain("$spectraRegion");
    expect(decomposed.rootTemplate).not.toContain("Question 0");
  });
});

function modelOver(document: Y.Doc) {
  const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
  liveMeta.set("title", "Deck");
  liveMeta.set("summary", "");
  liveMeta.set("tags", []);
  const transport = {
    clientId: "reader",
    document,
    getSnapshot: () => ({
      state: "synchronized" as const,
      level: "modify" as const,
      unsynchronizedChanges: 0,
      presence: [],
    }),
  };
  return new NativeArtifactYjsModel(
    "presentation",
    transport as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1],
  );
}

describe("live projection identity", () => {
  const deck = {
    slides: Array.from({ length: 40 }, (_, index) => ({
      id: `slide-${index}`,
      title: `Slide ${index}`,
      layoutId: "title-content",
      objects: [{ ...createPresentationObject("text", 1), id: `s${index}-t` }],
      speakerNotes: "",
    })),
  };

  it("keeps every untouched slide's identity when a collaborator edits one", () => {
    const document = presentationYjsAdapter.createDocument(deck as never);
    const model = modelOver(document);
    const before = model.flushSnapshot().value!.content as typeof deck;
    const edited = structuredClone(before);
    edited.slides[7]!.title = "Edited by a peer";
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(document));
    presentationYjsAdapter.applyProjection(
      peer,
      edited as never,
      workYjsOrigins({ clientId: "peer", kind: "human" }).localHuman,
    );
    Y.applyUpdate(document, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(document)));
    const after = model.flushSnapshot().value!.content as typeof deck;
    expect(after.slides[7]!.title).toBe("Edited by a peer");
    expect(after.slides[7]).not.toBe(before.slides[7]);
    // Before: 0 of 40 slides kept their identity after any remote edit.
    expect(after.slides.filter((slide, index) => slide === before.slides[index])).toHaveLength(39);
    model.destroy();
  });

  it("keeps the whole snapshot when an update leaves the projected value unchanged", () => {
    const document = presentationYjsAdapter.createDocument(deck as never);
    const model = modelOver(document);
    const before = model.flushSnapshot();
    document.getMap("unrelated").set("touched", true);
    expect(model.flushSnapshot()).toBe(before);
    model.destroy();
  });

  it("shares only deep-equal subtrees and respects key order", () => {
    const previous = { a: { x: 1 }, b: [{ y: 2 }, { y: 3 }] };
    const next = shareUnchanged(previous, { a: { x: 1 }, b: [{ y: 2 }, { y: 4 }] });
    expect(next).toEqual({ a: { x: 1 }, b: [{ y: 2 }, { y: 4 }] });
    expect(next.a).toBe(previous.a);
    expect(next.b[0]).toBe(previous.b[0]);
    expect(next.b[1]).not.toBe(previous.b[1]);
    expect(shareUnchanged(previous, structuredClone(previous))).toBe(previous);
    const reordered = shareUnchanged(previous, { b: previous.b, a: previous.a });
    expect(reordered).not.toBe(previous);
    expect(Object.keys(reordered)).toEqual(["b", "a"]);
    expect(shareUnchanged({ a: 1 }, { a: 1, b: undefined })).toEqual({ a: 1, b: undefined });
  });
});

describe("keyed list diffs on long lists", () => {
  function editCount(from: string[], to: string[]) {
    const doc = new Y.Doc();
    const array = doc.getArray<string>("order");
    array.push(from);
    let operations = 0;
    array.observe((event) => {
      operations += event.changes.delta.length;
    });
    doc.transact(() => replaceYArray(array, to));
    return { result: array.toArray(), operations };
  }

  it("reaches the target with a minimal edit for random reorders", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 60; round += 1) {
      const from = Array.from({ length: 1 + Math.floor(random() * 40) }, (_, index) => `i${index}`);
      const to = from.filter(() => random() > 0.2).sort(() => random() - 0.5);
      if (random() > 0.5) to.splice(Math.floor(random() * to.length), 0, "new");
      expect(editCount(from, to).result).toEqual(to);
    }
    // Moving one item is one delete and one insert, not a rewrite.
    const ids = Array.from({ length: 5000 }, (_, index) => `id-${index}`);
    const moved = [...ids.slice(1), ids[0]!];
    const start = performance.now();
    const { result } = editCount(ids, moved);
    expect(result).toEqual(moved);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it("merges concurrent reorders of a 3,000-card deck without duplicating it", () => {
    const card = (id: string) => ({ id, front: id, back: id });
    const base = { title: "Deck", cards: Array.from({ length: 3000 }, (_, index) => card(`c${index}`)) };
    const left = flashcardDeckYjsAdapter.createDocument(base as never);
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const origin = (clientId: string) => workYjsOrigins({ clientId, kind: "human" }).localHuman;
    // One peer moves the last card to the front, the other the first card to
    // the end, and each adds one. Both changed middles span the whole list
    // (3,000 x 3,001 cells, above the old 4M-cell cap), so both peers used to
    // rewrite the order and the merged order held every id twice.
    const lastFirst = [base.cards.at(-1)!, ...base.cards.slice(0, -1)];
    const firstLast = [...base.cards.slice(1), base.cards[0]!];
    flashcardDeckYjsAdapter.applyProjection(left, { ...base, cards: [...lastFirst, card("x")] } as never, origin("l"));
    flashcardDeckYjsAdapter.applyProjection(right, { ...base, cards: [...firstLast, card("y")] } as never, origin("r"));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left, Y.encodeStateVector(right)));
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
    const ids = (flashcardDeckYjsAdapter.project(left) as { cards: Array<{ id: string }> }).cards.map((entry) => entry.id);
    expect(ids).toHaveLength(3002);
    const order = left.getMap("spectra:work-v2").get("cards") as Y.Map<unknown>;
    // The underlying order holds each id once: nothing was rewritten whole.
    expect((order.get("order") as Y.Array<string>).length).toBe(3002);
  });
});
