import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collaborationHealthUrlFromEnv,
  composeReadinessStatus,
  isWebHealthBody,
  probeConvexDependency,
  webHealthPayload,
} from "@/lib/readiness";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("web readiness", () => {
  it("probes the hosted gateway over HTTPS instead of Vercel's localhost", () => {
    expect(collaborationHealthUrlFromEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_SPECTRA_COLLAB_URL: "wss://gateway.example.test/realtime",
    })).toBe("https://gateway.example.test");
  });

  it("preserves a hosted gateway's explicit port", () => {
    expect(collaborationHealthUrlFromEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_SPECTRA_COLLAB_URL: "wss://gateway.example.test:8443/realtime",
    })).toBe("https://gateway.example.test:8443");
  });

  it("keeps probing the separate local gateway when the browser uses the local web proxy", () => {
    expect(collaborationHealthUrlFromEnv({
      NODE_ENV: "development",
      NEXT_PUBLIC_SPECTRA_COLLAB_URL: "ws://localhost:3000/_spectra/realtime",
      SPECTRA_COLLAB_HOST: "127.0.0.1",
      SPECTRA_COLLAB_PORT: "3001",
    })).toBe("http://127.0.0.1:3001");
  });

  it("is not ready when Convex or the gateway is missing", () => {
    const payload = webHealthPayload({
      mode: "production",
      convex: { status: "not_ready", detail: "Convex did not answer." },
      gateway: { status: "ready" },
    });
    expect(payload.status).toBe("not_ready");
    expect(payload.service).toBe("spectra-web");
    expect(isWebHealthBody(payload)).toBe(true);
  });

  it("is ready only when both dependencies are ready", () => {
    const payload = webHealthPayload({
      mode: "production",
      convex: { status: "ready", detail: "local-spectra" },
      gateway: { status: "ready" },
    });
    expect(payload.status).toBe("ready");
    expect(payload.mode).toBe("production");
    expect(payload.dependencies.convex.detail).toBe("local-spectra");
  });

  it("degrades when the gateway is degraded and Convex is ready", () => {
    expect(
      composeReadinessStatus([
        { status: "ready" },
        { status: "degraded" },
      ]),
    ).toBe("degraded");
  });

  it("does not treat a process-only payload as ready", () => {
    expect(
      isWebHealthBody({
        service: "spectra-web",
        status: "ready",
        protocolVersion: 1,
      }),
    ).toBe(true);
    expect(
      isWebHealthBody({
        service: "spectra-web",
        status: "up",
        protocolVersion: 1,
      }),
    ).toBe(false);
  });

  it("treats Convex instance_name text/plain as ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("local-pablo_md-ai_school-2", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    await expect(
      probeConvexDependency("http://127.0.0.1:3002"),
    ).resolves.toEqual({
      status: "ready",
      detail: "local-pablo_md-ai_school-2",
    });
  });
});
