// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { carryWork } from "../collaboration/carry-work";

// jsdom has no CSS.escape; the ids here need none.
beforeEach(() => {
  if (!globalThis.CSS?.escape) vi.stubGlobal("CSS", { escape: (value: string) => value });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function box(element: Element, left: number, top: number, width: number, height: number) {
  element.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
}

it("one hand comes to the card, picks it up by the corner and sets it down in its place", () => {
  let now = 0;
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const advance = (to: number) => {
    now = to;
    frames.splice(0).forEach((callback) => callback(now));
  };
  const card = document.createElement("div");
  card.setAttribute("data-work-source", "sim");
  card.textContent = "Spring–mass simulation";
  document.body.append(card);
  box(card, 40, 300, 280, 56);

  carryWork({
    workId: "sim",
    flightMs: 1_000,
    target: () => ({ left: 700, top: 200, width: 560, height: 220 }),
    hand: { name: "Pablo's AI", color: "var(--accent)" },
  });
  const hand = document.querySelector<HTMLElement>(".spectra-carry-hand")!;
  const ghost = document.querySelector<HTMLElement>(".spectra-carry-ghost")!;
  expect(hand.textContent).toBe("Pablo's AI");
  expect(document.documentElement.dataset.spectraCarrying).toBe("");
  // Coming to the card, nothing is carried yet.
  advance(150);
  expect(ghost.style.opacity).toBe("0");
  expect(card.getAttribute("data-carry-source")).toBeNull();
  // Picked up: the hand is a grab, the card is lifted, the copy hangs from the corner.
  advance(400);
  expect(hand.querySelector("path")!.getAttribute("d")).toMatch(/^M5 7/);
  expect(card.getAttribute("data-carry-source")).toBe("lifted");
  expect(ghost.style.opacity).toBe("1");
  // Set down: the copy goes, the card is back, and the page's cursor returns.
  advance(1_000);
  expect(document.querySelector(".spectra-carry-ghost")).toBeNull();
  expect(card.getAttribute("data-carry-source")).toBeNull();
  expect(document.documentElement.dataset.spectraCarrying).toBeUndefined();
});

it("with no card on screen, nothing is drawn by hand", () => {
  carryWork({ workId: "missing", flightMs: 1_000, target: () => null });
  expect(document.querySelector(".spectra-carry-hand")).toBeNull();
});
