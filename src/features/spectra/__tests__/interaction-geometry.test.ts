/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hitTest,
  offSurfaceEdge,
  resolvePlacement,
  resolveSurfaceFrame,
  resolveTargetElement,
  toSurfaceBox,
} from "../collaboration/interaction-geometry";
import { buildTarget } from "../collaboration/control-descriptors";

/**
 * jsdom has no layout, so every element in these fixtures declares its box with
 * `data-rect="left,top,width,height"` and we stub the measurement API. This
 * keeps the tests about *which* element and *which* coordinate space the
 * geometry layer chooses, which is where the real defects have lived.
 */
function stubLayout() {
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const raw = this.getAttribute("data-rect");
    const [left, top, width, height] = raw
      ? raw.split(",").map((part) => Number(part))
      : [0, 0, 0, 0];
    return {
      left: left!,
      top: top!,
      width: width!,
      height: height!,
      right: left! + width!,
      bottom: top! + height!,
      x: left!,
      y: top!,
      toJSON: () => ({}),
    } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.getBoundingClientRect().width;
    },
  });
}

const originalRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  document.body.innerHTML = "";
});

function surface(html: string) {
  document.body.innerHTML = `
    <div data-spectra-surface="artifact" data-rect="100,50,600,400">
      <span data-origin data-rect="100,50,0,0"></span>
      ${html}
    </div>
  `;
  const element = document.querySelector<HTMLElement>(
    "[data-spectra-surface]",
  )!;
  const origin = document.querySelector<HTMLElement>("[data-origin]");
  return resolveSurfaceFrame(element, origin);
}

const target = (path: string, extras?: { part?: string }) =>
  buildTarget({
    typeKey: "presentation",
    artifactId: "artifact-1",
    path,
    ...extras,
  });

describe("resolveTargetElement", () => {
  it("picks the annotated control, not a neighbour with a similar path", () => {
    const frame = surface(`
      <div data-spectra-target="/slides/0/objects/1" data-rect="120,80,200,60" id="wrong"></div>
      <div data-spectra-target="/slides/0/objects/11" data-rect="120,160,200,60" id="right"></div>
    `);
    const resolved = resolveTargetElement(
      frame.element,
      target("/slides/0/objects/11"),
    );
    expect(resolved?.element.id).toBe("right");
    expect(resolved?.precision).toBe("exact");
  });

  it("falls back to the nearest annotated ancestor and says so", () => {
    const frame = surface(`
      <div data-spectra-target="/slides/2" data-rect="120,80,320,200">
        <div data-rect="130,90,200,40">no annotation on the field</div>
      </div>
    `);
    const resolved = resolveTargetElement(
      frame.element,
      target("/slides/2/objects/0/text"),
    );
    // Container precision is the signal that a caret must not be drawn here.
    expect(resolved?.precision).toBe("container");
  });

  it("treats a collapsed or unmounted control as absent", () => {
    const frame = surface(`
      <div data-spectra-target="/slides/9/objects/0" data-rect="0,0,0,0"></div>
    `);
    expect(
      resolveTargetElement(frame.element, target("/slides/9/objects/0")),
    ).toBeNull();
  });

  it("resolves a sub-part such as a resize handle", () => {
    const frame = surface(`
      <div data-spectra-target="/slides/0/objects/0" data-rect="120,80,200,60">
        <button data-spectra-part="handle:se" data-rect="310,130,10,10"></button>
      </div>
    `);
    const resolved = resolveTargetElement(
      frame.element,
      target("/slides/0/objects/0", { part: "handle:se" }),
    );
    expect(resolved?.part).toBeTruthy();
  });
});

describe("surface coordinate space", () => {
  it("measures boxes against the overlay origin, not the viewport", () => {
    const frame = surface(`
      <div data-spectra-target="/slides/0/objects/0" data-rect="180,130,200,60"></div>
    `);
    const box = toSurfaceBox(
      frame,
      document
        .querySelector<HTMLElement>('[data-spectra-target="/slides/0/objects/0"]')!
        .getBoundingClientRect(),
    );
    // Origin sits at (100,50), so the control is 80 across and 80 down from it.
    expect(box).toEqual({ left: 80, top: 80, width: 200, height: 60 });
  });

  it("reports the edge a scrolled-away target left through", () => {
    const frame = surface("");
    expect(offSurfaceEdge(frame, { left: 10, top: -220, width: 80, height: 20 })).toBe(
      "top",
    );
    expect(offSurfaceEdge(frame, { left: 10, top: 900, width: 80, height: 20 })).toBe(
      "bottom",
    );
    expect(
      offSurfaceEdge(frame, { left: 10, top: 40, width: 80, height: 20 }),
    ).toBeUndefined();
  });
});

describe("resolvePlacement", () => {
  it("anchors the cursor on the control that is actually being operated", () => {
    const frame = surface(`
      <div data-spectra-target="/slides/0/objects/0" data-rect="180,130,200,60"></div>
    `);
    const placement = resolvePlacement(frame, {
      target: target("/slides/0/objects/0"),
    });
    expect(placement?.box.left).toBe(80);
    // With no character position available the cursor sits just inside the
    // control's leading edge rather than claiming an offset it cannot know.
    expect(placement?.point.left).toBe(90);
  });

  it("returns null rather than guessing when the control is gone", () => {
    const frame = surface("");
    expect(
      resolvePlacement(frame, { target: target("/slides/4/objects/2") }),
    ).toBeNull();
  });

  it("places the cursor inside the control for pointer fractions", () => {
    const frame = surface(`
      <div data-spectra-target="/slides/0/objects/0" data-rect="180,130,200,60"></div>
    `);
    const placement = resolvePlacement(frame, {
      target: target("/slides/0/objects/0"),
      fraction: { x: 0.5, y: 0.5 },
    });
    expect(placement?.point.left).toBeCloseTo(180, 0);
    expect(placement?.point.top).toBeCloseTo(110, 0);
  });
});

describe("hitTest", () => {
  it("maps a pointer position back to the semantic path it is over", () => {
    const frame = surface(`
      <div data-spectra-target="/slides/0/objects/3" data-rect="180,130,200,60" id="hit"></div>
    `);
    const element = document.getElementById("hit")!;
    document.elementFromPoint = () => element;
    const result = hitTest(frame.element, 280, 160);
    expect(result?.path).toBe("/slides/0/objects/3");
    expect(result?.fraction.x).toBeCloseTo(0.5, 1);
  });

  it("returns null over unannotated chrome so no false target is published", () => {
    const frame = surface(`<div data-rect="180,130,200,60" id="chrome"></div>`);
    document.elementFromPoint = () => document.getElementById("chrome");
    expect(hitTest(frame.element, 200, 140)).toBeNull();
  });
});
