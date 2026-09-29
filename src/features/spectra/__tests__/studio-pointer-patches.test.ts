import { describe, expect, it } from "vitest";
import { setAtPointers } from "../components/artifact-studio-value-utils";
import { patchSheetCellRecord } from "../sheets/cell-overlay";

/**
 * AI streaming frames and peers' in-flight edits are layered over the
 * studio's content once per frame. That layering used to deep-clone the whole
 * artifact once per patch.
 */
describe("setAtPointers", () => {
  it("applies patches in order, copying only the patched paths", () => {
    const untouched = { id: "b", text: "keep" };
    const target = {
      title: "Deck",
      content: { slides: [{ id: "a", text: "old" }, untouched] },
    };
    const frozen = structuredClone(target);
    const next = setAtPointers(target, [
      ["/content/slides/0/text", "new"],
      ["/content/slides/0/notes/0", "created"],
      ["/content/outline/title", "made"],
      ["/title", "Renamed"],
    ]) as typeof target & {
      content: { outline: { title: string } };
    };
    expect(next).toEqual({
      title: "Renamed",
      content: {
        slides: [{ id: "a", text: "new", notes: ["created"] }, untouched],
        outline: { title: "made" },
      },
    });
    expect(target).toEqual(frozen);
    expect(next.content.slides[1]).toBe(untouched);
  });

  it("clones patch values so a later patch never writes into an earlier one", () => {
    const value = { items: ["x"] };
    const next = setAtPointers({}, [
      ["/list", value],
      ["/list/items/0", "y"],
    ]) as { list: { items: string[] } };
    expect(next.list.items).toEqual(["y"]);
    expect(value.items).toEqual(["x"]);
  });

  it("replaces the root and then patches inside the replacement", () => {
    const replacement = { blocks: [{ text: "a" }] };
    const next = setAtPointers({ stale: true }, [
      ["/", replacement],
      ["/blocks/0/text", "b"],
    ]);
    expect(next).toEqual({ blocks: [{ text: "b" }] });
    expect(replacement.blocks[0]!.text).toBe("a");
  });

  it("layers a frame over a sheet whose cells are an edit overlay", () => {
    // structuredClone of the overlay Proxy threw DataCloneError, so an AI
    // frame arriving while a cell edit was unsaved broke the studio render.
    const cells = patchSheetCellRecord<unknown>(
      { A1: { value: 1 } },
      { B1: { value: 2 } },
    );
    const content = { sheets: [{ id: "s1", cells }] };
    const next = setAtPointers(content, [
      ["/sheets/0/cells/C1", { value: 3 }],
    ]) as { sheets: Array<{ cells: Record<string, unknown> }> };
    expect(next.sheets[0]!.cells).toEqual({
      A1: { value: 1 },
      B1: { value: 2 },
      C1: { value: 3 },
    });
  });

  it("keeps a frame over a 1,000-object board cheap", () => {
    const content = {
      nodes: Array.from({ length: 1_000 }, (_, index) => ({
        id: `n${index}`,
        kind: "note",
        x: index * 10,
        y: index * 5,
        width: 240,
        height: 160,
        style: { fill: "var(--surface)", stroke: "var(--ink)", fontSize: 14 },
        content: { text: `Idea ${index} with some body text for the note` },
      })),
    };
    const patches = Array.from(
      { length: 30 },
      (_, index) => [`/nodes/${index * 30}/content/text`, `AI ${index}`] as const,
    );
    setAtPointers(content, patches);
    const start = performance.now();
    for (let frame = 0; frame < 10; frame += 1)
      setAtPointers(content, patches);
    const perFrame = (performance.now() - start) / 10;
    // Measured ~0.1 ms after and ~90 ms before (one clone per patch).
    expect(perFrame).toBeLessThan(15);
  });
});
