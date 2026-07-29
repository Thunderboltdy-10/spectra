/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { resolvePresenceAnchorElement } from "../collaboration/presence-anchor";

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
});
