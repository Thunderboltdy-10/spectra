// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => {
  const seed = { id: 7, formed: Promise.resolve(), release: vi.fn() };
  return {
    seed,
    ghost: vi.fn((_figure: unknown, _options: unknown) => seed),
    unform: vi.fn(() => Promise.resolve()),
    form: vi.fn((_figure: unknown, _options: unknown) => ({ formed: Promise.resolve() })),
    morph: vi.fn((_from: unknown, _to: unknown) => ({ formed: Promise.resolve() })),
  };
});

vi.mock("../life/life", () => ({
  life: { on: true, ghost: field.ghost, unform: field.unform, morph: field.morph, form: field.form },
}));

vi.mock("../life/figure-dom", () => ({
  figureOf: () => ({ strokes: [] }),
}));

import { beginCreation, useLifeArrival, useLifeLanding } from "../life/use-life";

function Studio({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeLanding(ref, id);
  return <div ref={ref}>{id}</div>;
}

function Row({ id }: { id: string }) {
  const ref = useRef<HTMLLIElement>(null);
  useLifeArrival(ref, id, "human");
  return <li ref={ref}>{id}</li>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockReturnValue(50_000);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(50_000);
    return 1;
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  field.ghost.mockClear();
  field.unform.mockClear();
  field.morph.mockClear();
  field.form.mockClear();
  field.seed.release.mockClear();
});

describe("creating by hand", () => {
  it("gathers a skeleton where it was asked for, and the surface that opens lands as it fades", () => {
    const creation = beginCreation({ from: [200, 150] });
    expect(field.ghost).toHaveBeenCalledTimes(1);
    expect(field.ghost.mock.calls[0]).toEqual([expect.objectContaining({ strokes: expect.any(Array) }), { from: [200, 150] }]);
    creation.land();
    const view = render(<Studio id="work-1" />);
    // The surface is there at once; the skeleton gives way and the band crosses what opened.
    expect(field.morph).not.toHaveBeenCalled();
    expect(field.seed.release).toHaveBeenCalledTimes(1);
    expect(view.getByText("work-1").getAttribute("data-life-working")).toBe("arrival");
  });

  it("parts where it gathered when nothing was made", () => {
    const creation = beginCreation({ from: [200, 150] });
    creation.cancel();
    creation.land();
    expect(field.unform).toHaveBeenCalledWith(field.seed);
    render(<Studio id="work-2" />);
    expect(field.morph).not.toHaveBeenCalled();
  });

  it("an item made by hand grows out of its dots where it arrives, not a surface", () => {
    beginCreation({ from: [200, 150], into: "item" }).land();
    render(<Studio id="work-4" />);
    expect(field.morph).not.toHaveBeenCalled();
    render(<Row id="event-1" />);
    expect(field.morph).toHaveBeenCalledTimes(1);
    expect(field.morph.mock.calls[0][0]).toBe(field.seed);
    // Only once: the next arrival is simply there, crossed by the band.
    const next = render(<Row id="event-2" />);
    expect(field.morph).toHaveBeenCalledTimes(1);
    expect(field.form).not.toHaveBeenCalled();
    expect(next.getByText("event-2").getAttribute("data-life-working")).toBe("arrival");
  });

  it("an item landed under a key grows only into that item, whatever its arrival", () => {
    beginCreation({ from: [200, 150], into: "item" }).land("node:n1");
    const Plain = ({ id }: { id: string }) => {
      const ref = useRef<HTMLDivElement>(null);
      useLifeArrival(ref, id, undefined);
      return <div ref={ref}>{id}</div>;
    };
    render(<Row id="node:other" />);
    expect(field.morph).not.toHaveBeenCalled();
    render(<Plain id="node:n1" />);
    expect(field.morph).toHaveBeenCalledTimes(1);
    expect(field.morph.mock.calls[0][0]).toBe(field.seed);
  });

  it("goes back to the field when nothing opens from it in time", () => {
    beginCreation({ from: [200, 150] }).land();
    vi.advanceTimersByTime(2600);
    expect(field.seed.release).toHaveBeenCalled();
    render(<Studio id="work-3" />);
    expect(field.morph).not.toHaveBeenCalled();
  });
});
