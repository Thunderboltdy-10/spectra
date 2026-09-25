// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { createHash, webcrypto } from "node:crypto";
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishedCodeRuntime } from "../components/published-code-runtime";
import type { RuntimeBuild } from "../code/published-runtime-loader";
import { codeRuntimeVersion } from "../code/model";

vi.mock("../components/sandboxed-artifact-runtime", () => ({
  SandboxedArtifactRuntime: ({ title }: { title: string }) => (
    <div data-testid="sandbox">{title}</div>
  ),
}));

function fixture(name = "Vector explorer") {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: "spectra-runtime-build",
      version: 4,
      sdkVersion: "1",
      artifactId: name,
      artifactVersionId: name,
      title: name,
      sourceHash: "source",
      runtime: "browser",
      runtimeVersion: codeRuntimeVersion("browser"),
      entryFileId: "index",
      dependencies: {},
      networkPolicy: { mode: "none" },
      parameters: [],
      assets: [],
      files: [
        {
          id: "index",
          path: "index.html",
          language: "html",
          source: "<main>Vectors</main>",
        },
      ],
      visualisation: { enabled: true },
      accessibility: { title: name },
      createdAt: 1,
    }),
  );
  const build: RuntimeBuild = {
    buildId: name,
    artifactVersionId: name,
    runtime: "browser",
    sdkVersion: "1",
    payloadHash: createHash("sha256").update(bytes).digest("hex"),
    payloadBytes: bytes.byteLength,
  };
  return { bytes, build };
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("published preview host lifecycle", () => {
  it("opens a cookie-authenticated private package, then preserves it across equivalent projections", async () => {
    const { build, bytes } = fixture();
    const fetcher = vi.fn(async (_url: string, options: RequestInit) =>
      options.credentials === "same-origin"
        ? new Response(bytes)
        : new Response("Authentication required", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetcher);
    const host = render(
      <PublishedCodeRuntime
        title="Vectors"
        build={build}
        embedId="private-embed"
        compact
      />,
    );
    expect(await screen.findByTestId("sandbox")).toHaveTextContent(
      "Vector explorer",
    );
    host.rerender(
      <PublishedCodeRuntime
        title="Updated host title"
        build={{ ...build }}
        embedId="private-embed"
        compact={false}
        resources={{ value: 2 }}
      />,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sandbox")).toHaveTextContent("Vector explorer");
  });

  it("shows a denied request and retries successfully", async () => {
    const { build, bytes } = fixture();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    const host = render(
      <PublishedCodeRuntime
        title="Vectors"
        build={build}
        embedId="private-embed"
        compact
      />,
    );
    expect(
      await screen.findByText(
        "You no longer have access to this published preview.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("sandbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("sandbox")).toHaveTextContent(
      "Vector explorer",
    );
    host.unmount();
  });

  it("cancels a manually retried package request on unmount", async () => {
    const { build } = fixture();
    const pending = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 500 }))
      .mockImplementationOnce(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", pending);
    const retryHost = render(
      <PublishedCodeRuntime
        title="Vectors"
        build={build}
        embedId="private-embed"
        compact
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(pending).toHaveBeenCalledTimes(2));
    const signal = pending.mock.calls[1][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    retryHost.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("does not reload a verified package on an equivalent projection update", async () => {
    const { build, bytes } = fixture();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    const host = render(
      <PublishedCodeRuntime
        title="Vectors"
        build={build}
        embedId="private"
        compact
      />,
    );
    await screen.findByTestId("sandbox");
    host.rerender(
      <PublishedCodeRuntime
        title="Vectors"
        build={{ ...build }}
        embedId="private"
        compact={false}
      />,
    );
    expect(screen.getByTestId("sandbox")).toHaveTextContent("Vector explorer");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not let a late response replace the newly selected preview", async () => {
    const first = fixture("First");
    const second = fixture("Second");
    let finishFirst!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(second.bytes));
    vi.stubGlobal("fetch", fetcher);
    const host = render(
      <PublishedCodeRuntime
        title="First"
        build={first.build}
        embedId="first"
        compact
      />,
    );
    const firstSignal = fetcher.mock.calls[0][1].signal as AbortSignal;
    host.rerender(
      <PublishedCodeRuntime
        title="Second"
        build={second.build}
        embedId="second"
        compact
      />,
    );
    expect(firstSignal.aborted).toBe(true);
    expect(await screen.findByTestId("sandbox")).toHaveTextContent("Second");
    await act(async () => {
      finishFirst(new Response(first.bytes));
    });
    expect(screen.getAllByTestId("sandbox")).toHaveLength(1);
    expect(screen.getByTestId("sandbox")).toHaveTextContent("Second");
  });

  it("clears the previous executable preview when a replacement fails integrity", async () => {
    const first = fixture("First");
    const second = fixture("Second");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(first.bytes))
        .mockResolvedValueOnce(new Response(second.bytes)),
    );
    const host = render(
      <PublishedCodeRuntime
        title="First"
        build={first.build}
        embedId="first"
        compact
      />,
    );
    await screen.findByTestId("sandbox");
    host.rerender(
      <PublishedCodeRuntime
        title="Second"
        build={{ ...second.build, payloadHash: "0".repeat(64) }}
        embedId="second"
        compact
      />,
    );
    expect(screen.queryByTestId("sandbox")).toBeNull();
    expect(
      await screen.findByText(
        "The retained runtime package failed its integrity check.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("sandbox")).toBeNull();
  });

  it("cancels Strict Mode's discarded attempt and keeps the live attempt usable", async () => {
    const { build, bytes } = fixture();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    const host = render(
      <StrictMode>
        <PublishedCodeRuntime
          title="Vectors"
          build={build}
          embedId="private"
          compact
        />
      </StrictMode>,
    );
    await screen.findByTestId("sandbox");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(
      true,
    );
    expect((fetcher.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(
      false,
    );
    host.unmount();
  });
});
