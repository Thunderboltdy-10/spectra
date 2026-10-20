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
/* The header is there at once; the skeleton's band crosses it as it lands (markArrival). */
let marking: ReturnType<typeof vi.spyOn>;
const landings = () => (marking.mock.calls as Array<[string, string]>).filter(([name, value]) => name === "data-life-working" && value === "arrival").length;
const settleBands = () => {
  for (const element of document.querySelectorAll("[data-life-working]")) element.removeAttribute("data-life-working");
};

beforeEach(() => {
  marking = vi.spyOn(Element.prototype, "setAttribute");
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
  it("the header lands when the rail item was pressed", () => {
    fireEvent.pointerDown(item);
    const view = render(<PageHeader title="Calendar" description="This week" />);
    expect(field.morph).not.toHaveBeenCalled();
    expect(view.container.querySelector("header")?.getAttribute("data-life-working")).toBe("arrival");
  });

  it("without a press, the page is simply there", () => {
    render(<PageHeader title="Calendar" />);
    expect(landings()).toBe(0);
  });

  it("a header that stays lands again only under a new key", () => {
    fireEvent.pointerDown(item);
    const view = render(<PageHeader title="Workspace" lifeKey="ws-1" />);
    fireEvent.pointerDown(item);
    settleBands();
    view.rerender(<PageHeader title="Workspace" lifeKey="ws-1" />);
    expect(landings()).toBe(1);
    view.rerender(<PageHeader title="Workspace" lifeKey="ws-2" />);
    expect(landings()).toBe(2);
  });
});
