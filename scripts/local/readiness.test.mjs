import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { bridgeStatus } from "./start-all.mjs";
import { gatewayHealthPayload, isServiceReady, probeGatewayReadiness, probeWebReadiness } from "./readiness.mjs";

async function withHealthServer(body, status, check) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

describe("local readiness probes", () => {
  it.each([
    ["foreign text", "unrelated listener", false],
    ["foreign object", { status: "ready" }, false],
    ["valid unpaired Bridge", { protocol_version: "1", paired: false }, true],
    ["current Rust wire response", { protocolVersion: "1", paired: true, bindError: null }, true],
    ["current Rust bind failure", { protocolVersion: "1", paired: true, bindError: "fixture collision" }, false],
    ["missing pairing state", { protocolVersion: "1" }, false],
    ["bind failure", { protocol_version: "1", paired: true, bind_error: "fixture collision" }, false],
  ])("start-all handles %s without reusing a foreign listener", async (_label, body, expected) => {
    await withHealthServer(body, 200, async (origin) => {
      expect((await bridgeStatus(origin)).ok).toBe(expected);
    });
  });

  it.each([
    ["web", probeWebReadiness, { service: "spectra-web", status: "ready", mode: "production" }],
    ["gateway", probeGatewayReadiness, gatewayHealthPayload({ protocolVersion: 1 })],
  ])("rejects an HTTP error even when %s claims ready", async (_name, probe, body) => {
    await withHealthServer(body, 503, async (origin) => {
      expect(await probe(origin)).toMatchObject({ status: "not_ready", detail: "HTTP 503" });
    });
    await withHealthServer(body, 200, async (origin) => {
      expect(await probe(origin)).toMatchObject({ status: "ready" });
    });
  });

  it("preserves a valid degraded gateway response", async () => {
    const body = gatewayHealthPayload({ protocolVersion: 1, lastPersistenceFailure: { code: "fixture", at: 1, attempt: 1 } });
    await withHealthServer(body, 200, async (origin) => {
      expect(await probeGatewayReadiness(origin)).toMatchObject({ status: "degraded" });
    });
  });
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
