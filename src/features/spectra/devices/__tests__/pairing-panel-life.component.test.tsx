// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  glows: [] as boolean[],
  pulses: [] as unknown[],
  entrances: 0,
}));

vi.mock("../../life/use-life", () => ({
  useLifeEntrance: () => {
    h.entrances += 1;
  },
  useLifeDeparture: () => {},
  useLifeGlow: (_ref: unknown, active: boolean) => {
    h.glows.push(active);
  },
}));
vi.mock("../../life/life", () => ({
  life: { pulse: (...args: unknown[]) => h.pulses.push(args[3]) },
}));

import { STATUS_COLOURS } from "../../life/prism";
import { PairingPanel } from "../pairing-panel";

afterEach(() => {
  cleanup();
  h.glows = [];
  h.pulses = [];
  h.entrances = 0;
});

const noop = () => {};

describe("pairing panel life", () => {
  it("forms, and breathes light while it waits for Bridge", () => {
    render(<PairingPanel state={{ phase: "checking" }} onCancel={noop} onRetry={noop} />);
    expect(h.entrances).toBeGreaterThan(0);
    expect(h.glows.at(-1)).toBe(true);
  });

  it("stops waiting at the code, and lands a failure in red", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 100 } as DOMRect);
    const view = render(<PairingPanel state={{ phase: "requesting" }} onCancel={noop} onRetry={noop} />);
    view.rerender(<PairingPanel state={{ phase: "confirming", shortCode: "AB12", expiresAt: 0 }} onCancel={noop} onRetry={noop} />);
    expect(h.glows.at(-1)).toBe(false);
    view.rerender(<PairingPanel state={{ phase: "failed", message: "Expired." }} onCancel={noop} onRetry={noop} />);
    expect(h.pulses).toEqual(["spectrum", STATUS_COLOURS.problem]);
  });

  it("is gone once paired", () => {
    const view = render(<PairingPanel state={{ phase: "paired", at: 1 }} onCancel={noop} onRetry={noop} />);
    expect(view.container.firstChild).toBeNull();
  });
});
