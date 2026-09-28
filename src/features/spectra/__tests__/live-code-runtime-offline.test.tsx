// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCodeRuntime } from "../components/live-code-runtime";

vi.mock("../code/runtime-assets-client", () => ({
  loadCodeRuntimeAssets: async () => ({ assets: [], diagnostics: [] }),
}));
vi.mock("../components/sandboxed-artifact-runtime", () => ({ SandboxedArtifactRuntime: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("live code preview offline", () => {
  it("says to check the connection instead of printing the browser's fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(
      <LiveCodeRuntime
        artifactId="work"
        title="Bouncing ball"
        compact={false}
        allowInteraction
        content={{ runtime: "browser", files: [{ path: "index.html", source: "<main></main>" }], visualisation: { enabled: true } }}
      />,
    );
    expect(await screen.findByText("Live preview unavailable")).toBeTruthy();
    const detail = document.body.textContent ?? "";
    expect(detail).toMatch(/Check your connection/);
    expect(detail).not.toMatch(/Failed to fetch/);
  });
});
