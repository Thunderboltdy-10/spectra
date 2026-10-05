// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  form: vi.fn(() => ({ formed: Promise.resolve() })),
  travel: vi.fn(() => ({ formed: Promise.resolve() })),
  unform: vi.fn(() => Promise.resolve()),
  morph: vi.fn(() => ({ formed: Promise.resolve() })),
  pulse: vi.fn(),
  send: vi.fn(() => Promise.resolve()),
}));

vi.mock("../life/life", () => ({
  life: {
    on: true,
    form: field.form,
    travel: field.travel,
    unform: field.unform,
    morph: field.morph,
    pulse: field.pulse,
    send: field.send,
  },
}));

vi.mock("../life/figure-dom", () => ({
  figureOf: () => ({ strokes: [] }),
}));

import { markNavigation, sendInto, useLifeArrival, useLifeDeparture, useLifeLanding, useLifeReturn } from "../life/use-life";

function Item({ id, kind }: { id: string; kind?: "ai" | "human" }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeArrival(ref, `test:${id}`, kind);
  useLifeDeparture(ref);
  return <div ref={ref}>{id}</div>;
}

function List({ ids, kinds = {} }: { ids: string[]; kinds?: Record<string, "ai" | "human"> }) {
  return (
    <div>
      {ids.map((id) => (
        <Item key={id} id={id} kind={kinds[id]} />
      ))}
    </div>
  );
}

let frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(performance.now());
};

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40, toJSON: () => ({}) } as DOMRect);
  // The page has long settled.
  vi.spyOn(performance, "now").mockReturnValue(100_000);
  markNavigation();
  vi.spyOn(performance, "now").mockReturnValue(200_000);
});

afterEach(() => {
  // Let any departure still queued finish, so each test starts with a clear field.
  flushFrames();
  vi.restoreAllMocks();
  field.form.mockClear();
  field.travel.mockClear();
  field.unform.mockClear();
  field.morph.mockClear();
  field.send.mockClear();
  field.pulse.mockClear();
});

describe("arrivals", () => {
  it("lets what was already there be content, and forms only what is new", () => {
    const view = render(<List ids={["a1", "a2"]} />);
    expect(field.form).not.toHaveBeenCalled();
    view.rerender(<List ids={["a1", "a2", "a3"]} kinds={{ a3: "human" }} />);
    expect(field.form).toHaveBeenCalledTimes(1);
  });

  it("brings Spectra's work from the prism through the field", () => {
    render(<List ids={["b1"]} kinds={{ b1: "ai" }} />);
    expect(field.travel).toHaveBeenCalledTimes(1);
    expect(field.form).not.toHaveBeenCalled();
  });

  it("forms a key only once per visit", () => {
    const view = render(<List ids={["c1"]} kinds={{ c1: "human" }} />);
    view.rerender(<List ids={[]} />);
    view.rerender(<List ids={["c1"]} kinds={{ c1: "human" }} />);
    expect(field.form).toHaveBeenCalledTimes(1);
  });
});

describe("departures", () => {
  it("parts what the user removed, where it was", () => {
    const view = render(<List ids={["d1", "d2", "d3"]} />);
    view.rerender(<List ids={["d1", "d3"]} />);
    act(flushFrames);
    expect(field.unform).toHaveBeenCalledTimes(1);
  });

  it("treats many leaving at once as a new view, not removals", () => {
    const ids = ["e1", "e2", "e3", "e4", "e5", "e6"];
    const view = render(<List ids={ids} />);
    view.rerender(<List ids={[]} />);
    act(flushFrames);
    expect(field.unform).not.toHaveBeenCalled();
  });

  it("stays still when the page itself changed", () => {
    const view = render(<List ids={["f1", "f2"]} />);
    view.rerender(<List ids={["f1"]} />);
    markNavigation();
    act(flushFrames);
    expect(field.unform).not.toHaveBeenCalled();
  });
});

