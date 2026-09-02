import { describe, expect, it } from "vitest";
import { gatewayHealthPayload, isServiceReady } from "./readiness.mjs";

describe("local readiness probes", () => {
  it("does not treat a listening gateway as ready when Convex is down", () => {
    const payload = gatewayHealthPayload({
      protocolVersion: 1,
      connections: 1,
      lastPersistenceFailure: null,
      convex: { status: "not_ready", detail: "Convex did not answer." },
    });
    expect(payload.status).toBe("not_ready");
    expect(payload.dependencies.convex.status).toBe("not_ready");
    expect(isServiceReady(payload)).toBe(false);
  });

  it("is ready only when Convex answers and persistence is healthy", () => {
    const payload = gatewayHealthPayload({
      protocolVersion: 1,
      connections: 0,
      lastPersistenceFailure: null,
      convex: { status: "ready", detail: "local-spectra" },
    });
    expect(payload.status).toBe("ready");
    expect(isServiceReady(payload)).toBe(true);
  });
});
