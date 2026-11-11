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

/* What lands is there at once, and the skeleton's band crosses it once (markArrival). */
let marking: ReturnType<typeof vi.spyOn>;
const arrivals = () => (marking.mock.calls as Array<[string, string]>).filter(([name, value]) => name === "data-life-working" && value === "arrival").length;
/** The bands so far have finished: nothing is marked and nothing is counted. */
const settleBands = () => {
  for (const element of document.querySelectorAll("[data-life-working]")) element.removeAttribute("data-life-working");
  marking.mockClear();
};

let frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(performance.now());
};

beforeEach(() => {
  marking = vi.spyOn(Element.prototype, "setAttribute");
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
  it("lets what was already there be content, and lands only what is new", () => {
    const view = render(<List ids={["a1", "a2"]} />);
    expect(arrivals()).toBe(0);
    view.rerender(<List ids={["a1", "a2", "a3"]} kinds={{ a3: "human" }} />);
    expect(arrivals()).toBe(1);
    expect(field.form).not.toHaveBeenCalled();
  });

  it("lands Spectra's artifact where it is, without loose light from the prism", () => {
    render(<List ids={["b1"]} kinds={{ b1: "ai" }} />);
    expect(arrivals()).toBe(1);
    expect(field.travel).not.toHaveBeenCalled();
    expect(field.form).not.toHaveBeenCalled();
  });

  it("lands a key only once per visit", () => {
    const view = render(<List ids={["c1"]} kinds={{ c1: "human" }} />);
    view.rerender(<List ids={[]} />);
    view.rerender(<List ids={["c1"]} kinds={{ c1: "human" }} />);
    expect(arrivals()).toBe(1);
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

function MovingCard({ id, column }: { id: string; column: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeArrival(ref, `card:${id}`, undefined);
  useLifeDeparture(ref, true, {}, `card:${id}`);
  return <div ref={ref} data-column={column}>{id}</div>;
}

function Board({ columns }: { columns: string[][] }) {
  return (
    <div>
      {columns.map((ids, column) => (
        <section key={column}>
          {ids.map((id) => (
            <MovingCard key={id} id={id} column={column} />
          ))}
        </section>
      ))}
    </div>
  );
}

describe("moves", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const x = 10 + Number(this.getAttribute("data-column") ?? 0) * 300;
      return { x, y: 10, left: x, top: 10, right: x + 100, bottom: 50, width: 100, height: 40, toJSON: () => ({}) } as DOMRect;
    });
  });

  it("travels a card that moved to another column instead of parting it", () => {
    const view = render(<Board columns={[["m1", "m2"], []]} />);
    view.rerender(<Board columns={[["m2"], ["m1"]]} />);
    act(flushFrames);
    expect(field.travel).toHaveBeenCalledTimes(1);
    expect(field.unform).not.toHaveBeenCalled();
  });

  it("lets a re-sort of many cards simply land", () => {
    const ids = ["n1", "n2", "n3", "n4", "n5", "n6"];
    const view = render(<Board columns={[ids, []]} />);
    view.rerender(<Board columns={[[], ids]} />);
    act(flushFrames);
    expect(field.travel).toHaveBeenCalledTimes(4);
    expect(field.unform).not.toHaveBeenCalled();
  });
});

function Landing({ id }: { id: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeLanding(ref, id);
  return <div ref={ref}>{id}</div>;
}

describe("landings", () => {
  it("lands what opens from a card, once", () => {
    const card = document.createElement("div");
    card.setAttribute("data-spectra-card", "artifact");
    document.body.append(card);
    card.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    const view = render(<Landing id="work-1" />);
    act(flushFrames);
    expect(arrivals()).toBe(1);

    view.rerender(<Landing id="work-2" />);
    act(flushFrames);
    expect(arrivals()).toBe(1);
    card.remove();
  });

  it("lets a surface opened without a card make its own entrance", () => {
    render(<Landing id="work-3" />);
    act(flushFrames);
    expect(arrivals()).toBe(0);
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
  it("lands a closing artifact back on its card on the page", () => {
    const view = render(<><Surface id="r1" /><Card id="r1" /></>);
    settleBands();
    view.rerender(<><Card id="r1" /></>);
    act(flushFrames);
    act(flushFrames);
    expect(arrivals()).toBe(1);
  });

  it("lands on the card as it appears on the page the user returns to", () => {
    const view = render(<Surface id="r2" />);
    view.rerender(<></>);
    act(flushFrames);
    view.rerender(<Card id="r2" />);
    act(flushFrames);
    expect(arrivals()).toBe(1);
    expect(field.form).not.toHaveBeenCalled();
  });

  it("does not land on an artifact another took the place of", () => {
    const view = render(<><Surface key="r3" id="r3" /><Card id="r3" /></>);
    settleBands();
    view.rerender(<><Surface key="r4" id="r4" /><Card id="r3" /></>);
    act(flushFrames);
    act(flushFrames);
    expect(arrivals()).toBe(0);
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

  it("answers a checklist item ticked in an artifact, and not any checkbox", () => {
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
