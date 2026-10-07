// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimLanding, clearLandings, expectLanding, LANDING_TTL_MS, pendingLanding } from "../anchors/open-anchor";
import { OpenAnchorScope, regionElement, useOpenAnchor, type AnchorResolver } from "../anchors/use-open-anchor";
import type { WorkRegion } from "../anchors/locate";

const scrolled: Element[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  cleanup();
  clearLandings();
  vi.useRealTimers();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  document.querySelectorAll("[data-spectra-anchor-landing]").forEach((mark) => mark.remove());
});

describe("the landing store", () => {
  it("records a landing only with a region, and a claim takes only the landing it saw", () => {
    expectLanding("w1", undefined);
    expect(pendingLanding("w1")).toBeUndefined();
    expectLanding("w1", { id: "s2", label: "Slide 2" });
    const first = pendingLanding("w1")!;
    expect(first.region).toEqual({ id: "s2", label: "Slide 2" });
    expectLanding("w1", { id: "s3" });
    expect(claimLanding("w1", first.seq)).toBe(false);
    const second = pendingLanding("w1")!;
    expect(claimLanding("w1", second.seq)).toBe(true);
    expect(pendingLanding("w1")).toBeUndefined();
  });

  it("forgets a landing nobody claimed", () => {
    expectLanding("w1", "slide-2");
    vi.advanceTimersByTime(LANDING_TTL_MS + 1);
    expect(pendingLanding("w1")).toBeUndefined();
  });
});

function Studio({ workId, resolve, ready = true }: { workId: string; resolve: AnchorResolver; ready?: boolean }) {
  const [active, setActive] = useState("a");
  useOpenAnchor(workId, (region) => resolve(region) && { ...resolve(region)!, select: () => setActive(region.id) }, { ready });
  return (
    <div>
      {["a", "b"].map((id) => (
        <section key={id} data-anchor-region={id === active ? id : undefined}>
          {id}
        </section>
      ))}
    </div>
  );
}

const known: AnchorResolver = (region: WorkRegion) =>
  region.id === "a" || region.id === "b" ? { find: (root) => regionElement(root, region.id) } : null;

describe("landing in a studio", () => {
  it("shows the region, scrolls to it and marks it, once", async () => {
    render(<Studio workId="w1" resolve={known} />);
    act(() => expectLanding("w1", { id: "b" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(scrolled.map((element) => element.textContent)).toEqual(["b"]);
    expect(pendingLanding("w1")).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const mark = document.querySelector("[data-spectra-anchor-landing]");
    expect(mark?.className).toBe("spectra-anchor-landing");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(document.querySelector("[data-spectra-anchor-landing]")).toBeNull();
  });

  it("leaves an unknown region alone: the work stays where it opened and the landing expires", async () => {
    render(<Studio workId="w1" resolve={known} />);
    act(() => expectLanding("w1", { id: "gone" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(scrolled).toEqual([]);
    expect(document.querySelector("[data-spectra-anchor-landing]")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LANDING_TTL_MS);
    });
    expect(pendingLanding("w1")).toBeUndefined();
  });

  it("gives up quietly when the region's element never appears", async () => {
    render(<Studio workId="w1" resolve={() => ({ find: () => null })} />);
    act(() => expectLanding("w1", { id: "a" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(pendingLanding("w1")).toBeUndefined();
    expect(scrolled).toEqual([]);
  });

  it("waits for the studio to be ready, and for its own work only", async () => {
    const { rerender } = render(<Studio workId="w1" resolve={known} ready={false} />);
    act(() => {
      expectLanding("w2", { id: "b" });
      expectLanding("w1", { id: "b" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(scrolled).toEqual([]);
    rerender(<Studio workId="w1" resolve={known} ready />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(scrolled.map((element) => element.textContent)).toEqual(["b"]);
    expect(pendingLanding("w2")?.region.id).toBe("b");
  });

  it("does not land in a copy of the work shown inside another", async () => {
    function Copy() {
      const root = useRef<HTMLDivElement>(null);
      return (
        <div ref={root}>
          <OpenAnchorScope enabled={false} root={root}>
            <Studio workId="w1" resolve={known} />
          </OpenAnchorScope>
        </div>
      );
    }
    render(<Copy />);
    act(() => expectLanding("w1", { id: "b" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(scrolled).toEqual([]);
    expect(pendingLanding("w1")).toBeDefined();
  });

  it("does not scroll a studio that frames the element itself", async () => {
    render(<Studio workId="w1" resolve={(region) => ({ ...known(region)!, scroll: false })} />);
    act(() => expectLanding("w1", { id: "a" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(scrolled).toEqual([]);
    expect(document.querySelector("[data-spectra-anchor-landing]")).not.toBeNull();
  });
});
