// @vitest-environment jsdom

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SurfaceField,
  fieldStateFor,
  useActivityField,
} from "../field/surface-field";
import {
  fieldForSyncState,
  useSyncCompletionField,
} from "../components/studio-presence-layer";
import { SpectraMark } from "@/components/spectra-mark";
import { PrismLoader } from "@/components/spectra-prism-optic";
import { choosePrismClaim } from "@/app/landing/prism/prism-slot";
import { ArtifactCard } from "../components/artifact-card";
import type { StudioPresentationState } from "../bridge/status";
import type { InteractionState } from "../collaboration/interaction-model";

/**
 * P7.UI1 — the field is driven by real events, by construction:
 *
 * 1. Signal mapping is honest: interaction lifecycles and sync presenter
 *    states map to the field vocabulary exactly, so the surface can never
 *    show "success" for work that failed.
 * 2. Lifecycle hygiene: the activity bridge removes every listener it adds
 *    and never runs a continuous loop — measurement is event-driven.
 * 3. One engine: the lattice, the GPU renderer and the prism family each
 *    have exactly one definition site; duplicates fail the build here, not
 *    in review.
 * 4. DS-4: the brand violet clears WCAG AA against white text, and every
 *    brand-filled control takes its foreground from --text-inverse so both
 *    themes stay legal.
 */

/* ------------------------------------------------------------------ *
 * 1. Signal mapping
 * ------------------------------------------------------------------ */

function interactionState(
  lifecycle: InteractionState["lifecycle"],
  actKind: string,
): InteractionState {
  return {
    v: 2,
    actor: { clientId: "c1", kind: "human", name: "Ada" },
    act: { kind: actKind },
    lifecycle,
    target: null,
    at: Date.now(),
  } as unknown as InteractionState;
}

describe("fieldStateFor", () => {
  it("maps held tension lifecycles to waiting", () => {
    for (const lifecycle of [
      "blocked",
      "queued",
      "waiting",
      "paused",
    ] as const) {
      expect(fieldStateFor(interactionState(lifecycle, "hover"))).toBe(
        "waiting",
      );
    }
  });

  it("maps terminal failures to failure and completion to success", () => {
    expect(fieldStateFor(interactionState("failed", "hover"))).toBe("failure");
    expect(fieldStateFor(interactionState("cancelled", "hover"))).toBe(
      "failure",
    );
    expect(fieldStateFor(interactionState("completed", "hover"))).toBe(
      "success",
    );
  });

  it("maps text acts to typing and drag acts to drag", () => {
    for (const kind of ["type", "insert", "replace"]) {
      expect(fieldStateFor(interactionState("active", kind))).toBe("typing");
    }
    for (const kind of [
      "dragStart",
      "dragMove",
      "dragRelease",
      "resizeStart",
      "resizeMove",
      "resizeRelease",
    ]) {
      expect(fieldStateFor(interactionState("active", kind))).toBe("drag");
    }
  });

  it("falls back to active for everything else", () => {
    expect(fieldStateFor(interactionState("active", "hover"))).toBe("active");
    expect(fieldStateFor(interactionState("settled", "select"))).toBe("active");
  });
});

describe("useSyncCompletionField", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires one transient success wake when a save lands", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: StudioPresentationState }) =>
        useSyncCompletionField(state),
      { initialProps: { state: "saving" as StudioPresentationState } },
    );
    expect(result.current).toEqual([]);
    rerender({ state: "saved" as const });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ state: "success" });
    /* The wake leaves on its own — no influence may linger. */
    act(() => void vi.advanceTimersByTime(1400));
    expect(result.current).toEqual([]);
  });

  it("does not fire for non-working transitions or repeated saved states", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: StudioPresentationState }) =>
        useSyncCompletionField(state),
      { initialProps: { state: "saved" as StudioPresentationState } },
    );
    rerender({ state: "live" as const });
    expect(result.current).toEqual([]);
    rerender({ state: "offline" as const });
    rerender({ state: "saved" as const });
    expect(result.current).toEqual([]);
  });

  it("gives back-to-back saves fresh influence ids so each converges", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: StudioPresentationState }) =>
        useSyncCompletionField(state),
      { initialProps: { state: "saving" as StudioPresentationState } },
    );
    rerender({ state: "saved" as const });
    const first = result.current[0]!.id;
    rerender({ state: "saving" as const });
    rerender({ state: "saved" as const });
    const second = result.current[0]!.id;
    expect(second).not.toBe(first);
  });

  it("never fires on failure — an error is not a completion", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: StudioPresentationState }) =>
        useSyncCompletionField(state),
      { initialProps: { state: "saving" as StudioPresentationState } },
    );
    rerender({ state: "error" as const });
    expect(result.current).toEqual([]);
  });
});

describe("fieldForSyncState", () => {
  it("shows truthful in-flight, offline, and failure states", () => {
    expect(fieldForSyncState("saving")).toMatchObject({ state: "waiting" });
    expect(fieldForSyncState("pending")).toMatchObject({ state: "waiting" });
    expect(fieldForSyncState("offline")).toMatchObject({ state: "waiting" });
    expect(fieldForSyncState("error")).toMatchObject({ state: "failure" });
    expect(fieldForSyncState("saved")).toBeNull();
  });
});

