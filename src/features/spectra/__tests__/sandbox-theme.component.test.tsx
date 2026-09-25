// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { SandboxedArtifactRuntime } from "../components/sandboxed-artifact-runtime";
import { SPECTRA_EMBED_SDK_VERSION } from "../embed/sandbox-protocol";

const files = [
  { path: "index.html", source: "<main><button>Explore</button></main>" },
];

function ready() {
  const frame = screen.getByTitle(
    "Vectors interactive preview",
  ) as HTMLIFrameElement;
  const channel = JSON.parse(
    frame.srcdoc.match(/const channel = ("[^"]+");/)![1],
  ) as string;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          type: "spectra:ready",
          channel,
          sdkVersion: SPECTRA_EMBED_SDK_VERSION,
        },
      }),
    ),
  );
  return { frame, post };
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-spectra-motion");
  for (const key of ["--bg-primary", "--text-primary", "--private-value"])
    document.documentElement.style.removeProperty(key);
  vi.restoreAllMocks();
});

describe("sandbox host theme and presentation updates", () => {
  it.each([
    { compact: true, toolbar: true, viewportHeight: undefined, expected: 220 },
    { compact: false, toolbar: true, viewportHeight: undefined, expected: 420 },
    { compact: true, toolbar: false, viewportHeight: 560, expected: 560 },
  ])(
    "reserves $expected px before hydrating a frame with actual host tokens",
    (props) => {
      document.documentElement.classList.add("dark");
      const ui = (
        <SandboxedArtifactRuntime
          title="Vectors"
          files={files}
          compact={props.compact}
          toolbar={props.toolbar}
          viewportHeight={props.viewportHeight}
        />
      );
      const server = renderToString(ui);
      expect(server).not.toContain("<iframe");
      const container = document.createElement("div");
      container.innerHTML = server;
      document.body.append(container);
      const placeholder = container.querySelector<HTMLDivElement>(
        'section > div[aria-hidden="true"]',
      );
      expect(placeholder?.style.height).toBe(`${props.expected}px`);
      const recoverableError = vi.fn();
      render(ui, {
        container,
        hydrate: true,
        onRecoverableError: recoverableError,
      });
      const frame = container.querySelector("iframe")!;
      expect(container.querySelectorAll("iframe")).toHaveLength(1);
      expect(container.contains(placeholder)).toBe(false);
      expect(frame.style.height).toBe(`${props.expected}px`);
      expect(frame.srcdoc).toContain('"theme":"dark"');
      expect(recoverableError).not.toHaveBeenCalled();
    },
  );
  it("updates an existing preview from actual theme tokens without restarting the frame", async () => {
    document.documentElement.style.setProperty("--bg-primary", "#fbfaf8");
    document.documentElement.style.setProperty("--text-primary", "#211f1c");
    document.documentElement.style.setProperty(
      "--private-value",
      "must-not-cross-frame",
    );
    render(<SandboxedArtifactRuntime title="Vectors" files={files} compact />);
    const { frame, post } = ready();
    const srcdoc = frame.srcdoc;
    await act(async () => {
      document.documentElement.classList.add("dark");
      document.documentElement.style.setProperty("--bg-primary", "#121211");
      document.documentElement.style.setProperty("--text-primary", "#eeebe7");
    });
    await waitFor(() =>
      expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
        theme: "dark",
        themeTokens: { "--bg-primary": "#121211", "--text-primary": "#eeebe7" },
      }),
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain(
      "must-not-cross-frame",
    );
    expect(screen.getByTitle("Vectors interactive preview")).toBe(frame);
    expect(frame.srcdoc).toBe(srcdoc);
    expect(frame.closest("section")?.getAttribute("data-runtime-status")).toBe(
      "ready",
    );
  });

  it("keeps a ready preview ready when expanding or resizing its host", () => {
    const host = render(
      <SandboxedArtifactRuntime title="Vectors" files={files} compact />,
    );
    const { frame } = ready();
    const srcdoc = frame.srcdoc;
    host.rerender(
      <SandboxedArtifactRuntime
        title="Vectors"
        files={files}
        compact={false}
        viewportHeight={560}
      />,
    );
    expect(frame.closest("section")?.getAttribute("data-runtime-status")).toBe(
      "ready",
    );
    expect(frame.style.height).toBe("560px");
    expect(frame.srcdoc).toBe(srcdoc);
  });

  it("applies the app's reduced-motion setting and stops observing after unmount", async () => {
    const host = render(
      <SandboxedArtifactRuntime title="Vectors" files={files} compact />,
    );
    const { post } = ready();
    await act(async () => {
      document.documentElement.dataset.spectraMotion = "none";
    });
    await waitFor(() =>
      expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
        reducedMotion: true,
      }),
    );
    host.unmount();
    const calls = post.mock.calls.length;
    await act(async () => {
      document.documentElement.classList.add("dark");
    });
    expect(post.mock.calls).toHaveLength(calls);
  });
});
