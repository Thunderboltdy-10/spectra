// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { MotionConfigContext } from "framer-motion";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpectraMotionConfig } from "../motion/motion-primitives";

function Probe() {
  const config = useContext(MotionConfigContext);
  return (
    <output>
      {`${config.reducedMotion}:${String(Boolean(config.skipAnimations))}`}
    </output>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.spectraMotion;
  vi.unstubAllGlobals();
});

describe("SpectraMotionConfig", () => {
  it("hands the Spectra motion preference to every framer tree", async () => {
    render(
      <SpectraMotionConfig>
        <Probe />
      </SpectraMotionConfig>,
    );
    // Before: framer ran at full travel whatever the preference said.
    expect(screen.getByRole("status").textContent).toBe("never:false");

    await act(async () => {
      document.documentElement.dataset.spectraMotion = "reduced";
      await Promise.resolve();
    });
    expect(screen.getByRole("status").textContent).toBe("always:false");

    await act(async () => {
      document.documentElement.dataset.spectraMotion = "none";
      await Promise.resolve();
    });
    expect(screen.getByRole("status").textContent).toBe("always:true");
  });
});
