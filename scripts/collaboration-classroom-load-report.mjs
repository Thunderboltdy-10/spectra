import {
  CLASSROOM_BROWSER_CLIENTS,
  DEFAULT_CLASSROOM_LOAD,
} from "./collaboration-classroom-load-config.mjs";

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (
    typeof percentileValue !== "number" ||
    percentileValue <= 0 ||
    percentileValue > 1
  )
    throw new Error("CLASSROOM_LOAD_PERCENTILE_INVALID");
  const sorted = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length !== values.length || sorted.length === 0)
    throw new Error("CLASSROOM_LOAD_SAMPLE_INVALID");
  return sorted[Math.ceil(sorted.length * percentileValue) - 1];
}

export function createTerminationController() {
  let termination = null;
  let settle;
  const abortController = new AbortController();
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    signal: abortController.signal,
    request(reason, exitCode = 1) {
      if (termination) return false;
      termination = {
        reason:
          typeof reason === "string" && reason.trim()
            ? reason.trim()
            : "CLASSROOM_LOAD_TERMINATED",
        exitCode: Number.isSafeInteger(exitCode) && exitCode > 0 ? exitCode : 1,
        at: Date.now(),
      };
      abortController.abort(termination);
      settle(termination);
      return true;
    },
    current() {
      return termination;
    },
  };
}

export function classroomLoadExitCode(report, boundedReport) {
  if (report?.assertions?.passed === true && !boundedReport?.overflow) return 0;
  const requested = report?.run?.termination?.exitCode;
  return Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
}

