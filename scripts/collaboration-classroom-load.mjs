import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import * as Y from "yjs";
import { COLLAB_RECONNECT } from "./collaboration-reconnect.mjs";
import {
  deriveGatewayHealthUrl,
  redactedClassroomLoadConfig,
  resolveClassroomLoadConfig,
} from "./collaboration-classroom-load-config.mjs";
import {
  boundedClassroomLoadJson,
  classroomLoadExitCode,
  createTerminationController,
  evaluateClassroomLoadReport,
} from "./collaboration-classroom-load-report.mjs";
import { createCollaborationGatewayBridgeClient } from "./collaboration-gateway-bridge-client.mjs";
import {
  applyStoredRoomUpdates,
  encodeStoredRoomSnapshot,
  storedRoomUpdates,
} from "./collaboration-room-state.mjs";
import { isGatewayHealthBody } from "./collaboration-health.mjs";

const HELP = `Usage:
  npm run collaboration:classroom-load -- --config <load-config.json> [--report <report.json>]

Start from scripts/collaboration-classroom-load.example.json and replace its
artifactId with a verifier-owned document.

The JSON config requires artifactId, a token source, and Convex observation
settings. token.mode="session" uses endpoint + Playwright storageState and
refreshes the ten-minute production token. token.mode="static" requires exactly
30 JWTs whose expiry covers the full run, plus room and gatewayUrl. Optional
state.fragmentName, state.probeMapName, and state.initialUpdateBase64 select the
Yjs state under load. The duration defaults to 65 minutes and cannot be lowered
below the greater-than-60-minute gate.
`;

function parseArguments(argv) {
  const args = { configPath: null, reportPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") args.help = true;
    else if (value === "--config") args.configPath = argv[++index] ?? null;
    else if (value === "--report") args.reportPath = argv[++index] ?? null;
    else throw new Error(`CLASSROOM_LOAD_ARGUMENT_INVALID:${value}`);
  }
  if (!args.help && !args.configPath)
    throw new Error("CLASSROOM_LOAD_CONFIG_PATH_REQUIRED");
  return args;
}

async function waitForDelay(ms, signal) {
  try {
    await delay(ms, undefined, { signal });
    return true;
  } catch (error) {
    if (signal?.aborted && error?.name === "AbortError") return false;
    throw error;
  }
}

