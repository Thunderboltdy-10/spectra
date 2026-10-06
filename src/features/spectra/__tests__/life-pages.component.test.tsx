// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  morph: vi.fn((_from: unknown, _to: unknown) => ({ formed: Promise.resolve() })),
}));

vi.mock("../life/life", () => ({
  life: { on: true, morph: field.morph },
}));

vi.mock("../life/figure-dom", () => ({
  figureOf: (element: Element) => ({ strokes: [], of: element.getAttribute("data-rail-item") ?? element.tagName }),
}));

import { PageHeader } from "@/components/ui/page-header";
import { recentCause } from "../life/use-life";

let item: HTMLAnchorElement;

beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(80_000);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(80_000);
    return 1;
  });
  recentCause();
  item = document.createElement("a");
  item.setAttribute("data-rail-item", "calendar");
  item.setAttribute("data-life-launch", "");
  document.body.append(item);
});

afterEach(() => {
  item.remove();
  vi.restoreAllMocks();
  field.morph.mockClear();
});

describe("going to a page", () => {
  it("the header grows out of the rail item that was pressed", () => {
    fireEvent.pointerDown(item);
    render(<PageHeader title="Calendar" description="This week" />);
    expect(field.morph).toHaveBeenCalledTimes(1);
    expect(field.morph.mock.calls[0][0]).toEqual(expect.objectContaining({ of: "calendar" }));
    expect(field.morph.mock.calls[0][1]).toEqual(expect.objectContaining({ of: "HEADER" }));
  });

  it("without a press, the page is simply there", () => {
    render(<PageHeader title="Calendar" />);
    expect(field.morph).not.toHaveBeenCalled();
  });

  it("a header that stays lands again only under a new key", () => {
    fireEvent.pointerDown(item);
    const view = render(<PageHeader title="Workspace" lifeKey="ws-1" />);
    fireEvent.pointerDown(item);
    view.rerender(<PageHeader title="Workspace" lifeKey="ws-1" />);
    expect(field.morph).toHaveBeenCalledTimes(1);
    view.rerender(<PageHeader title="Workspace" lifeKey="ws-2" />);
    expect(field.morph).toHaveBeenCalledTimes(2);
  });
});