describe("landing prism claims", () => {
  it("prefers an on-screen claim over a higher-priority off-screen scene", () => {
    const visible = { width: 100, height: 100 };
    expect(
      choosePrismClaim(
        [
          {
            id: 1,
            priority: 1,
            rect: {
              left: 20,
              right: 120,
              top: 20,
              bottom: 120,
              width: 100,
              height: 100,
            },
            value: "hero",
          },
          {
            id: 2,
            priority: 99,
            rect: {
              left: 20,
              right: 120,
              top: 2000,
              bottom: 2100,
              width: 100,
              height: 100,
            },
            value: "reveal",
          },
        ],
        visible,
      ),
    ).toBe("hero");
  });
});

describe("open work identity", () => {
  it("renders an open board card in the selected state", () => {
    const { container } = render(
      <ArtifactCard
        active
        artifact={{
          id: "work-a",
          title: "Physics notes",
          blueprintKey: "document",
          summary: "Wave notes",
          meta: "Document",
          placement: "workspace",
        }}
      />,
    );
    expect(
      container.querySelector("[data-card-state='selected']"),
    ).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2. Lifecycle hygiene
 * ------------------------------------------------------------------ */

describe("useActivityField", () => {
  const observed: unknown[] = [];
  let disconnected = 0;

  beforeEach(() => {
    observed.length = 0;
    disconnected = 0;
    class ResizeObserverStub {
      observe(target: unknown) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {
        disconnected += 1;
      }
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("measures event-driven only, with full teardown on unmount", () => {
    /* Note: the "no interval loop" guarantee lives in the static gate below
       (field sources contain no setInterval). A spy here would measure the
       jsdom/framer environment's own 16ms heartbeat, not the product. */
    const surface = document.createElement("div");
    document.body.appendChild(surface);
    const removeListener = vi.spyOn(surface, "removeEventListener");
    const ref = { current: surface };

    const { unmount } = renderHook(() => useActivityField(ref, [], {}));
    expect(observed).toContain(surface);

    unmount();
    expect(disconnected).toBe(1);
    /* The scroll listener must be removed with the same capture flag it was
       added with, or the surface leaks a listener per mount. */
    expect(removeListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      expect.objectContaining({ capture: true }),
    );
    surface.remove();
  });

  it("renders nothing without influences and wakes for real ones", () => {
    const { container, rerender } = render(
      <SurfaceField influences={[]} scale="stage" behind />,
    );
    expect(container.querySelectorAll(".spectra-field-wake")).toHaveLength(0);
    expect(container.querySelector(".spectra-field-rest")).not.toBeNull();

    rerender(
      <SurfaceField
        influences={[{ id: "a", x: 0.5, y: 0.5, strength: 1, state: "typing" }]}
        scale="stage"
        behind
      />,
    );
    const wake = container.querySelector(".spectra-field-wake");
    expect(wake).not.toBeNull();
    expect(wake!.getAttribute("data-state")).toBe("typing");
  });

  it("drops influences below the visibility floor", () => {
    const { container } = render(
      <SurfaceField
        influences={[
          { id: "faint", x: 0.5, y: 0.5, strength: 0.01 },
          { id: "real", x: 0.5, y: 0.5, strength: 0.5 },
        ]}
      />,
    );
    const wakes = container.querySelectorAll(".spectra-field-wake");
    expect(wakes).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 3. One engine
 * ------------------------------------------------------------------ */

const CSS_FILES = [
  "src/styles/spectra-tokens.css",
  "src/styles/spectra-app.css",
  "src/styles/spectra-document.css",
  "src/styles/spectra-sheets.css",
  "src/styles/spectra-presentation.css",
  "src/styles/spectra-landing.css",
  "src/styles/spectra-field.css",
  "src/app/globals.css",
];

describe("one field engine", () => {
  it("the resting lattice and drift keyframes are defined exactly once", () => {
    for (const marker of [
      ".spectra-field-rest {",
      "@keyframes spectra-field-drift {",
      "@keyframes spectra-field-drift-far {",
      ".spectra-field-wake {",
    ]) {
      const sites = CSS_FILES.filter((file) =>
        readFileSync(file, "utf8").includes(marker),
      );
      expect(sites, `${marker} defined in ${sites.join(", ")}`).toEqual([
        "src/styles/spectra-field.css",
      ]);
    }
  });

  it("the GPU renderer has one definition and one consumer", () => {
    const rendererSource = readFileSync(
      "src/features/spectra/field/grain-renderer.ts",
      "utf8",
    );
    expect(rendererSource).toContain("export function createGrainRenderer");
    const fieldDir = readdirSync("src/features/spectra/field");
    expect(fieldDir.sort()).toEqual(["grain-renderer.ts", "surface-field.tsx"]);
    expect(existsSync("src/features/spectra/field/grain-field.tsx")).toBe(
      false,
    );
    const surfaceField = readFileSync(
      "src/features/spectra/field/surface-field.tsx",
      "utf8",
    );
    expect(surfaceField).toContain("export function EnvironmentField");
    expect(surfaceField).toContain('from "./grain-renderer"');
    const landingField = readFileSync(
      "src/app/landing/field/landing-field.tsx",
      "utf8",
    );
    expect(landingField).toContain("<EnvironmentField");
    expect(landingField).not.toContain("GrainField");
  });

  it("no field file owns a continuous JavaScript loop", () => {
    for (const file of [
      "src/features/spectra/field/surface-field.tsx",
      "src/features/spectra/field/grain-renderer.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("setInterval");
      expect(source).not.toMatch(
        /requestAnimationFrame\s*\(\s*function\s+loop/,
      );
    }
  });

  it("the landing prism renders on demand from the shared story clock", () => {
    const source = readFileSync(
      "src/app/landing/prism3d/PrismCanvas.tsx",
      "utf8",
    );
    expect(source).toContain('frameloop="demand"');
    expect(source).toContain("onStoryFrame(() => invalidate())");
    expect(source).not.toContain('frameloop="always"');
  });

  it("the landing prism renders on the shared demand clock and wakes after visibility returns", () => {
    const prismCanvas = readFileSync(
      "src/app/landing/prism3d/PrismCanvas.tsx",
      "utf8",
    );
    expect(prismCanvas).toContain('frameloop="demand"');
    expect(prismCanvas).not.toContain('frameloop="always"');
    expect(prismCanvas).toContain("return onStoryFrame(() => invalidate())");

    const storyCanvas = readFileSync(
      "src/app/landing/story/story-canvas.tsx",
      "utf8",
    );
    expect(storyCanvas).toContain(
      'document.addEventListener("visibilitychange"',
    );
    expect(storyCanvas).toContain("if (!document.hidden) wake()");
    expect(storyCanvas).toContain("window.cancelAnimationFrame(raf)");
  });

  it("static and active prism variants render the same three faces", () => {
    const staticMark = render(<SpectraMark size={24} />).container;
    const activeMark = render(
      <PrismLoader size={24} optics="working" />,
    ).container;
    const points = (root: HTMLElement) =>
      [...root.querySelectorAll("polygon")].map((node) =>
        node.getAttribute("points"),
      );
    expect(points(activeMark)).toEqual(points(staticMark));
    expect(new Set(points(staticMark))).toHaveLength(3);
    expect(activeMark.querySelector(".spectra-prism-body")).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 4. DS-4 — the brand violet clears AA, and brand fills use the inverse token
 * ------------------------------------------------------------------ */

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const linear = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

describe("DS-4 brand violet contrast", () => {
  const appCss = readFileSync("src/styles/spectra-app.css", "utf8");

  it("light brand-primary clears AA 4.5:1 against white text", () => {
    const match = appCss.match(
      /:root\s*\{[^}]*--brand-primary:\s*(#[0-9a-f]{6})/i,
    );
    expect(match, "light --brand-primary declaration").not.toBeNull();
    const ratio = contrast(match![1]!, "#ffffff");
    expect(
      ratio,
      `white on ${match![1]} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("accent-violet and mode-quiz track the brand value (no drift)", () => {
    const root = appCss.slice(
      appCss.indexOf(":root {"),
      appCss.indexOf(".dark {"),
    );
    const brand = root.match(/--brand-primary:\s*(#[0-9a-f]{6})/i)![1];
    for (const token of ["--accent-violet", "--mode-quiz"]) {
      const value = root.match(
        new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"),
      )?.[1];
      expect(value, token).toBe(brand);
    }
  });

  it("brand-filled controls take their foreground from --text-inverse", () => {
    /* The class: white hardcoded on a brand fill fails dark mode (white on
       #9a87ff is 2.9:1). The inverse token is near-white in light and
       near-black in dark, legal in both. */
    const followToggle = appCss.match(
      /\.spectra-follow-toggle\[data-following="true"\]\s*\{[^}]*\}/,
    )![0];
    expect(followToggle).toContain("background: var(--brand-primary)");
    expect(followToggle).toContain("color: var(--text-inverse)");
    expect(followToggle).not.toContain("color: #fff");

    const landingCss = readFileSync("src/styles/spectra-landing.css", "utf8");
    const landingPrimary = landingCss.match(
      /\.landing-btn\[data-tone="primary"\]\s*\{[^}]*\}/,
    )![0];
    expect(landingPrimary).toContain("color: var(--text-inverse)");

    for (const tsx of [
      "src/components/layout/app-shell.tsx",
      "src/features/spectra/components/artifact-studio.tsx",
    ]) {
      const source = readFileSync(tsx, "utf8");
      const brandFills = source.match(
        /bg-\[var\(--brand-primary\)\][^"`]*text-white/g,
      );
      expect(
        brandFills ?? [],
        `${tsx} pairs brand fill with text-white`,
      ).toEqual([]);
    }
  });

  it("the mark family constants track the brand violet", () => {
    for (const file of [
      "src/components/spectra-mark.tsx",
      "src/components/spectra-logo.tsx",
      "public/icon.svg",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} still carries the old violet`).not.toContain(
        "#7b5cf5",
      );
    }
  });
});