async function bundleBrowserClient() {
  const result = await build({
    entryPoints: [resolve("scripts/collaboration-classroom-browser-client.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "SpectraClassroomLoadClient",
    platform: "browser",
    target: "chrome120",
    sourcemap: false,
    minify: true,
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("CLASSROOM_LOAD_BROWSER_BUNDLE_MISSING");
  return output;
}

function clientOptions(config, clientIndex, runId) {
  const connection =
    config.token.mode === "session"
      ? {
          mode: "session",
          endpoint: config.token.endpoint,
          artifactId: config.artifactId,
          partitionKey: config.partitionKey,
          schemaVersion: config.schemaVersion,
        }
      : {
          mode: "static",
          token: config.token.values[clientIndex],
          gatewayUrl: config.gatewayUrl,
          room: config.room,
        };
  const disconnectSamples = config.disconnects.filter(
    (drill) => drill.clientIndex === clientIndex,
  ).length;
  return {
    runId,
    clientIndex,
    clientCount: config.clientCount,
    clientId: `classroom-load-${randomUUID()}`,
    expectedRoom: config.room,
    connection,
    state: config.state,
    typingIntervalMs: config.typingIntervalMs,
    sampleEvery: config.sampleEvery,
    maxSamples:
      Math.ceil(config.budgets.maxRawTypingSamples / config.clientCount) +
      disconnectSamples,
    reconnect: COLLAB_RECONNECT,
  };
}

async function startBrowserClient({
  browser,
  bundle,
  config,
  clientIndex,
  runId,
  termination,
}) {
  const context = await browser.newContext(
    config.token.mode === "session"
      ? { storageState: config.token.storageState }
      : {},
  );
  const page = await context.newPage();
  page.on("crash", () =>
    termination.request(`CLASSROOM_LOAD_PAGE_${clientIndex}_CRASHED`),
  );
  page.on("pageerror", (error) =>
    termination.request(
      `CLASSROOM_LOAD_PAGE_${clientIndex}_ERROR:${error.message}`,
    ),
  );
  await page.addInitScript({ content: bundle });
  if (config.token.mode === "session") {
    const origin = new URL(config.token.endpoint);
    origin.pathname = "/__spectra_classroom_load__";
    origin.search = `?client=${clientIndex}`;
    await page.goto(origin.toString(), {
      waitUntil: "commit",
      timeout: 30_000,
    });
  } else {
    await page.goto(
      `data:text/html,<title>Spectra classroom load ${clientIndex + 1}</title>`,
      { waitUntil: "commit" },
    );
  }
  const started = await page.evaluate(
    (options) => globalThis.SpectraClassroomLoadClient.start(options),
    clientOptions(config, clientIndex, runId),
  );
  return { context, page, started, index: clientIndex };
}

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function summarizeStoredRoom(stored, at, phase) {
  if (!stored) throw new Error("CLASSROOM_LOAD_CONVEX_ROOM_MISSING");
  const document = applyStoredRoomUpdates(Y, stored);
  try {
    const update = Y.encodeStateAsUpdate(document);
    const stateVector = Y.encodeStateVector(document);
    return {
      at,
      phase,
      headSequence: Math.max(0, (stored.nextSequence ?? 1) - 1),
      snapshotThroughSequence: stored.snapshot?.throughSequence ?? 0,
      updateRows: stored.updates?.length ?? 0,
      updateBytes: storedRoomUpdates(stored).reduce(
        (total, entry) =>
          total +
          (typeof entry.update === "string"
            ? Buffer.from(entry.update, "base64").byteLength
            : entry.update.byteLength),
        0,
      ),
      uncompactedBytes: stored.uncompactedBytes ?? 0,
      lastSnapshotAt: stored.lastSnapshotAt ?? null,
      lastProjectionSequence: stored.lastProjectionSequence ?? null,
      liveStateVectorHash: stored.liveStateVectorHash ?? null,
      documentBytes: update.byteLength,
      documentHash: sha256Base64Url(update),
      stateVectorHash: sha256Base64Url(stateVector),
    };
  } finally {
    document.destroy();
  }
}

async function waitForRemoteSample(
  page,
  sampleId,
  timeoutMs,
  terminationSignal,
) {
  const startedAt = Date.now();
  for (;;) {
    if (
      await page.evaluate(
        (id) => globalThis.SpectraClassroomLoadClient.hasRemoteSample(id),
        sampleId,
      )
    )
      return true;
    if (Date.now() - startedAt >= timeoutMs) return false;
    if (!(await waitForDelay(50, terminationSignal))) return false;
  }
}

function mergeTypingSamples(clientSnapshots) {
  const remote = new Map();
  for (const snapshot of clientSnapshots)
    for (const sample of snapshot.remoteSamples)
      remote.set(sample.sampleId, sample.remoteMs);
  const samples = [];
  for (const snapshot of clientSnapshots)
    for (const sample of snapshot.localSamples)
      samples.push({
        sampleId: sample.sampleId,
        clientIndex: sample.clientIndex,
        sequence: sample.sequence,
        localMs: sample.localMs,
        remoteMs: remote.get(sample.sampleId) ?? null,
      });
  return samples.sort(
    (left, right) =>
      left.clientIndex - right.clientIndex || left.sequence - right.sequence,
  );
}

async function healthSample(url) {
  const at = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.json();
    if (!response.ok || !isGatewayHealthBody(body))
      throw new Error(`HTTP_${response.status}_INVALID_HEALTH`);
    return {
      at,
      status: body.status,
      connections: typeof body.connections === "number" ? body.connections : -1,
      uptimeMs: typeof body.uptimeMs === "number" ? body.uptimeMs : -1,
      persistence: body.persistence ?? null,
    };
  } catch (error) {
    return {
      at,
      status: "unavailable",
      connections: -1,
      uptimeMs: -1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function compactFinalRoom(bridge, config) {
  const stored = await bridge("load", {
    artifactId: config.artifactId,
    partitionKey: config.partitionKey,
  });
  if (!stored?.roomId) throw new Error("CLASSROOM_LOAD_CONVEX_ROOM_MISSING");
  const throughSequence = Math.max(0, (stored.nextSequence ?? 1) - 1);
  if (throughSequence <= 0)
    throw new Error("CLASSROOM_LOAD_CONVEX_ROOM_EMPTY");
  const { update, stateVector } = encodeStoredRoomSnapshot(Y, stored);
  if (update.byteLength > 760 * 1024 || stateVector.byteLength > 128 * 1024)
    throw new Error("CLASSROOM_LOAD_FINAL_SNAPSHOT_UNBOUNDED");
  const result = await bridge("snapshot", {
    artifactId: config.artifactId,
    partitionKey: config.partitionKey,
    roomId: stored.roomId,
    throughSequence,
    update: Buffer.from(update).toString("base64"),
    stateVector: Buffer.from(stateVector).toString("base64"),
    contentHash: sha256Base64Url(update),
    schemaVersion: stored.schemaVersion ?? config.schemaVersion,
  });
  if (result?.status !== "verified")
    throw new Error("CLASSROOM_LOAD_FINAL_SNAPSHOT_NOT_VERIFIED");
  return {
    at: Date.now(),
    status: result.status,
    compacted: result.compacted ?? 0,
    throughSequence,
    documentBytes: update.byteLength,
    stateVectorBytes: stateVector.byteLength,
  };
}

async function runPeriodic(intervalMs, task, signal) {
  while (!signal.aborted) {
    await task();
    if (signal.aborted) return;
    if (!(await waitForDelay(intervalMs, signal))) return;
  }
}

async function runLoad(config) {
  const termination = createTerminationController();
  const healthSamples = [];
  const observations = [];
  const drills = [];
  const clientHandles = [];
  const runId = randomUUID();
  let browser = null;
  const pollingController = new AbortController();
  let runStartedAt = null;
  let runStoppedAt = null;
  let healthUrl = config.healthUrl;
  let browserSummary = null;
  let finalCompaction = null;
  const bridge = createCollaborationGatewayBridgeClient({
    convexUrl: config.convex.url,
    bridgeKey: config.convex.bridgeKey,
  });
  const observe = async (phase) => {
    try {
      const stored = await bridge("load", {
        artifactId: config.artifactId,
        partitionKey: config.partitionKey,
      });
      const summary = summarizeStoredRoom(stored, Date.now(), phase);
      observations.push(summary);
      return summary;
    } catch (error) {
      const summary = {
        at: Date.now(),
        phase,
        error: error instanceof Error ? error.message : String(error),
        updateRows: Number.POSITIVE_INFINITY,
        uncompactedBytes: Number.POSITIVE_INFINITY,
      };
      observations.push(summary);
      return summary;
    }
  };
  const stopSignals = [];
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const listener = () => termination.request(`CLASSROOM_LOAD_${signal}`);
    process.once(signal, listener);
    stopSignals.push([signal, listener]);
  }

  try {
    const bundle = await bundleBrowserClient();
    const launch = {
      headless: config.browser.headless,
      ...(config.browser.executablePath
        ? { executablePath: config.browser.executablePath }
        : { channel: config.browser.channel }),
    };
    browser = await chromium.launch(launch);
    browser.on("disconnected", () =>
      termination.request("CLASSROOM_LOAD_BROWSER_DISCONNECTED"),
    );
    const startedClients = await Promise.all(
      Array.from({ length: config.clientCount }, (_, clientIndex) =>
        startBrowserClient({
          browser,
          bundle,
          config,
          clientIndex,
          runId,
          termination,
        }),
      ),
    );
    clientHandles.push(...startedClients);
    browserSummary = {
      engine: "chromium",
      version: browser.version(),
      isolatedContexts: startedClients.length,
      pageClients: startedClients.filter((client) => !client.page.isClosed())
        .length,
    };
    const rooms = new Set(
      startedClients.map((client) => client.started.documentName),
    );
    const gatewayUrls = new Set(
      startedClients.map((client) => client.started.gatewayUrl),
    );
    if (rooms.size !== 1) throw new Error("CLASSROOM_LOAD_ROOM_DIVERGENCE");
    if (gatewayUrls.size !== 1)
      throw new Error("CLASSROOM_LOAD_GATEWAY_DIVERGENCE");
    const derivedHealthUrl = deriveGatewayHealthUrl([...gatewayUrls][0]);
    if (healthUrl && healthUrl !== derivedHealthUrl)
      throw new Error("CLASSROOM_LOAD_HEALTH_URL_MISMATCH");
    healthUrl = derivedHealthUrl;

    healthSamples.push(await healthSample(healthUrl));
    await observe("initial");
    runStartedAt = Date.now();
    await Promise.all(
      clientHandles.map((client) =>
        client.page.evaluate(
          (staggerMs) =>
            globalThis.SpectraClassroomLoadClient.startTyping(staggerMs),
          Math.floor(
            (client.index * config.typingIntervalMs) / config.clientCount,
          ),
        ),
      ),
    );
    const healthLoop = runPeriodic(
      config.healthIntervalMs,
      async () => healthSamples.push(await healthSample(healthUrl)),
      pollingController.signal,
    );
    const convexLoop = runPeriodic(
      config.observationIntervalMs,
      () => observe("soak"),
      pollingController.signal,
    );
    const drillPromises = config.disconnects.map(async (drill) => {
      const due = await waitForDelay(drill.atMs, termination.signal);
      if (!due) return null;
      const author = clientHandles[drill.clientIndex];
      const observer =
        clientHandles[(drill.clientIndex + 1) % config.clientCount];
      try {
        const reconnect = await author.page.evaluate(
          (holdMs) =>
            globalThis.SpectraClassroomLoadClient.disconnectAndReconnect(
              holdMs,
            ),
          config.disconnectHoldMs,
        );
        const remoteObserved = await waitForRemoteSample(
          observer.page,
          reconnect.sampleId,
          config.budgets.maxConnectionRecoveryMs,
          termination.signal,
        );
        const recorded = {
          clientIndex: drill.clientIndex,
          atFraction: drill.atFraction,
          recoveryMs: reconnect.recoveryMs,
          recovered: reconnect.recoveryMs !== null,
          offlineEditApplied: reconnect.offlineEditApplied,
          remoteObserved,
          durable: reconnect.durable,
        };
        drills.push(recorded);
        return recorded;
      } catch (error) {
        const recorded = {
          clientIndex: drill.clientIndex,
          atFraction: drill.atFraction,
          recovered: false,
          offlineEditApplied: false,
          remoteObserved: false,
          durable: false,
          error: error instanceof Error ? error.message : String(error),
        };
        drills.push(recorded);
        termination.request(
          `CLASSROOM_LOAD_RECONNECT_DRILL_FAILED:${recorded.error}`,
        );
        return recorded;
      }
    });

    const completedDuration = await waitForDelay(
      config.durationMs,
      termination.signal,
    );
    const completion = completedDuration ? "duration" : "terminated";
    runStoppedAt = Date.now();
    await Promise.all(
      clientHandles.map((client) =>
        client.page.evaluate(() =>
          globalThis.SpectraClassroomLoadClient.pauseTyping(),
        ),
      ),
    );
    await Promise.all(drillPromises);
    if (completion === "duration") {
      const flushes = await Promise.allSettled(
        clientHandles.map((client) =>
          client.page.evaluate(() =>
            globalThis.SpectraClassroomLoadClient.flush(),
          ),
        ),
      );
      for (const flush of flushes)
        if (flush.status === "rejected")
          termination.request(
            `CLASSROOM_LOAD_FINAL_FLUSH_FAILED:${flush.reason}`,
          );
      await waitForDelay(config.finalSettleMs, termination.signal);
    }
    pollingController.abort("CLASSROOM_LOAD_POLLING_COMPLETE");
    await Promise.all([healthLoop, convexLoop]);
    try {
      finalCompaction = await compactFinalRoom(bridge, config);
    } catch (error) {
      finalCompaction = {
        at: Date.now(),
        status: "failed",
        compacted: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const finalConvex = await observe("final");
    healthSamples.push(await healthSample(healthUrl));

    const clientSnapshots = await Promise.all(
      clientHandles.map((client) =>
        client.page.evaluate(() =>
          globalThis.SpectraClassroomLoadClient.snapshot(),
        ),
      ),
    );
    const typingSamples = mergeTypingSamples(clientSnapshots);
    const clients = clientSnapshots.map(
      ({ localSamples: _local, remoteSamples: _remote, ...client }) => client,
    );
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      run: {
        startedAt: runStartedAt,
        endedAt: runStoppedAt,
        durationMs:
          runStartedAt && runStoppedAt ? runStoppedAt - runStartedAt : 0,
        termination: termination.current(),
      },
      config: {
        ...redactedClassroomLoadConfig(config),
        room: [...rooms][0],
        gatewayHealthUrl: healthUrl,
      },
      browser: browserSummary,
      clients,
      typingSamples,
      health: { samples: healthSamples },
      disconnects: drills.sort(
        (left, right) => left.atFraction - right.atFraction,
      ),
      convex: { observations, finalCompaction, final: finalConvex },
    };
    report.assertions = evaluateClassroomLoadReport(report);
    return report;
  } catch (error) {
    termination.request(error instanceof Error ? error.message : String(error));
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      run: {
        startedAt: runStartedAt,
        endedAt: runStoppedAt ?? Date.now(),
        durationMs:
          runStartedAt === null
            ? 0
            : (runStoppedAt ?? Date.now()) - runStartedAt,
        termination: termination.current(),
      },
      config: redactedClassroomLoadConfig(config),
      browser: browserSummary,
      clients: [],
      typingSamples: [],
      health: { samples: healthSamples },
      disconnects: drills,
      convex: { observations, finalCompaction, final: null },
    };
    report.assertions = evaluateClassroomLoadReport(report);
    return report;
  } finally {
    pollingController.abort("CLASSROOM_LOAD_CLEANUP");
    for (const client of clientHandles) {
      try {
        await client.page.evaluate(() =>
          globalThis.SpectraClassroomLoadClient.stop(),
        );
      } catch {}
      await client.context.close().catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);
    for (const [signal, listener] of stopSignals)
      process.removeListener(signal, listener);
  }
}

async function main() {
  let args;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n${HELP}`,
    );
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  let config;
  try {
    const input = JSON.parse(await readFile(resolve(args.configPath), "utf8"));
    if (args.reportPath) input.reportPath = args.reportPath;
    config = resolveClassroomLoadConfig(input);
  } catch (error) {
    process.stderr.write(
      `Classroom load configuration failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const report = await runLoad(config);
  const bounded = boundedClassroomLoadJson(
    report,
    config.budgets.maxReportBytes,
  );
  const reportPath = resolve(config.reportPath);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, bounded.json, "utf8");
  const exitCode = classroomLoadExitCode(report, bounded);
  const passed = exitCode === 0;
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"} classroom load: ${report.assertions.metrics.typingSamples} samples, p95=${report.assertions.metrics.typingP95Ms ?? "missing"}ms, report=${reportPath}\n`,
  );
  if (!passed) {
    for (const failure of report.assertions.failures)
      process.stderr.write(`[${failure.code}] ${failure.detail}\n`);
    if (bounded.overflow)
      process.stderr.write(
        "[REPORT_UNBOUNDED] Full raw evidence exceeded its configured byte budget.\n",
      );
    process.exitCode = exitCode;
  }
}

await main();
