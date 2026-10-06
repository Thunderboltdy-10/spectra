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
    morph: vi.fn((_from: unknown, _to: unknown) => ({ formed: Promise.resolve() })),
  };
});

vi.mock("../life/life", () => ({
  life: { on: true, ghost: field.ghost, unform: field.unform, morph: field.morph },
}));

vi.mock("../life/figure-dom", () => ({
  figureOf: () => ({ strokes: [] }),
}));

import { beginCreation, useLifeLanding } from "../life/use-life";

function Studio({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeLanding(ref, id);
  return <div ref={ref}>{id}</div>;
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
  field.seed.release.mockClear();
});

describe("creating by hand", () => {
  it("gathers dots where it was asked for, and the surface that opens grows out of them", () => {
    const creation = beginCreation([200, 150]);
    expect(field.ghost).toHaveBeenCalledTimes(1);
    expect(field.ghost.mock.calls[0]).toEqual([expect.objectContaining({ strokes: expect.any(Array) }), { from: [200, 150] }]);
    creation.land();
    render(<Studio id="work-1" />);
    expect(field.morph).toHaveBeenCalledTimes(1);
    expect(field.morph.mock.calls[0][0]).toBe(field.seed);
  });

  it("parts where it gathered when nothing was made", () => {
    const creation = beginCreation([200, 150]);
    creation.cancel();
    creation.land();
    expect(field.unform).toHaveBeenCalledWith(field.seed);
    render(<Studio id="work-2" />);
    expect(field.morph).not.toHaveBeenCalled();
  });

  it("goes back to the field when nothing opens from it in time", () => {
    beginCreation([200, 150]).land();
    vi.advanceTimersByTime(2600);
    expect(field.seed.release).toHaveBeenCalled();
    render(<Studio id="work-3" />);
    expect(field.morph).not.toHaveBeenCalled();
  });
});
