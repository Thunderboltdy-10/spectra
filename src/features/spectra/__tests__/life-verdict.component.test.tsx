// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  pulse: vi.fn((_x: number, _y: number, _strength?: number, _colour?: unknown) => undefined),
  radiate: vi.fn((_figure: unknown, _options?: unknown) => undefined),
  form: vi.fn((_figure: unknown, _options?: unknown) => ({ formed: Promise.resolve() })),
}));

vi.mock("../life/life", () => ({
  life: { on: true, pulse: field.pulse, radiate: field.radiate, form: field.form },
}));


import { LifeForm, LifeVerdict } from "@/components/ui/life-moments";
import { recentCause, type Verdict } from "../life/use-life";
import { STATUS_COLOURS } from "../life/prism";

function Card({ verdict, immediate }: { verdict: Verdict | null; immediate?: boolean }) {
  return (
    <div>
      <LifeVerdict verdict={verdict} immediate={immediate} />
      Question
    </div>
  );
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100, toJSON: () => ({}) } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  field.pulse.mockClear();
  field.radiate.mockClear();
  field.form.mockClear();
});

describe("verdicts", () => {
  it("a right answer checked on screen pulses green and sends dots off its frame", () => {
    const view = render(<Card verdict={null} />);
    expect(field.pulse).not.toHaveBeenCalled();
    view.rerender(<Card verdict="right" />);
    expect(field.pulse).toHaveBeenCalledTimes(1);
    expect(field.pulse.mock.calls[0][3]).toEqual(STATUS_COLOURS.done);
    expect(field.radiate).toHaveBeenCalledTimes(1);
  });

  it("a wrong answer pulses red, quieter, with nothing sent off", () => {
    const view = render(<Card verdict={null} />);
    view.rerender(<Card verdict="wrong" />);
    expect(field.pulse.mock.calls[0][3]).toEqual(STATUS_COLOURS.problem);
    expect(field.radiate).not.toHaveBeenCalled();
  });

  it("coming back to an answered question is still", () => {
    const view = render(<Card verdict="right" />);
    view.rerender(<Card verdict="right" />);
    expect(field.pulse).not.toHaveBeenCalled();
  });

  it("an answer revealed with its verdict counts at once", () => {
    render(<Card verdict="open" immediate />);
    expect(field.pulse).toHaveBeenCalledTimes(1);
    expect(field.pulse.mock.calls[0][3]).toEqual(STATUS_COLOURS.info);
  });
});

describe("what a press reveals", () => {
  it("lands what the press revealed", () => {
    recentCause();
    fireEvent.pointerDown(document.body, { clientX: 40, clientY: 60 });
    const view = render(<section><LifeForm />Answer</section>);
    expect(field.form).not.toHaveBeenCalled();
    expect(view.container.querySelector("section")?.getAttribute("data-life-working")).toBe("arrival");
  });

  it("reopened later, it is simply there", () => {
    vi.spyOn(performance, "now").mockReturnValue(10_000_000);
    const view = render(<section><LifeForm />Answer</section>);
    expect(view.container.querySelector("section")?.hasAttribute("data-life-working")).toBe(false);
  });
});
