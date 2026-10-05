// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  on: true,
  form: vi.fn(),
  travel: vi.fn(),
  unform: vi.fn(() => Promise.resolve()),
  glow: vi.fn(),
  glowStop: vi.fn(),
  wake: vi.fn(),
  pulse: vi.fn(),
}));

vi.mock("../life/life", () => ({
  life: {
    get on() {
      return field.on;
    },
    form: field.form,
    travel: field.travel,
    unform: field.unform,
    wake: field.wake,
    pulse: field.pulse,
    glow: (...args: unknown[]) => {
      field.glow(...args);
      return { move: vi.fn(), stop: field.glowStop };
    },
  },
}));

const BAR = { points: [0, 0, 10, 0], closed: false, width: 4, colour: [0, 0, 0], alpha: 0.2 };
vi.mock("../life/figure-dom", () => ({
  barsOf: () => [BAR],
  figureOf: () => ({ strokes: [BAR, BAR] }),
  inkOf: () => [20, 19, 24],
}));

import {
  BULK_BATCH,
  MAX_BANDS,
  SEEN_MS,
  WARM_UP_MS,
  chooseSource,
  planBatch,
  useEditorFieldMoments,
} from "../components/editor-field-moments";

const RECT = { x: 100, y: 200, width: 300, height: 60 };

describe("where a change's matter comes from", () => {
  it("is your own press when you just acted", () => {
    expect(chooseSource({ local: [5, 5], cursors: [{ point: [1, 1], ai: true }], aiActive: true, prism: [9, 9], target: RECT })).toEqual({
      kind: "local",
      point: [5, 5],
    });
  });

  it("is the nearest cursor, a person's or Spectra's, otherwise", () => {
    const source = chooseSource({
      local: null,
      cursors: [
        { point: [900, 900], ai: false },
        { point: [260, 240], ai: true },
      ],
      aiActive: true,
      prism: [500, 700],
      target: RECT,
    });
    expect(source).toEqual({ kind: "peer", point: [260, 240], ai: true });
  });

  it("is the prism when Spectra writes without a cursor here", () => {
    expect(chooseSource({ local: null, cursors: [], aiActive: true, prism: [500, 700], target: RECT })).toEqual({
      kind: "prism",
      point: [500, 700],
    });
  });

  it("is the thing itself when nobody can be seen making it", () => {
    expect(chooseSource({ local: null, cursors: [], aiActive: false, prism: [500, 700], target: RECT })).toEqual({ kind: "self" });
  });
});

describe("which changes become moments", () => {
  const p = (tag = "p") => document.createElement(tag);
  const card = () => {
    const element = document.createElement("li");
    element.setAttribute("data-life-object", "x");
    return element;
  };
  const isText = (element: Element) => element.tagName === "P";

  it("forms what was added and unforms what was removed", () => {
    const added = card();
    const removed = document.createElement("div");
    const plan = planBatch({ added: [added], removed: [removed], local: false, isText });
    expect(plan.forms).toEqual([added]);
    expect(plan.unforms).toEqual([removed]);
  });

  it("treats a re-render as no event at all", () => {
    const many = Array.from({ length: BULK_BATCH + 1 }, card);
    expect(planBatch({ added: many, removed: [], local: false, isText })).toEqual({ forms: [], unforms: [] });
  });

  it("never animates your own new paragraph, and forms someone else's", () => {
    const paragraph = p();
    expect(planBatch({ added: [paragraph], removed: [], local: true, isText }).forms).toEqual([]);
    expect(planBatch({ added: [paragraph], removed: [], local: false, isText }).forms).toEqual([paragraph]);
  });

  it("forms an edit in place and does not unform the old copy", () => {
    const before = card();
    const after = card();
    const plan = planBatch({ added: [after], removed: [before], local: false, isText });
    expect(plan.forms).toEqual([after]);
    expect(plan.unforms).toEqual([]);
  });

  it("never unforms text: deleted words simply go", () => {
    expect(planBatch({ added: [], removed: [p()], local: true, isText }).unforms).toEqual([]);
  });
});

