import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  CLASSROOM_BROWSER_CLIENTS,
  CLASSROOM_MINIMUM_DURATION_MS,
  DEFAULT_CLASSROOM_LOAD,
  deriveGatewayHealthUrl,
  redactedClassroomLoadConfig,
  resolveClassroomLoadConfig,
} from "../../../../scripts/collaboration-classroom-load-config.mjs";
import {
  boundedClassroomLoadJson,
  classroomLoadExitCode,
  createTerminationController,
  evaluateClassroomLoadReport,
  percentile,
} from "../../../../scripts/collaboration-classroom-load-report.mjs";
import { createCollaborationGatewayBridgeClient } from "../../../../scripts/collaboration-gateway-bridge-client.mjs";

const environment = {
  NODE_ENV: "test" as const,
  NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
  SPECTRA_COLLAB_BRIDGE_KEY: "b".repeat(32),
};

function sessionConfig(overrides: Record<string, unknown> = {}) {
  return {
    artifactId: "artifact-classroom",
    token: {
      mode: "session",
      endpoint: "http://localhost:3000/api/spectra/collaboration/token",
      storageState: ".playwright-cli/auth.json",
    },
    ...overrides,
  };
}

function staticToken(clientIndex: number, expiresAtMs: number) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    kind: "spectra_collaboration",
    level: "modify",
    clientId: `load-client-${clientIndex}`,
    documentName: "artifact:classroom:root:document",
    exp: Math.floor(expiresAtMs / 1_000),
  })}.signature-for-configuration-only`;
}

function validReport() {
  const typingSamples = Array.from(
    { length: CLASSROOM_BROWSER_CLIENTS * 10 },
    (_, index) => ({
      sampleId: `sample-${index}`,
      clientIndex: index % CLASSROOM_BROWSER_CLIENTS,
      sequence: Math.floor(index / CLASSROOM_BROWSER_CLIENTS) + 1,
      localMs: 4,
      remoteMs: 8,
    }),
  );
  const clients = Array.from(
    { length: CLASSROOM_BROWSER_CLIENTS },
    (_, index) => ({
      index,
      ready: true,
      operations: 100,
      final: {
        synced: true,
        documentBytes: 50_000,
        documentHash: "document-hash",
        stateVectorHash: "state-vector-hash",
      },
      durability: {
        acknowledged: 10,
        failed: 0,
        pending: 0,
        maxPending: 2,
        ackP95Ms: 250,
      },
      disconnects: [],
      errors: [],
    }),
  );
  clients[0]!.disconnects.push({
    planned: true,
    expected: true,
    code: 1000,
    reason: "",
    recoveryMs: 500,
  } as never);
  const healthSamples = [];
  for (
    let at = 0;
    at <= DEFAULT_CLASSROOM_LOAD.durationMs;
    at += DEFAULT_CLASSROOM_LOAD.healthIntervalMs
  )
    healthSamples.push({
      at,
      status: "ready",
      connections: CLASSROOM_BROWSER_CLIENTS,
      uptimeMs: 10_000 + at,
    });
  if (healthSamples.at(-1)!.at !== DEFAULT_CLASSROOM_LOAD.durationMs)
    healthSamples.push({
      at: DEFAULT_CLASSROOM_LOAD.durationMs,
      status: "ready",
      connections: CLASSROOM_BROWSER_CLIENTS,
      uptimeMs: 10_000 + DEFAULT_CLASSROOM_LOAD.durationMs,
    });
  const observations = [];
  for (
    let at = 0;
    at <= DEFAULT_CLASSROOM_LOAD.durationMs;
    at += DEFAULT_CLASSROOM_LOAD.observationIntervalMs
  )
    observations.push({ at, updateRows: 0, uncompactedBytes: 0 });
  if (observations.at(-1)!.at !== DEFAULT_CLASSROOM_LOAD.durationMs)
    observations.push({
      at: DEFAULT_CLASSROOM_LOAD.durationMs,
      updateRows: 0,
      uncompactedBytes: 0,
    });
  return {
    version: 1,
    run: {
      durationMs: DEFAULT_CLASSROOM_LOAD.durationMs,
      termination: null,
    },
    config: {
      clientCount: CLASSROOM_BROWSER_CLIENTS,
      healthIntervalMs: DEFAULT_CLASSROOM_LOAD.healthIntervalMs,
      observationIntervalMs: DEFAULT_CLASSROOM_LOAD.observationIntervalMs,
      disconnects: [{ clientIndex: 0, atFraction: 0.5 }],
      budgets: DEFAULT_CLASSROOM_LOAD.budgets,
    },
    browser: {
      engine: "chromium",
      version: "140.0.0.0",
      isolatedContexts: CLASSROOM_BROWSER_CLIENTS,
      pageClients: CLASSROOM_BROWSER_CLIENTS,
    },
    clients,
    typingSamples,
    health: { samples: healthSamples },
    disconnects: [
      {
        clientIndex: 0,
        atFraction: 0.5,
        recovered: true,
        recoveryMs: 500,
        offlineEditApplied: true,
        remoteObserved: true,
        durable: true,
      },
    ],
    convex: {
      observations,
      finalCompaction: {
        status: "verified",
        compacted: 10,
      },
      final: {
        headSequence: 100,
        snapshotThroughSequence: 100,
        lastProjectionSequence: 100,
        updateRows: 0,
        uncompactedBytes: 0,
        documentHash: "document-hash",
        stateVectorHash: "state-vector-hash",
        liveStateVectorHash: "state-vector-hash",
      },
    },
  };
}

describe("P5.V1 classroom load configuration", () => {
  it("defaults to exactly 30 clients and a greater-than-60-minute gate", () => {
    const config = resolveClassroomLoadConfig(sessionConfig(), {
      env: environment,
      now: 1,
    });

    expect(config.clientCount).toBe(30);
    expect(config.durationMs).toBeGreaterThan(60 * 60 * 1_000);
    expect(config.budgets.minimumDurationMs).toBe(
      CLASSROOM_MINIMUM_DURATION_MS,
    );
    expect(config.budgets.typingP95Ms).toBe(100);
    expect(config.state.fragmentName).toBe("spectra:document-v2");
    expect(config.token.mode).toBe("session");
  });

  it("rejects client, duration, sample, and typing-budget weakening", () => {
    expect(() =>
      resolveClassroomLoadConfig(sessionConfig({ clientCount: 29 }), {
        env: environment,
      }),
    ).toThrow("CLASSROOM_LOAD_REQUIRES_EXACTLY_30_CLIENTS");
    expect(() =>
      resolveClassroomLoadConfig(
        sessionConfig({ durationMs: 60 * 60 * 1_000 }),
        { env: environment },
      ),
    ).toThrow("CLASSROOM_LOAD_DURATION_BELOW_GATE");
    expect(() =>
      resolveClassroomLoadConfig(
        sessionConfig({ budgets: { typingP95Ms: 101 } }),
        { env: environment },
      ),
    ).toThrow("CLASSROOM_LOAD_TYPING_P95_MS_GATE_CANNOT_BE_WEAKENED");
    expect(() =>
      resolveClassroomLoadConfig(
        sessionConfig({
          typingIntervalMs: 1_000,
          sampleEvery: 1,
        }),
        { env: environment },
      ),
    ).toThrow("CLASSROOM_LOAD_TYPING_VOLUME_UNBOUNDED");
  });

  it("rejects weakened or unbounded observation and evidence budgets", () => {
    expect(() =>
      resolveClassroomLoadConfig(
        sessionConfig({ budgets: { minimumTypingSamples: 299 } }),
        { env: environment },
      ),
    ).toThrow(
      "CLASSROOM_LOAD_MINIMUM_TYPING_SAMPLES_GATE_CANNOT_BE_WEAKENED",
    );
    expect(() =>
      resolveClassroomLoadConfig(
        sessionConfig({ budgets: { maxReportBytes: 5 * 1024 * 1024 } }),
        { env: environment },
      ),
    ).toThrow("CLASSROOM_LOAD_MAX_REPORT_BYTES_GATE_CANNOT_BE_WEAKENED");
    expect(() =>
      resolveClassroomLoadConfig(sessionConfig({ healthIntervalMs: 1 }), {
        env: environment,
      }),
    ).toThrow("CLASSROOM_LOAD_HEALTH_OBSERVATIONS_UNBOUNDED");
    expect(() =>
      resolveClassroomLoadConfig(
        sessionConfig({ observationIntervalMs: 60 * 60 * 1_000 }),
        { env: environment },
      ),
    ).toThrow(
      "CLASSROOM_LOAD_OBSERVATION_INTERVAL_MS_GATE_CANNOT_BE_WEAKENED",
    );
  });

  it("accepts configurable room/state input and redacts token and bridge material", () => {
    const config = resolveClassroomLoadConfig(
      sessionConfig({
        room: "artifact:classroom:root:document",
        state: {
          fragmentName: "custom-document",
          probeMapName: "custom-probe",
          paragraphPrefix: "load-marker",
          initialUpdateBase64: "AA==",
        },
      }),
      { env: environment },
    );
    const redacted = redactedClassroomLoadConfig(config);

    expect(config.state).toMatchObject({
      fragmentName: "custom-document",
      probeMapName: "custom-probe",
      paragraphPrefix: "load-marker",
      initialUpdateBase64: "AA==",
    });
    expect(redacted).not.toHaveProperty("convex.bridgeKey");
    expect(JSON.stringify(redacted)).not.toContain("b".repeat(32));
    expect(JSON.stringify(redacted)).not.toContain("AA==");
    expect(
      deriveGatewayHealthUrl("ws://localhost:3000/_spectra/realtime"),
    ).toBe("http://localhost:3000/_spectra/health");
  });

  it("requires 30 unique, room-bound static tokens that outlive the soak", () => {
    const now = 1_000_000;
    const expiresAt = now + DEFAULT_CLASSROOM_LOAD.durationMs + 120_000;
    const values = Array.from({ length: 30 }, (_, index) =>
      staticToken(index, expiresAt),
    );
    const raw = {
      artifactId: "artifact-classroom",
      room: "artifact:classroom:root:document",
      gatewayUrl: "ws://localhost:1234",
      token: { mode: "static", values },
    };

    const config = resolveClassroomLoadConfig(raw, {
      env: environment,
      now,
    });
    expect(config.token.mode).toBe("static");
    expect(config.token.values).toHaveLength(30);

    expect(() =>
      resolveClassroomLoadConfig(
        {
          ...raw,
          token: { mode: "static", values: values.map(() => values[0]) },
        },
        { env: environment, now },
      ),
    ).toThrow("CLASSROOM_LOAD_STATIC_TOKEN_CLAIMS_INVALID");
    expect(() =>
      resolveClassroomLoadConfig(
        {
          ...raw,
          token: {
            mode: "static",
            values: Array.from({ length: 30 }, (_, index) =>
              staticToken(index, now + 60_000),
            ),
          },
        },
        { env: environment, now },
      ),
    ).toThrow("CLASSROOM_LOAD_STATIC_TOKEN_EXPIRES_DURING_RUN");
  });
});

describe("P5.V1 classroom load metrics and termination", () => {
  it("uses the gateway's signed Convex bridge envelope for durability probes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const bridgeKey = "bridge-key".repeat(4);
    const bridge = createCollaborationGatewayBridgeClient({
      convexUrl: "https://example.convex.cloud",
      bridgeKey,
      now: () => 123_456,
      nonce: () => "fixed-nonce",
      client: {
        action: async (_reference: unknown, request: Record<string, unknown>) => {
          requests.push(request);
          return { ok: true };
        },
      } as never,
    });
    const payload = { artifactId: "artifact-classroom", partitionKey: "root" };

    await expect(bridge("load", payload)).resolves.toEqual({ ok: true });

    const payloadJson = JSON.stringify(payload);
    const digest = createHash("sha256")
      .update(payloadJson)
      .digest("base64url");
    expect(requests).toEqual([
      {
        operation: "load",
        payloadJson,
        timestamp: 123_456,
        nonce: "fixed-nonce",
        signature: createHmac("sha256", bridgeKey)
          .update(["load", 123_456, "fixed-nonce", digest].join("|"))
          .digest("base64url"),
      },
    ]);
  });

  it("uses nearest-rank percentiles and keeps the 100ms threshold strict", () => {
    expect(
      percentile(
        Array.from({ length: 100 }, (_, index) => index + 1),
        0.95,
      ),
    ).toBe(95);
    const report = validReport();
    report.typingSamples[report.typingSamples.length - 1]!.remoteMs = 100;
    for (let index = 0; index < 15; index += 1)
      report.typingSamples[index]!.remoteMs = 100;

    const result = evaluateClassroomLoadReport(report);

    expect(result.passed).toBe(false);
    expect(result.metrics.typingP95Ms).toBe(100);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "TYPING_P95" }),
    );
  });

  it("keeps the first nonzero termination reason", async () => {
    const termination = createTerminationController();
    expect(termination.request("gateway degraded", 2)).toBe(true);
    expect(termination.request("later browser crash", 3)).toBe(false);

    await expect(termination.promise).resolves.toMatchObject({
      reason: "gateway degraded",
      exitCode: 2,
    });
    expect(termination.current()).toMatchObject({
      reason: "gateway degraded",
      exitCode: 2,
    });
    expect(termination.signal.aborted).toBe(true);
  });

  it("returns a nonzero process code for an assertion miss or bounded-report overflow", () => {
    const base = validReport();
    const report = {
      ...base,
      assertions: evaluateClassroomLoadReport(base),
    };
    expect(classroomLoadExitCode(report, { overflow: false })).toBe(0);

    expect(
      classroomLoadExitCode(
        { ...report, assertions: { ...report.assertions, passed: false } },
        { overflow: false },
      ),
    ).toBe(1);
    expect(
      classroomLoadExitCode(
        {
          ...report,
          run: {
            ...report.run,
            termination: { reason: "gateway degraded", exitCode: 7 },
          },
          assertions: { ...report.assertions, passed: false },
        },
        { overflow: false },
      ),
    ).toBe(7);
    expect(classroomLoadExitCode(report, { overflow: true })).toBe(1);
  });
});

describe("P5.V1 classroom load report assertions", () => {
  it("passes only a complete 30-client, durable, compacted, converged report", () => {
    const result = evaluateClassroomLoadReport(validReport());

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.metrics).toMatchObject({
      typingSamples: 300,
      typingP95Ms: 8,
      representedClients: 30,
      finalDocumentHash: "document-hash",
      finalStateVectorHash: "state-vector-hash",
    });
  });

  it("fails on health, reconnect, raw-sample, durability, and Convex divergence", () => {
    const report = validReport();
    report.typingSamples[0]!.remoteMs = null as never;
    report.browser.pageClients = 29;
    report.health.samples[1]!.status = "degraded";
    report.health.samples.at(-1)!.connections = 29;
    report.clients[1]!.durability.pending = 1;
    report.disconnects[0]!.remoteObserved = false;
    report.disconnects[0]!.clientIndex = 9;
    report.convex.final.updateRows = 1;
    report.convex.final.documentHash = "different";
    report.convex.finalCompaction.status = "failed";

    const result = evaluateClassroomLoadReport(report);
    const codes = new Set(result.failures.map((failure) => failure.code));

    expect(result.passed).toBe(false);
    expect(codes).toContain("REAL_BROWSER_CLIENTS");
    expect(codes).toContain("TYPING_SAMPLE_INVALID");
    expect(codes).toContain("GATEWAY_UNHEALTHY");
    expect(codes).toContain("GATEWAY_FINAL_CONNECTIONS");
    expect(codes).toContain("DURABILITY_CONTINUITY");
    expect(codes).toContain("PLANNED_RECONNECT_IDENTITY");
    expect(codes).toContain("PLANNED_RECONNECT_FAILED");
    expect(codes).toContain("CONVEX_FINAL_COMPACTION_FAILED");
    expect(codes).toContain("CONVEX_FINAL_NOT_COMPACTED");
    expect(codes).toContain("CONVEX_YJS_DIVERGENCE");
  });

  it("emits a bounded failure record instead of silently truncating raw evidence", () => {
    const report = {
      ...validReport(),
      assertions: { passed: true, failures: [], metrics: {} },
    };
    const bounded = boundedClassroomLoadJson(report, 1_000);

    expect(bounded.overflow).toBe(true);
    expect(Buffer.byteLength(bounded.json)).toBeLessThan(1_000);
    expect(bounded.json).toContain("REPORT_UNBOUNDED");
    expect(bounded.json).toContain("were not silently truncated");
  });

  it("keeps even the overflow failure artifact inside the configured byte cap", () => {
    const report = {
      ...validReport(),
      run: {
        ...validReport().run,
        termination: { reason: "x".repeat(100_000), exitCode: 1 },
      },
      config: {
        ...validReport().config,
        room: "room".repeat(10_000),
      },
      assertions: { passed: false, failures: [], metrics: {} },
    };

    const bounded = boundedClassroomLoadJson(report, 1_024);

    expect(bounded.overflow).toBe(true);
    expect(bounded.bytes).toBeLessThanOrEqual(1_024);
    expect(bounded.json).toContain("REPORT_UNBOUNDED");
    expect(bounded.json).not.toContain("x".repeat(1_000));
  });
});
