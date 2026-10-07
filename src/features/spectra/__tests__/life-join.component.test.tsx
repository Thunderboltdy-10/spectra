// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  form: vi.fn(() => ({ formed: Promise.resolve() })),
  travel: vi.fn(() => ({ formed: Promise.resolve() })),
  unform: vi.fn(() => Promise.resolve()),
}));

vi.mock("../life/life", () => ({
  life: { on: true, form: field.form, travel: field.travel, unform: field.unform },
}));

vi.mock("../life/figure-dom", () => ({
  figureOf: () => ({ strokes: [] }),
}));

import { LifeKey } from "@/components/ui/life-moments";
import { Row } from "@/components/ui/row";
import { markCause, markNavigation } from "../life/use-life";

function List({ ids }: { ids: string[] }) {
  return (
    <section>
      <ul>
        {ids.map((id) => (
          <li key={id}>
            <LifeKey id={`join:${id}`} />
            {id}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Rows({ ids, fresh }: { ids: string[]; fresh?: string }) {
  return (
    <div>
      {ids.map((id) => (
        <Row key={id} lifeKey={`row:${id}`} fresh={id === fresh} title={id} />
      ))}
    </div>
  );
}

function Tabs({ tab }: { tab: "a" | "b" }) {
  return <div>{tab === "a" ? <List ids={["t1", "t2"]} /> : <p>Other tab</p>}</div>;
}

let frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(performance.now());
};
let now = 200_000;

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40, toJSON: () => ({}) } as DOMRect);
  now += 100_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  markNavigation();
  now += 10_000;
});

afterEach(() => {
  act(flushFrames);
  vi.restoreAllMocks();
  field.form.mockClear();
  field.travel.mockClear();
  field.unform.mockClear();
  document.querySelector("[data-island-prism]")?.remove();
});

describe("an item joining a list", () => {
  it("lets what the list opened with be content", () => {
    markCause([5, 5]);
    render(<List ids={["a1", "a2", "a3"]} />);
    act(flushFrames);
    expect(field.form).not.toHaveBeenCalled();
  });

  it("forms the first thing made in a list that was empty", () => {
    const view = render(<List ids={[]} />);
    act(flushFrames);
    markCause([40, 50]);
    view.rerender(<List ids={["a4"]} />);
    act(flushFrames);
    expect(field.form).toHaveBeenCalledTimes(1);
  });

  it("is still while the page itself is arriving", () => {
    markNavigation();
    markCause([40, 50]);
    render(<List ids={["a5"]} />);
    act(flushFrames);
    expect(field.form).not.toHaveBeenCalled();
  });

  it("forms one made just now from the reader's press", () => {
    const view = render(<List ids={["b1"]} />);
    act(flushFrames);
    markCause([40, 50]);
    view.rerender(<List ids={["b1", "b2"]} />);
    act(flushFrames);
    expect(field.form).toHaveBeenCalledTimes(1);
    expect(field.form.mock.calls[0]).toContainEqual({ from: [40, 50] });
  });

  it("brings one Spectra made while working from the prism", () => {
    const prism = document.createElement("canvas");
    prism.setAttribute("data-island-prism", "");
    prism.setAttribute("data-status", "working");
    document.body.appendChild(prism);
    const view = render(<List ids={["c1"]} />);
    act(flushFrames);
    now += 5_000;
    view.rerender(<List ids={["c1", "c2"]} />);
    act(flushFrames);
    expect(field.travel).toHaveBeenCalledTimes(1);
    expect(field.form).not.toHaveBeenCalled();
  });

  it("is still when nobody made it here (someone else, a sync)", () => {
    const view = render(<List ids={["d1"]} />);
    act(flushFrames);
    now += 5_000;
    view.rerender(<List ids={["d1", "d2"]} />);
    act(flushFrames);
    expect(field.form).not.toHaveBeenCalled();
    expect(field.travel).not.toHaveBeenCalled();
  });

  it("treats many joining at once as the list filling in", () => {
    const view = render(<List ids={[]} />);
    act(flushFrames);
    markCause([40, 50]);
    view.rerender(<List ids={["e1", "e2", "e3", "e4"]} />);
    act(flushFrames);
    expect(field.form).not.toHaveBeenCalled();
  });
});

describe("a keyed row joining its list", () => {
  it("forms from the reader's press like any other item", () => {
    const view = render(<Rows ids={["g1"]} />);
    act(flushFrames);
    markCause([40, 50]);
    view.rerender(<Rows ids={["g1", "g2"]} />);
    act(flushFrames);
    expect(field.form).toHaveBeenCalledTimes(1);
  });

  it("forms once when its own arrival already brought it", () => {
    const view = render(<Rows ids={["h1"]} />);
    act(flushFrames);
    markCause([40, 50]);
    view.rerender(<Rows ids={["h1", "h2"]} fresh="h2" />);
    act(flushFrames);
    expect(field.form).toHaveBeenCalledTimes(1);
  });
});

describe("an item leaving a list", () => {
  it("parts when it was removed", () => {
    const view = render(<List ids={["f1", "f2"]} />);
    act(flushFrames);
    view.rerender(<List ids={["f1"]} />);
    act(flushFrames);
    expect(field.unform).toHaveBeenCalledTimes(1);
  });

  it("stays still when its whole list went (another tab)", () => {
    const view = render(<Tabs tab="a" />);
    act(flushFrames);
    view.rerender(<Tabs tab="b" />);
    act(flushFrames);
    expect(field.unform).not.toHaveBeenCalled();
  });
});