function Studio({ children, aiState }: { children?: React.ReactNode; aiState?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEditorFieldMoments(ref);
  return (
    <div ref={ref} data-ai-state={aiState}>
      <section className="spectra-artifact-main">
        <ul className="spectra-item-rail-list">{children}</ul>
      </section>
    </div>
  );
}

describe("the field in an editor", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    field.on = true;
    for (const mock of [field.form, field.travel, field.unform, field.glow, field.glowStop, field.wake, field.pulse]) mock.mockClear();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      ...RECT,
      top: RECT.y,
      left: RECT.x,
      right: RECT.x + RECT.width,
      bottom: RECT.y + RECT.height,
      toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const settle = async (ms = 32) => {
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(ms);
    });
  };

  const list = () => document.querySelector(".spectra-item-rail-list")!;
  const addCard = () => {
    const item = document.createElement("li");
    item.textContent = "A new card";
    list().appendChild(item);
    return item;
  };

  it("lets the first content arrive without a moment", async () => {
    render(<Studio />);
    addCard();
    await settle();
    expect(field.form).not.toHaveBeenCalled();
    expect(field.travel).not.toHaveBeenCalled();
  });

  it("forms a new card from where you pressed", async () => {
    render(<Studio />);
    await settle(WARM_UP_MS + 10);
    list().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 50 }));
    addCard();
    await settle();
    expect(field.form).toHaveBeenCalledTimes(1);
    expect(field.form.mock.calls[0][1]).toMatchObject({ from: [40, 50] });
  });

  it("brings Spectra's new content from the prism through the field", async () => {
    const prism = document.createElement("canvas");
    prism.setAttribute("role", "button");
    prism.setAttribute("aria-label", "Spectra is working");
    prism.setAttribute("data-island-prism", "");
    document.body.appendChild(prism);
    render(<Studio />);
    await settle(WARM_UP_MS + 10);
    const item = addCard();
    item.setAttribute("data-ai-region", "true");
    await settle();
    expect(field.travel).toHaveBeenCalledTimes(1);
    expect(field.travel.mock.calls[0][0]).toEqual([RECT.x + RECT.width / 2, RECT.y + RECT.height / 2]);
    // And holds light around the region while Spectra writes it.
    expect(field.glow).toHaveBeenCalledTimes(1);
    // Spectra finishes: the light lets go.
    item.removeAttribute("data-ai-region");
    await settle();
    expect(field.glowStop).toHaveBeenCalled();
  });

  it("keeps a faint tint on what Spectra changed until it has been seen", async () => {
    let seen: IntersectionObserverCallback = () => {};
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          seen = callback;
        }
        observe = observe;
        unobserve() {}
        disconnect() {}
      },
    );
    render(<Studio />);
    await settle(WARM_UP_MS + 10);
    const item = addCard();
    item.setAttribute("data-ai-region", "true");
    await settle();
    expect(item.hasAttribute("data-ai-unseen")).toBe(false);
    item.removeAttribute("data-ai-region");
    await settle();
    expect(item.getAttribute("data-ai-unseen")).toBe("true");
    expect(observe).toHaveBeenCalledWith(item);
    // Not yet in view: it waits.
    await settle(SEEN_MS * 2);
    expect(item.getAttribute("data-ai-unseen")).toBe("true");
    act(() => seen([{ target: item, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    await settle(SEEN_MS + 10);
    expect(item.getAttribute("data-ai-unseen")).toBe("fading");
    await settle(1000);
    expect(item.hasAttribute("data-ai-unseen")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("sweeps a spectral band over what Spectra is writing, and lets it go when done", async () => {
    render(<Studio aiState="updating" />);
    await settle(WARM_UP_MS + 10);
    const field = document.createElement("input");
    list().appendChild(field);
    await settle();
    field.setAttribute("data-ai-region", "true");
    await settle();
    const band = document.querySelector(".spectra-ai-band");
    expect(band?.parentElement?.classList.contains("spectra-ai-band-layer")).toBe(true);
    field.removeAttribute("data-ai-region");
    await settle();
    expect(band?.classList.contains("is-leaving")).toBe(true);
    await settle(1000);
    expect(document.querySelector(".spectra-ai-band")).toBeNull();
  });

  it("keeps the band to a few regions, and only while Spectra is working", async () => {
    const view = render(<Studio aiState="updating" />);
    await settle(WARM_UP_MS + 10);
    for (let index = 0; index < MAX_BANDS + 2; index += 1) addCard().setAttribute("data-ai-region", "true");
    await settle();
    expect(document.querySelectorAll(".spectra-ai-band")).toHaveLength(MAX_BANDS);
    view.rerender(<Studio aiState="edited" />);
    await settle(1000);
    expect(document.querySelectorAll(".spectra-ai-band")).toHaveLength(0);
  });

  it("unforms a deleted card where it was", async () => {
    render(<Studio />);
    const item = addCard();
    await settle(WARM_UP_MS + 300);
    item.remove();
    await settle();
    expect(field.unform).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the field is off", async () => {
    field.on = false;
    render(<Studio />);
    await settle(WARM_UP_MS + 10);
    addCard().remove();
    addCard();
    await settle();
    expect(field.form).not.toHaveBeenCalled();
    expect(field.unform).not.toHaveBeenCalled();
  });

  it("leaves a wake behind a drag and settles where it drops", async () => {
    render(<Studio />);
    const item = addCard();
    await settle(WARM_UP_MS + 10);
    item.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent("pointermove", { buttons: 1, clientX: 60, clientY: 30 }));
    await settle();
    expect(field.wake).toHaveBeenCalledTimes(1);
    // Picked up, it lifts; put down, it settles.
    expect(item.getAttribute("data-lifted")).toBe("true");
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 30 }));
    expect(field.pulse).toHaveBeenCalledWith(60, 30, 0.55);
    expect(item.hasAttribute("data-lifted")).toBe(false);
    expect(item.getAttribute("data-settling")).toBe("true");
    await settle(400);
    expect(item.hasAttribute("data-settling")).toBe(false);
  });
});
