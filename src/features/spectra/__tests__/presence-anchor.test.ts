/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { clientRectForCharOffset, resolvePresenceAnchorElement } from "../collaboration/presence-anchor";

describe("presence-anchor", () => {
  it("resolves block anchors by semantic id", () => {
    document.body.innerHTML = `
      <div class="root">
        <p data-block-id="b2">Hello</p>
        <div data-address="D4">Cell</div>
      </div>
    `;
    const root = document.querySelector(".root") as HTMLElement;
    expect(
      resolvePresenceAnchorElement(root, { kind: "block", id: "b2" })?.textContent,
    ).toBe("Hello");
    expect(
      resolvePresenceAnchorElement(root, { kind: "address", id: "D4" })
        ?.textContent,
    ).toBe("Cell");
  });

  it("puts a writer's caret at the front of what has arrived, ignoring words drawn in for another writer", () => {
    document.body.innerHTML = `
      <div class="root">
        <p data-block-id="b1">Osmosis<span class="spectra-ai-written">drawn in</span> moves</p>
      </div>
    `;
    const root = document.querySelector(".root") as HTMLElement;
    const starts: [Node, number][] = [];
    const proto = Range.prototype as unknown as { getClientRects?: () => DOMRectList };
    const setStart = vi.spyOn(Range.prototype, "setStart").mockImplementation(function (node, offset) {
      starts.push([node, offset]);
    });
    const original = proto.getClientRects;
    proto.getClientRects = () => [{ height: 10, width: 0 }] as unknown as DOMRectList;
    try {
      // Within what this screen has: "Osmosis| moves", the drawn-in words not counted.
      clientRectForCharOffset(root, "b1", 9);
      expect(starts.at(-1)?.[0].textContent).toBe(" moves");
      expect(starts.at(-1)?.[1]).toBe(2);
      // The writer is ahead of this screen: the caret waits at the end, not the line start.
      clientRectForCharOffset(root, "b1", 40);
      expect(starts.at(-1)?.[0].textContent).toBe(" moves");
      expect(starts.at(-1)?.[1]).toBe(6);
    } finally {
      setStart.mockRestore();
      if (original) proto.getClientRects = original;
      else delete proto.getClientRects;
    }
  });
});
