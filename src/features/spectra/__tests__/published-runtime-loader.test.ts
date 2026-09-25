import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeRuntimeVersion } from "../code/model";
import type { PublishedCodeBuildPayload } from "../code/published-build";
import {
  loadPublishedRuntimeBuild,
  PUBLISHED_RUNTIME_LOAD_TIMEOUT_MS,
  type RuntimeBuild,
} from "../code/published-runtime-loader";
import {
  MAX_EMBED_RUNTIME_BYTES,
  readBoundedRuntimeResponse,
} from "../code/runtime-response";

function fixture() {
  const payload: PublishedCodeBuildPayload = {
    format: "spectra-runtime-build",
    version: 4,
    sdkVersion: "1",
    artifactId: "visualisation",
    artifactVersionId: "version-1",
    title: "Vector explorer",
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
    createdAt: 1,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const build: RuntimeBuild = {
    buildId: "build-1",
    artifactVersionId: payload.artifactVersionId,
    runtime: payload.runtime,
    sdkVersion: payload.sdkVersion,
    payloadHash: createHash("sha256").update(bytes).digest("hex"),
    payloadBytes: bytes.byteLength,
    storageUrl: "https://storage.example/public-build",
  };
  return { payload, bytes, build };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("published runtime package loading", () => {
  it("uses the authenticated same-origin endpoint for private placements", async () => {
    const { payload, bytes, build } = fixture();
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      loadPublishedRuntimeBuild(
        build,
        new AbortController().signal,
        "embed /1",
      ),
    ).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/spectra/runtime/embed?embedId=embed%20%2F1",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("keeps public storage URLs credential-free", async () => {
    const { payload, bytes, build } = fixture();
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      loadPublishedRuntimeBuild(build, new AbortController().signal),
    ).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(
      build.storageUrl,
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it.each([401, 403])(
    "rejects denied access (%s) without returning executable content",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("denied", { status })),
      );
      await expect(
        loadPublishedRuntimeBuild(
          fixture().build,
          new AbortController().signal,
          "embed-1",
        ),
      ).rejects.toThrow(
        status === 401 ? "Sign in again" : "no longer have access",
      );
    },
  );

  it.each([
    ["size", { payloadBytes: 1 }, "unexpected size"],
    ["hash", { payloadHash: "0".repeat(64) }, "integrity check"],
    ["version", { artifactVersionId: "different" }, "published record"],
    ["runtime", { runtime: "python" }, "published record"],
    ["SDK", { sdkVersion: "different" }, "published record"],
  ] as const)("rejects a %s mismatch", async (_name, changed, message) => {
    const { bytes, build } = fixture();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    await expect(
      loadPublishedRuntimeBuild(
        { ...build, ...changed },
        new AbortController().signal,
        "embed-1",
      ),
    ).rejects.toThrow(message);
  });

  it("verifies embedded asset bytes even when the package hash matches", async () => {
    const { payload, build } = fixture();
    payload.assets.push({
      id: "asset",
      path: "asset.txt",
      mediaType: "text/plain",
      bytes: 1,
      sha256: "0".repeat(64),
      dataUrl: "data:text/plain;base64,YQ==",
    });
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    await expect(
      loadPublishedRuntimeBuild(
        {
          ...build,
          payloadBytes: bytes.byteLength,
          payloadHash: createHash("sha256").update(bytes).digest("hex"),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Published asset asset.txt failed its integrity check");
  });

  it("rejects a known oversized record before requesting bytes", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      loadPublishedRuntimeBuild(
        { ...fixture().build, payloadBytes: MAX_EMBED_RUNTIME_BYTES + 1 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("safety budget");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops an oversized chunked response with no declared content length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_EMBED_RUNTIME_BYTES + 1));
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(
      loadPublishedRuntimeBuild(fixture().build, new AbortController().signal),
    ).rejects.toThrow("RUNTIME_BUILD_LIMIT");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("ends a stalled response at its deadline and allows a fresh successful attempt", async () => {
    vi.useFakeTimers();
    const { bytes, build } = fixture();
    const cancel = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    const failed = expect(
      loadPublishedRuntimeBuild(build, new AbortController().signal),
    ).rejects.toThrow("took too long");
    await vi.advanceTimersByTimeAsync(PUBLISHED_RUNTIME_LOAD_TIMEOUT_MS);
    await failed;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      loadPublishedRuntimeBuild(build, new AbortController().signal),
    ).resolves.toMatchObject({ title: "Vector explorer" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled body when the host leaves, without waiting for a deadline", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))),
    );
    const loading = loadPublishedRuntimeBuild(
      fixture().build,
      controller.signal,
    );
    const rejected = expect(loading).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reads many small chunks exactly and cancels misleading declared sizes", async () => {
    let remaining = 10_000;
    const bytes = await readBoundedRuntimeResponse(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (remaining-- > 0) controller.enqueue(new Uint8Array([7]));
            else controller.close();
          },
        }),
      ),
      10_000,
    );
    expect(bytes).toEqual(new Uint8Array(10_000).fill(7));
    const cancel = vi.fn();
    await expect(
      readBoundedRuntimeResponse(
        new Response(new ReadableStream({ cancel }), {
          headers: { "Content-Length": "11" },
        }),
        10,
      ),
    ).rejects.toThrow("RUNTIME_BUILD_LIMIT");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("disposes a body delivered after its host already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancel = vi.fn();
    await expect(
      readBoundedRuntimeResponse(
        new Response(new ReadableStream({ cancel })),
        100,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