function issue(failures, code, detail) {
  failures.push({ code, detail });
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safePositive(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function canonicalBudgets(input, failures) {
  const defaults = DEFAULT_CLASSROOM_LOAD.budgets;
  const resolved = {};
  const constraints = [
    ["minimumDurationMs", "minimum", defaults.minimumDurationMs],
    ["typingP95Ms", "maximum", defaults.typingP95Ms],
    ["minimumTypingSamples", "minimum", defaults.minimumTypingSamples],
    ["maxConnectionRecoveryMs", "maximum", defaults.maxConnectionRecoveryMs],
    ["durabilityAckP95Ms", "maximum", defaults.durabilityAckP95Ms],
    ["maxDurabilityPending", "maximum", defaults.maxDurabilityPending],
    ["maxRawTypingSamples", "maximum", defaults.maxRawTypingSamples],
    ["maxReportBytes", "maximum", defaults.maxReportBytes],
    ["maxYjsDocumentBytes", "maximum", defaults.maxYjsDocumentBytes],
    ["maxConvexUpdateRows", "maximum", defaults.maxConvexUpdateRows],
    [
      "maxConvexUncompactedBytes",
      "maximum",
      defaults.maxConvexUncompactedBytes,
    ],
  ];
  for (const [name, direction, canonical] of constraints) {
    const supplied = input?.[name];
    const valid = safePositive(supplied);
    const weakened =
      valid &&
      (direction === "minimum"
        ? supplied < canonical
        : supplied > canonical);
    if (!valid || weakened)
      issue(
        failures,
        "BUDGET_CONFIG_INVALID",
        `${name} is missing or weaker than the canonical classroom gate.`,
      );
    resolved[name] = valid
      ? direction === "minimum"
        ? Math.max(supplied, canonical)
        : Math.min(supplied, canonical)
      : canonical;
  }
  return resolved;
}

function connectionDeficitMs(samples, expectedConnections) {
  let deficitAt = null;
  let longest = 0;
  for (const sample of samples) {
    const deficient =
      sample.error ||
      sample.status !== "ready" ||
      sample.connections < expectedConnections;
    if (deficient && deficitAt === null) deficitAt = sample.at;
    if (!deficient && deficitAt !== null) {
      longest = Math.max(longest, sample.at - deficitAt);
      deficitAt = null;
    }
  }
  if (deficitAt !== null && samples.length)
    longest = Math.max(longest, samples.at(-1).at - deficitAt);
  return longest;
}

export function evaluateClassroomLoadReport(report) {
  const failures = [];
  const budgets = canonicalBudgets(report?.config?.budgets, failures);
  const clients = Array.isArray(report?.clients) ? report.clients : [];
  const samples = Array.isArray(report?.typingSamples)
    ? report.typingSamples
    : [];
  const healthSamples = Array.isArray(report?.health?.samples)
    ? report.health.samples
    : [];
  const observations = Array.isArray(report?.convex?.observations)
    ? report.convex.observations
    : [];

  if (
    report?.config?.clientCount !== CLASSROOM_BROWSER_CLIENTS ||
    clients.length !== CLASSROOM_BROWSER_CLIENTS
  )
    issue(
      failures,
      "CLIENT_COUNT",
      `Expected exactly ${CLASSROOM_BROWSER_CLIENTS} browser clients.`,
    );
  if (
    report?.browser?.engine !== "chromium" ||
    typeof report?.browser?.version !== "string" ||
    !report.browser.version ||
    report?.browser?.isolatedContexts !== CLASSROOM_BROWSER_CLIENTS ||
    report?.browser?.pageClients !== CLASSROOM_BROWSER_CLIENTS
  )
    issue(
      failures,
      "REAL_BROWSER_CLIENTS",
      `Expected ${CLASSROOM_BROWSER_CLIENTS} isolated Chromium contexts with one live page client each.`,
    );

  if (
    !finiteNonNegative(report?.run?.durationMs) ||
    report.run.durationMs < budgets.minimumDurationMs
  )
    issue(
      failures,
      "DURATION",
      `Observed ${report?.run?.durationMs ?? "missing"}ms; required at least ${budgets.minimumDurationMs}ms.`,
    );

  if (samples.length < budgets.minimumTypingSamples)
    issue(
      failures,
      "TYPING_SAMPLE_COUNT",
      `Observed ${samples.length} raw samples; required ${budgets.minimumTypingSamples}.`,
    );
  if (samples.length > budgets.maxRawTypingSamples)
    issue(
      failures,
      "TYPING_SAMPLES_UNBOUNDED",
      `Observed ${samples.length} raw samples; cap is ${budgets.maxRawTypingSamples}.`,
    );

  const representedClients = new Set();
  const samplesPerClient = new Map();
  const sampleIds = new Set();
  const typingLatencies = [];
  for (const sample of samples) {
    if (
      !Number.isSafeInteger(sample.clientIndex) ||
      sample.clientIndex < 0 ||
      sample.clientIndex >= CLASSROOM_BROWSER_CLIENTS ||
      !safePositive(sample.sequence) ||
      typeof sample.sampleId !== "string" ||
      !sample.sampleId ||
      sampleIds.has(sample.sampleId) ||
      !finiteNonNegative(sample.localMs) ||
      !finiteNonNegative(sample.remoteMs)
    ) {
      issue(
        failures,
        "TYPING_SAMPLE_INVALID",
        "A raw sample is incomplete or invalid.",
      );
      continue;
    }
    sampleIds.add(sample.sampleId);
    representedClients.add(sample.clientIndex);
    samplesPerClient.set(
      sample.clientIndex,
      (samplesPerClient.get(sample.clientIndex) ?? 0) + 1,
    );
    typingLatencies.push(Math.max(sample.localMs, sample.remoteMs));
  }
  if (representedClients.size !== CLASSROOM_BROWSER_CLIENTS)
    issue(
      failures,
      "TYPING_CLIENT_COVERAGE",
      `Raw samples cover ${representedClients.size}/${CLASSROOM_BROWSER_CLIENTS} clients.`,
    );
  const minimumPerClient = Math.ceil(
    budgets.minimumTypingSamples / CLASSROOM_BROWSER_CLIENTS,
  );
  for (let index = 0; index < CLASSROOM_BROWSER_CLIENTS; index += 1)
    if ((samplesPerClient.get(index) ?? 0) < minimumPerClient)
      issue(
        failures,
        "TYPING_CLIENT_SAMPLE_COUNT",
        `Client ${index} has ${samplesPerClient.get(index) ?? 0} raw samples; required ${minimumPerClient}.`,
      );
  const typingP95Ms = typingLatencies.length
    ? percentile(typingLatencies, 0.95)
    : null;
  if (typingP95Ms === null || typingP95Ms >= budgets.typingP95Ms)
    issue(
      failures,
      "TYPING_P95",
      `Typing p95 is ${typingP95Ms ?? "missing"}ms; budget is strictly below ${budgets.typingP95Ms}ms.`,
    );

  const documentHashes = new Set();
  const stateVectorHashes = new Set();
  const clientIndices = new Set();
  for (const client of clients) {
    if (
      !Number.isSafeInteger(client?.index) ||
      client.index < 0 ||
      client.index >= CLASSROOM_BROWSER_CLIENTS ||
      clientIndices.has(client.index)
    )
      issue(
        failures,
        "CLIENT_IDENTITY",
        `Client index ${client?.index ?? "missing"} is invalid or duplicated.`,
      );
    else clientIndices.add(client.index);
    if (!safePositive(client?.operations))
      issue(
        failures,
        "CLIENT_DID_NOT_TYPE",
        `Client ${client?.index ?? "?"} recorded no typing operations.`,
      );
    if (!client?.ready || !client?.final?.synced)
      issue(
        failures,
        "CLIENT_NOT_SYNCHRONIZED",
        `Client ${client?.index ?? "?"} did not finish synchronized.`,
      );
    if (!client?.final?.documentHash || !client?.final?.stateVectorHash)
      issue(
        failures,
        "CLIENT_HASH_MISSING",
        `Client ${client?.index ?? "?"} has no final Yjs hash.`,
      );
    else {
      documentHashes.add(client.final.documentHash);
      stateVectorHashes.add(client.final.stateVectorHash);
    }
    if (
      !finiteNonNegative(client?.final?.documentBytes) ||
      client.final.documentBytes > budgets.maxYjsDocumentBytes
    )
      issue(
        failures,
        "YJS_STATE_UNBOUNDED",
        `Client ${client?.index ?? "?"} has ${client?.final?.documentBytes ?? "missing"} Yjs bytes; budget is ${budgets.maxYjsDocumentBytes}.`,
      );
    if ((client?.errors?.length ?? 0) > 0)
      issue(
        failures,
        "CLIENT_ERROR",
        `Client ${client.index} recorded ${client.errors.length} errors.`,
      );
    if (
      client?.durability?.failed > 0 ||
      client?.durability?.pending !== 0 ||
      !(client?.durability?.acknowledged > 0)
    )
      issue(
        failures,
        "DURABILITY_CONTINUITY",
        `Client ${client?.index ?? "?"} durability did not settle cleanly.`,
      );
    if (
      !finiteNonNegative(client?.durability?.ackP95Ms) ||
      client.durability.ackP95Ms > budgets.durabilityAckP95Ms ||
      client.durability.maxPending > budgets.maxDurabilityPending
    )
      issue(
        failures,
        "DURABILITY_BUDGET",
        `Client ${client?.index ?? "?"} durability p95/max-pending is ${client?.durability?.ackP95Ms ?? "missing"}ms/${client?.durability?.maxPending ?? "missing"}; budgets are ${budgets.durabilityAckP95Ms}ms/${budgets.maxDurabilityPending}.`,
      );
    for (const disconnect of client?.disconnects ?? []) {
      if (!finiteNonNegative(disconnect.recoveryMs))
        issue(
          failures,
          "RECONNECT_MISSING",
          `Client ${client.index} did not recover from a disconnect.`,
        );
      else if (disconnect.recoveryMs > budgets.maxConnectionRecoveryMs)
        issue(
          failures,
          "RECONNECT_BUDGET",
          `Client ${client.index} recovered in ${disconnect.recoveryMs}ms; budget is ${budgets.maxConnectionRecoveryMs}ms.`,
        );
      if (!disconnect.planned && !disconnect.expected)
        issue(
          failures,
          "UNEXPECTED_DISCONNECT",
          `Client ${client.index} disconnected unexpectedly (${disconnect.code}: ${disconnect.reason || "no reason"}).`,
        );
    }
  }
  if (documentHashes.size !== 1 || stateVectorHashes.size !== 1)
    issue(
      failures,
      "YJS_DIVERGENCE",
      `Final browser state has ${documentHashes.size} document hashes and ${stateVectorHashes.size} state-vector hashes.`,
    );
  if (clientIndices.size !== CLASSROOM_BROWSER_CLIENTS)
    issue(
      failures,
      "CLIENT_IDENTITY_COVERAGE",
      `Final snapshots cover ${clientIndices.size}/${CLASSROOM_BROWSER_CLIENTS} client identities.`,
    );

  if (healthSamples.length < 2)
    issue(
      failures,
      "HEALTH_OBSERVATIONS_MISSING",
      "Gateway health was not observed throughout the run.",
    );
  let maxHealthGapMs = 0;
  for (let index = 0; index < healthSamples.length; index += 1) {
    const sample = healthSamples[index];
    if (
      !finiteNonNegative(sample?.at) ||
      !finiteNonNegative(sample?.uptimeMs) ||
      !Number.isSafeInteger(sample?.connections) ||
      sample.connections < 0
    )
      issue(
        failures,
        "GATEWAY_HEALTH_INVALID",
        "A gateway health observation was incomplete or invalid.",
      );
    if (sample?.error || sample?.status !== "ready")
      issue(
        failures,
        "GATEWAY_UNHEALTHY",
        `Gateway health at ${sample.at ?? "unknown"} was ${sample.error ?? sample.status ?? "missing"}.`,
      );
    if (sample?.connections > CLASSROOM_BROWSER_CLIENTS)
      issue(
        failures,
        "GATEWAY_CONNECTION_EXCESS",
        `Gateway reported ${sample.connections} connections for ${CLASSROOM_BROWSER_CLIENTS} clients.`,
      );
    if (index > 0 && finiteNonNegative(sample?.at)) {
      const priorAt = healthSamples[index - 1]?.at;
      if (!finiteNonNegative(priorAt) || sample.at < priorAt)
        issue(
          failures,
          "GATEWAY_HEALTH_ORDER",
          "Gateway health observations are not chronological.",
        );
      else maxHealthGapMs = Math.max(maxHealthGapMs, sample.at - priorAt);
    }
  }
  for (let index = 1; index < healthSamples.length; index += 1) {
    if (healthSamples[index].uptimeMs < healthSamples[index - 1].uptimeMs)
      issue(
        failures,
        "GATEWAY_RESTARTED",
        "Gateway uptime decreased during the soak.",
      );
  }
  if (
    healthSamples.length >= 2 &&
    healthSamples.at(-1).uptimeMs - healthSamples[0].uptimeMs <
      report.run.durationMs - (report.config.healthIntervalMs ?? 0) * 2
  )
    issue(
      failures,
      "GATEWAY_STABILITY_DURATION",
      "Gateway uptime did not continuously span the greater-than-60-minute soak.",
    );
  const allowedHealthGapMs = (report?.config?.healthIntervalMs ?? 0) * 3;
  if (!safePositive(report?.config?.healthIntervalMs))
    issue(
      failures,
      "GATEWAY_HEALTH_INTERVAL_INVALID",
      "The health observation interval is missing or invalid.",
    );
  else if (maxHealthGapMs > allowedHealthGapMs)
    issue(
      failures,
      "GATEWAY_HEALTH_GAP",
      `Gateway health was unobserved for ${maxHealthGapMs}ms; allowed gap is ${allowedHealthGapMs}ms.`,
    );
  const healthDeficitMs = connectionDeficitMs(
    healthSamples,
    CLASSROOM_BROWSER_CLIENTS,
  );
  if (healthDeficitMs > budgets.maxConnectionRecoveryMs)
    issue(
      failures,
      "GATEWAY_CONNECTION_CONTINUITY",
      `Gateway connection deficit lasted ${healthDeficitMs}ms; budget is ${budgets.maxConnectionRecoveryMs}ms.`,
    );
  if (
    healthSamples.length &&
    healthSamples.at(-1).connections !== CLASSROOM_BROWSER_CLIENTS
  )
    issue(
      failures,
      "GATEWAY_FINAL_CONNECTIONS",
      `Gateway finished with ${healthSamples.at(-1).connections}/${CLASSROOM_BROWSER_CLIENTS} connections.`,
    );

  const planned = Array.isArray(report?.disconnects) ? report.disconnects : [];
  const configuredDisconnects = Array.isArray(report?.config?.disconnects)
    ? report.config.disconnects
    : [];
  if (planned.length !== configuredDisconnects.length)
    issue(
      failures,
      "PLANNED_RECONNECT_COUNT",
      "Not every configured disconnect drill ran.",
    );
  const plannedKeys = new Set();
  for (const drill of planned) {
    const key = `${drill?.clientIndex}:${drill?.atFraction}`;
    if (
      !Number.isSafeInteger(drill?.clientIndex) ||
      drill.clientIndex < 0 ||
      drill.clientIndex >= CLASSROOM_BROWSER_CLIENTS ||
      typeof drill?.atFraction !== "number" ||
      !configuredDisconnects.some(
        (configured) =>
          configured.clientIndex === drill.clientIndex &&
          configured.atFraction === drill.atFraction,
      ) ||
      plannedKeys.has(key)
    )
      issue(
        failures,
        "PLANNED_RECONNECT_IDENTITY",
        "A reconnect result did not match one unique configured drill.",
      );
    plannedKeys.add(key);
    if (
      !drill?.recovered ||
      !drill?.offlineEditApplied ||
      !drill?.remoteObserved ||
      !drill?.durable
    )
      issue(
        failures,
        "PLANNED_RECONNECT_FAILED",
        `Disconnect drill for client ${drill?.clientIndex ?? "?"} did not reconverge durably.`,
      );
    if (
      !finiteNonNegative(drill?.recoveryMs) ||
      drill.recoveryMs > budgets.maxConnectionRecoveryMs
    )
      issue(
        failures,
        "PLANNED_RECONNECT_BUDGET",
        `Disconnect drill recovery was ${drill?.recoveryMs ?? "missing"}ms.`,
      );
  }

  if (
    report?.convex?.finalCompaction?.status !== "verified" ||
    !finiteNonNegative(report?.convex?.finalCompaction?.compacted)
  )
    issue(
      failures,
      "CONVEX_FINAL_COMPACTION_FAILED",
      "The verifier could not create and verify the final bounded room snapshot.",
    );

  if (observations.length < 2)
    issue(
      failures,
      "CONVEX_OBSERVATIONS_MISSING",
      "Convex room truth was not sampled during the run.",
    );
  let maxObservationGapMs = 0;
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (
      !finiteNonNegative(observation?.at) ||
      !finiteNonNegative(observation?.updateRows) ||
      !finiteNonNegative(observation?.uncompactedBytes)
    )
      issue(
        failures,
        "CONVEX_OBSERVATION_INVALID",
        "A Convex durability observation was incomplete or invalid.",
      );
    if (observation?.error)
      issue(failures, "CONVEX_OBSERVATION_FAILED", observation.error);
    if (observation.updateRows > budgets.maxConvexUpdateRows)
      issue(
        failures,
        "CONVEX_UPDATE_LOG_UNBOUNDED",
        `Convex retained ${observation.updateRows} update rows; budget is ${budgets.maxConvexUpdateRows}.`,
      );
    if (observation.uncompactedBytes > budgets.maxConvexUncompactedBytes)
      issue(
        failures,
        "CONVEX_BYTES_UNBOUNDED",
        `Convex retained ${observation.uncompactedBytes} uncompacted bytes; budget is ${budgets.maxConvexUncompactedBytes}.`,
      );
    if (index > 0 && finiteNonNegative(observation?.at)) {
      const priorAt = observations[index - 1]?.at;
      if (!finiteNonNegative(priorAt) || observation.at < priorAt)
        issue(
          failures,
          "CONVEX_OBSERVATION_ORDER",
          "Convex durability observations are not chronological.",
        );
      else
        maxObservationGapMs = Math.max(
          maxObservationGapMs,
          observation.at - priorAt,
        );
    }
  }
  const observationIntervalMs = report?.config?.observationIntervalMs;
  if (!safePositive(observationIntervalMs))
    issue(
      failures,
      "CONVEX_OBSERVATION_INTERVAL_INVALID",
      "The durability observation interval is missing or invalid.",
    );
  else if (maxObservationGapMs > observationIntervalMs * 2)
    issue(
      failures,
      "CONVEX_OBSERVATION_GAP",
      `Convex durability was unobserved for ${maxObservationGapMs}ms; allowed gap is ${observationIntervalMs * 2}ms.`,
    );
  const finalConvex = report?.convex?.final;
  const browserDocumentHash =
    documentHashes.size === 1 ? [...documentHashes][0] : null;
  const browserStateVectorHash =
    stateVectorHashes.size === 1 ? [...stateVectorHashes][0] : null;
  const finalSequencesValid =
    Number.isSafeInteger(finalConvex?.headSequence) &&
    finalConvex.headSequence >= 0 &&
    Number.isSafeInteger(finalConvex?.snapshotThroughSequence) &&
    finalConvex.snapshotThroughSequence >= 0 &&
    Number.isSafeInteger(finalConvex?.lastProjectionSequence) &&
    finalConvex.lastProjectionSequence >= 0;
  if (
    !finalConvex ||
    !finalSequencesValid ||
    finalConvex.updateRows !== 0 ||
    finalConvex.uncompactedBytes !== 0 ||
    finalConvex.snapshotThroughSequence !== finalConvex.headSequence ||
    finalConvex.lastProjectionSequence !== finalConvex.headSequence
  )
    issue(
      failures,
      "CONVEX_FINAL_NOT_COMPACTED",
      "Final Convex truth did not reach one projected, verified snapshot with an empty update tail.",
    );
  if (
    !finalConvex ||
    finalConvex.documentHash !== browserDocumentHash ||
    finalConvex.stateVectorHash !== browserStateVectorHash ||
    finalConvex.liveStateVectorHash !== browserStateVectorHash
  )
    issue(
      failures,
      "CONVEX_YJS_DIVERGENCE",
      "Final Convex reconstruction, durable head, and browser Yjs state do not agree.",
    );

  if (report?.run?.termination?.exitCode > 0)
    issue(
      failures,
      "EARLY_TERMINATION",
      report.run.termination.reason || "The soak terminated early.",
    );

  return {
    passed: failures.length === 0,
    failures,
    metrics: {
      typingSamples: samples.length,
      typingP95Ms,
      typingMaxMs: typingLatencies.length ? Math.max(...typingLatencies) : null,
      representedClients: representedClients.size,
      healthSamples: healthSamples.length,
      healthDeficitMs,
      maxHealthGapMs,
      convexObservations: observations.length,
      maxObservationGapMs,
      finalDocumentHash: browserDocumentHash,
      finalStateVectorHash: browserStateVectorHash,
    },
  };
}

export function boundedClassroomLoadJson(report, maxBytes) {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const bytes = Buffer.byteLength(json);
  if (bytes <= maxBytes) return { json, bytes, overflow: false };
  const overflowReport = {
    version: report.version,
    run: report.run,
    config: report.config,
    assertions: {
      passed: false,
      failures: [
        ...(report.assertions?.failures ?? []),
        {
          code: "REPORT_UNBOUNDED",
          detail: `The complete ${bytes}-byte report exceeded the ${maxBytes}-byte evidence budget; raw samples were not silently truncated.`,
        },
      ],
      metrics: report.assertions?.metrics ?? {},
    },
    overflow: {
      attemptedBytes: bytes,
      maxBytes,
      rawTypingSamples: report.typingSamples?.length ?? 0,
    },
  };
  let overflowJson = `${JSON.stringify(overflowReport)}\n`;
  if (Buffer.byteLength(overflowJson) > maxBytes) {
    overflowJson = `${JSON.stringify({
      version: report?.version ?? 1,
      assertions: {
        passed: false,
        failures: [
          {
            code: "REPORT_UNBOUNDED",
            detail: `${bytes} bytes exceeded the ${maxBytes}-byte evidence budget; raw evidence was not truncated into an apparent pass.`,
          },
        ],
      },
      overflow: { attemptedBytes: bytes, maxBytes },
    })}\n`;
  }
  if (Buffer.byteLength(overflowJson) > maxBytes)
    throw new Error("CLASSROOM_LOAD_REPORT_BUDGET_TOO_SMALL");
  return {
    json: overflowJson,
    bytes: Buffer.byteLength(overflowJson),
    overflow: true,
  };
}
