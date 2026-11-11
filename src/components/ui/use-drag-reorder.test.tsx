// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDragReorder } from "./use-drag-reorder";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, "getAnimations"); Reflect.deleteProperty(HTMLElement.prototype, "animate"); });

it.each(["hover", "spectra-reorder"])("handles a target with a running %s animation", (animationId) => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.textContent === "b" ? 100 : 0;
    return { x: 0, y: top, left: 0, right: 100, top, bottom: top + 50, width: 100, height: 50, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", { configurable: true, value: () => [{ id: animationId, playState: "running" } as Animation] });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: () => ({ id: "" } as Animation) });
  const reordered = vi.fn();
  function List() {
    const drag = useDragReorder({ ids: ["a", "b"], onReorder: reordered });
    return <div ref={(node) => { drag.containerRef.current = node; }}>{drag.order.map((id) => <button key={id} {...drag.itemProps(id)}>{id}</button>)}</div>;
  }
  render(<List />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "a" }), { button: 0, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(window, { clientX: 20, clientY: 120 });
  fireEvent.pointerUp(window);
  if (animationId === "hover") expect(reordered).toHaveBeenCalledWith(["b", "a"]);
  else expect(reordered).not.toHaveBeenCalled();
});