function Landing({ id }: { id: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeLanding(ref, id);
  return <div ref={ref}>{id}</div>;
}

describe("landings", () => {
  it("grows what opens out of the card it was opened from, once", () => {
    const card = document.createElement("div");
    card.setAttribute("data-spectra-card", "artifact");
    document.body.append(card);
    card.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    const view = render(<Landing id="work-1" />);
    act(flushFrames);
    expect(field.morph).toHaveBeenCalledTimes(1);

    view.rerender(<Landing id="work-2" />);
    act(flushFrames);
    expect(field.morph).toHaveBeenCalledTimes(1);
    card.remove();
  });

  it("lets a surface opened without a card make its own entrance", () => {
    render(<Landing id="work-3" />);
    act(flushFrames);
    expect(field.morph).not.toHaveBeenCalled();
  });
});

function Surface({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeReturn(ref, `work:${id}`, ".test-surface");
  return <div ref={ref} className="test-surface">{id}</div>;
}

function Card({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeArrival(ref, `work:${id}`, "human");
  return <div ref={ref} data-life-key={`work:${id}`}>{id}</div>;
}

describe("returns", () => {
  it("folds a closing work back into its card on the page", () => {
    const view = render(<><Surface id="r1" /><Card id="r1" /></>);
    view.rerender(<><Card id="r1" /></>);
    act(flushFrames);
    act(flushFrames);
    expect(field.morph).toHaveBeenCalledTimes(1);
  });

  it("folds into the card as it appears on the page the user returns to", () => {
    const view = render(<Surface id="r2" />);
    view.rerender(<></>);
    act(flushFrames);
    view.rerender(<Card id="r2" />);
    act(flushFrames);
    expect(field.morph).toHaveBeenCalledTimes(1);
    expect(field.form).not.toHaveBeenCalled();
  });

  it("does not fold a work another took the place of", () => {
    const view = render(<><Surface key="r3" id="r3" /><Card id="r3" /></>);
    view.rerender(<><Surface key="r4" id="r4" /><Card id="r3" /></>);
    act(flushFrames);
    act(flushFrames);
    expect(field.morph).not.toHaveBeenCalled();
  });
});

describe("sends", () => {
  const drop = (target: Element, taken: boolean) => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: 60, clientY: 30 });
    if (taken) event.preventDefault();
    target.dispatchEvent(event);
  };

  it("carries light from what was dragged into what took it", () => {
    const row = document.createElement("div");
    row.setAttribute("draggable", "true");
    const folder = document.createElement("div");
    folder.setAttribute("data-life-receive", "");
    document.body.append(row, folder);
    row.dispatchEvent(new Event("dragstart", { bubbles: true }));
    drop(folder, true);
    expect(field.send).toHaveBeenCalledTimes(1);
    expect(field.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 100 }), expect.objectContaining({ absorb: true }));
    row.remove();
    folder.remove();
  });

  it("stays still when nothing took the drop", () => {
    const row = document.createElement("div");
    row.setAttribute("draggable", "true");
    document.body.append(row);
    row.dispatchEvent(new Event("dragstart", { bubbles: true }));
    drop(document.body, false);
    expect(field.send).not.toHaveBeenCalled();
    row.remove();
  });

  it("leaves a quiet hole where a picked item came from until it lands", () => {
    const row = document.createElement("div");
    row.setAttribute("draggable", "true");
    document.body.append(row);
    row.dispatchEvent(new Event("dragstart", { bubbles: true }));
    act(flushFrames);
    expect(row.hasAttribute("data-life-picked")).toBe(true);
    row.dispatchEvent(new Event("dragend", { bubbles: true }));
    expect(row.hasAttribute("data-life-picked")).toBe(false);
    row.remove();
  });

  it("only pulses a target when there is nowhere the move came from", () => {
    const list = document.createElement("div");
    document.body.append(list);
    sendInto(list, null);
    expect(field.send).not.toHaveBeenCalled();
    expect(field.pulse).toHaveBeenCalledWith(60, 30, 0.7);
    list.remove();
  });
});

describe("ticking something off", () => {
  it("pulses in the done colour where a task was done, and not when it is undone", () => {
    const done = document.createElement("button");
    done.setAttribute("data-life-done", "");
    done.setAttribute("aria-pressed", "false");
    document.body.append(done);
    done.click();
    expect(field.pulse).toHaveBeenCalledTimes(1);
    expect(field.pulse.mock.calls[0]).toEqual([60, 30, 0.8, expect.anything()]);
    done.setAttribute("aria-pressed", "true");
    done.click();
    expect(field.pulse).toHaveBeenCalledTimes(1);
    done.remove();
  });

  it("answers a checklist item ticked in a work, and not any checkbox", () => {
    const item = document.createElement("li");
    item.setAttribute("data-type", "taskItem");
    const box = document.createElement("input");
    box.type = "checkbox";
    item.append(box);
    const setting = document.createElement("input");
    setting.type = "checkbox";
    document.body.append(item, setting);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    setting.checked = true;
    setting.dispatchEvent(new Event("change", { bubbles: true }));
    expect(field.pulse).toHaveBeenCalledTimes(1);
    item.remove();
    setting.remove();
  });
});
