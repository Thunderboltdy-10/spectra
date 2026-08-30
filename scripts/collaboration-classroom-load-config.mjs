import {
  COMPACTION_IDLE_MS,
  COMPACTION_UNCOMPACTED_BYTES,
  COMPACTION_UPDATE_COUNT,
} from "./collaboration-room-state.mjs";
import { MAX_REALTIME_MESSAGE_BYTES } from "./collaboration-update-envelope.mjs";

export const CLASSROOM_BROWSER_CLIENTS = 30;
export const CLASSROOM_MINIMUM_DURATION_MS = 60 * 60 * 1_000 + 1;
export const CLASSROOM_MINIMUM_REPORT_BYTES = 1_024;
const CLASSROOM_MAX_HEALTH_SAMPLES = 2_000;
const CLASSROOM_MAX_DURABILITY_OBSERVATIONS = 64;

export const DEFAULT_CLASSROOM_LOAD = Object.freeze({
  clientCount: CLASSROOM_BROWSER_CLIENTS,
  durationMs: 65 * 60 * 1_000,
  typingIntervalMs: 3_000,
  sampleEvery: 5,
  healthIntervalMs: 5_000,
  observationIntervalMs: 15 * 60 * 1_000,
  finalSettleMs: COMPACTION_IDLE_MS + 5_000,
  disconnectHoldMs: 2_000,
  disconnects: [
    { clientIndex: 0, atFraction: 0.25 },
    { clientIndex: 14, atFraction: 0.5 },
    { clientIndex: 29, atFraction: 0.75 },
  ],
  state: {
    fragmentName: "spectra:document-v2",
    probeMapName: "spectra:classroom-load:v1",
    paragraphPrefix: "p5v1-load",
  },
  budgets: {
    minimumDurationMs: CLASSROOM_MINIMUM_DURATION_MS,
    typingP95Ms: 100,
    minimumTypingSamples: CLASSROOM_BROWSER_CLIENTS * 10,
    maxConnectionRecoveryMs: 30_000,
    durabilityAckP95Ms: 5_000,
    maxDurabilityPending: 10,
    maxRawTypingSamples: 20_000,
    maxReportBytes: 4 * 1024 * 1024,
    maxYjsDocumentBytes: MAX_REALTIME_MESSAGE_BYTES,
    maxConvexUpdateRows: COMPACTION_UPDATE_COUNT + CLASSROOM_BROWSER_CLIENTS,
    maxConvexUncompactedBytes:
      COMPACTION_UNCOMPACTED_BYTES + CLASSROOM_BROWSER_CLIENTS * 4_096,
  },
});

function positiveInteger(value, fallback, name) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0)
    throw new Error(`CLASSROOM_LOAD_${name.toUpperCase()}_INVALID`);
  return candidate;
}

function canonicalMinimum(value, fallback, name) {
  const candidate = positiveInteger(value, fallback, name);
  if (candidate < fallback)
    throw new Error(
      `CLASSROOM_LOAD_${name.toUpperCase()}_GATE_CANNOT_BE_WEAKENED`,
    );
  return candidate;
}

function canonicalMaximum(value, fallback, name) {
  const candidate = positiveInteger(value, fallback, name);
  if (candidate > fallback)
    throw new Error(
      `CLASSROOM_LOAD_${name.toUpperCase()}_GATE_CANNOT_BE_WEAKENED`,
    );
  return candidate;
}

function boundedText(value, fallback, name, max = 240) {
  const candidate = value ?? fallback;
  if (
    typeof candidate !== "string" ||
    !candidate.trim() ||
    candidate.length > max
  )
    throw new Error(`CLASSROOM_LOAD_${name.toUpperCase()}_INVALID`);
  return candidate.trim();
}

function absoluteUrl(value, fallback, name, protocols) {
  const candidate = boundedText(value, fallback, name, 2_000);
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`CLASSROOM_LOAD_${name.toUpperCase()}_INVALID`);
  }
  if (!protocols.includes(url.protocol))
    throw new Error(`CLASSROOM_LOAD_${name.toUpperCase()}_INVALID`);
  return url.toString();
}

function jwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function normalizeDisconnects(value, durationMs) {
  const source = value ?? DEFAULT_CLASSROOM_LOAD.disconnects;
  if (!Array.isArray(source) || source.length === 0 || source.length > 12)
    throw new Error("CLASSROOM_LOAD_DISCONNECTS_INVALID");
  const normalized = source.map((entry) => {
    const clientIndex = entry?.clientIndex;
    const atFraction = entry?.atFraction;
    if (
      !Number.isSafeInteger(clientIndex) ||
      clientIndex < 0 ||
      clientIndex >= CLASSROOM_BROWSER_CLIENTS ||
      typeof atFraction !== "number" ||
      !Number.isFinite(atFraction) ||
      atFraction <= 0 ||
      atFraction >= 1
    )
      throw new Error("CLASSROOM_LOAD_DISCONNECTS_INVALID");
    return {
      clientIndex,
      atFraction,
      atMs: Math.floor(durationMs * atFraction),
    };
  });
  if (new Set(normalized.map((entry) => entry.clientIndex)).size !== normalized.length)
    throw new Error("CLASSROOM_LOAD_DISCONNECT_CLIENTS_MUST_BE_UNIQUE");
  return normalized;
}

function normalizeToken(raw, durationMs, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("CLASSROOM_LOAD_TOKEN_INVALID");
  if (raw.mode === "session") {
    const storageState = boundedText(
      raw.storageState,
      undefined,
      "storage_state",
      2_000,
    );
    return {
      mode: "session",
      endpoint: absoluteUrl(raw.endpoint, undefined, "token_endpoint", [
        "http:",
        "https:",
      ]),
      storageState,
    };
  }
  if (raw.mode === "static") {
    if (
      !Array.isArray(raw.values) ||
      raw.values.length !== CLASSROOM_BROWSER_CLIENTS ||
      !raw.values.every(
        (value) => typeof value === "string" && value.length > 40,
      )
    )
      throw new Error("CLASSROOM_LOAD_STATIC_TOKENS_INVALID");
    const requiredExpiry = now + durationMs + 60_000;
    const claims = raw.values.map(jwtPayload);
    if (claims.some((value) => !value))
      throw new Error("CLASSROOM_LOAD_STATIC_TOKEN_INVALID");
    if (
      claims.some(
        (value) =>
          value.kind !== "spectra_collaboration" ||
          value.level !== "modify" ||
          typeof value.clientId !== "string" ||
          !value.clientId ||
          typeof value.documentName !== "string" ||
          !value.documentName ||
          typeof value.exp !== "number",
      )
    )
      throw new Error("CLASSROOM_LOAD_STATIC_TOKEN_INVALID");
    if (claims.some((value) => value.exp * 1_000 < requiredExpiry))
      throw new Error("CLASSROOM_LOAD_STATIC_TOKEN_EXPIRES_DURING_RUN");
    const clientIds = new Set(claims.map((value) => value.clientId));
    const documentNames = new Set(claims.map((value) => value.documentName));
    if (
      clientIds.size !== CLASSROOM_BROWSER_CLIENTS ||
      documentNames.size !== 1
    )
      throw new Error("CLASSROOM_LOAD_STATIC_TOKEN_CLAIMS_INVALID");
    return {
      mode: "static",
      values: [...raw.values],
      documentName: [...documentNames][0],
    };
  }
  throw new Error("CLASSROOM_LOAD_TOKEN_INVALID");
}

export function deriveGatewayHealthUrl(gatewayUrl) {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/_spectra/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Resolve the verifier-owned JSON input into one fail-closed load plan.
 * Budget overrides may tighten canonical values, never relax them.
 */
export function resolveClassroomLoadConfig(
  raw,
  { env = process.env, now = Date.now() } = {},
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("CLASSROOM_LOAD_CONFIG_INVALID");
  const clientCount = positiveInteger(
    raw.clientCount,
    DEFAULT_CLASSROOM_LOAD.clientCount,
    "client_count",
  );
  if (clientCount !== CLASSROOM_BROWSER_CLIENTS)
    throw new Error("CLASSROOM_LOAD_REQUIRES_EXACTLY_30_CLIENTS");
  const durationMs = positiveInteger(
    raw.durationMs,
    DEFAULT_CLASSROOM_LOAD.durationMs,
    "duration_ms",
  );
  const minimumDurationMs = canonicalMinimum(
    raw.budgets?.minimumDurationMs,
    DEFAULT_CLASSROOM_LOAD.budgets.minimumDurationMs,
    "minimum_duration_ms",
  );
  if (durationMs < minimumDurationMs)
    throw new Error("CLASSROOM_LOAD_DURATION_BELOW_GATE");
  const disconnects = normalizeDisconnects(raw.disconnects, durationMs);

  const typingP95Ms = canonicalMaximum(
    raw.budgets?.typingP95Ms,
    DEFAULT_CLASSROOM_LOAD.budgets.typingP95Ms,
    "typing_p95_ms",
  );
  const typingIntervalMs = positiveInteger(
    raw.typingIntervalMs,
    DEFAULT_CLASSROOM_LOAD.typingIntervalMs,
    "typing_interval_ms",
  );
  const sampleEvery = positiveInteger(
    raw.sampleEvery,
    DEFAULT_CLASSROOM_LOAD.sampleEvery,
    "sample_every",
  );
  const maxRawTypingSamples = canonicalMaximum(
    raw.budgets?.maxRawTypingSamples,
    DEFAULT_CLASSROOM_LOAD.budgets.maxRawTypingSamples,
    "max_raw_typing_samples",
  );
  const predictedOperations =
    Math.ceil(durationMs / typingIntervalMs) * CLASSROOM_BROWSER_CLIENTS;
  const predictedSamples =
    Math.ceil(predictedOperations / sampleEvery) + disconnects.length;
  if (predictedOperations > 100_000)
    throw new Error("CLASSROOM_LOAD_TYPING_VOLUME_UNBOUNDED");
  if (predictedSamples > maxRawTypingSamples)
    throw new Error("CLASSROOM_LOAD_RAW_SAMPLES_UNBOUNDED");
  const minimumTypingSamples = canonicalMinimum(
    raw.budgets?.minimumTypingSamples,
    DEFAULT_CLASSROOM_LOAD.budgets.minimumTypingSamples,
    "minimum_typing_samples",
  );
  if (minimumTypingSamples > predictedSamples)
    throw new Error("CLASSROOM_LOAD_MINIMUM_TYPING_SAMPLES_UNREACHABLE");
  const maxYjsDocumentBytes = canonicalMaximum(
    raw.budgets?.maxYjsDocumentBytes,
    DEFAULT_CLASSROOM_LOAD.budgets.maxYjsDocumentBytes,
    "max_yjs_document_bytes",
  );

  const token = normalizeToken(raw.token, durationMs, now);
  const room =
    raw.room === undefined
      ? null
      : boundedText(raw.room, undefined, "room", 500);
  const gatewayUrl =
    raw.gatewayUrl === undefined
      ? null
      : absoluteUrl(raw.gatewayUrl, undefined, "gateway_url", ["ws:", "wss:"]);
  if (token.mode === "static" && (!room || !gatewayUrl))
    throw new Error("CLASSROOM_LOAD_STATIC_ROOM_AND_GATEWAY_REQUIRED");
  if (token.mode === "static" && token.documentName !== room)
    throw new Error("CLASSROOM_LOAD_STATIC_ROOM_MISMATCH");

  const artifactId = boundedText(raw.artifactId, undefined, "artifact_id", 240);
  const partitionKey = boundedText(
    raw.partitionKey,
    "root",
    "partition_key",
    180,
  );
  const schemaVersion = positiveInteger(raw.schemaVersion, 1, "schema_version");
  const convexUrl = absoluteUrl(
    raw.convex?.url ?? env.NEXT_PUBLIC_CONVEX_URL ?? env.CONVEX_URL,
    undefined,
    "convex_url",
    ["http:", "https:"],
  );
  const bridgeKeyEnvironment = boundedText(
    raw.convex?.bridgeKeyEnvironment,
    "SPECTRA_COLLAB_BRIDGE_KEY",
    "bridge_key_environment",
    120,
  );
  const bridgeKey = env[bridgeKeyEnvironment];
  if (!bridgeKey || bridgeKey.length < 32)
    throw new Error("CLASSROOM_LOAD_BRIDGE_KEY_MISSING");

  const state = {
    fragmentName: boundedText(
      raw.state?.fragmentName,
      DEFAULT_CLASSROOM_LOAD.state.fragmentName,
      "fragment_name",
    ),
    probeMapName: boundedText(
      raw.state?.probeMapName,
      DEFAULT_CLASSROOM_LOAD.state.probeMapName,
      "probe_map_name",
    ),
    paragraphPrefix: boundedText(
      raw.state?.paragraphPrefix,
      DEFAULT_CLASSROOM_LOAD.state.paragraphPrefix,
      "paragraph_prefix",
    ),
    initialUpdateBase64:
      raw.state?.initialUpdateBase64 === undefined
        ? null
        : boundedText(
            raw.state.initialUpdateBase64,
            undefined,
            "initial_update_base64",
            2_000_000,
          ),
  };
  if (
    state.initialUpdateBase64 &&
    (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(state.initialUpdateBase64) ||
      Buffer.from(state.initialUpdateBase64, "base64").byteLength >
        MAX_REALTIME_MESSAGE_BYTES)
  )
    throw new Error("CLASSROOM_LOAD_INITIAL_STATE_INVALID");
  const executablePath =
    raw.browser?.executablePath === undefined
      ? null
      : boundedText(
          raw.browser.executablePath,
          undefined,
          "browser_executable_path",
          2_000,
        );
  const channel = executablePath
    ? null
    : boundedText(raw.browser?.channel, "chrome", "browser_channel", 80);
  const healthIntervalMs = canonicalMaximum(
    raw.healthIntervalMs,
    DEFAULT_CLASSROOM_LOAD.healthIntervalMs,
    "health_interval_ms",
  );
  if (
    Math.ceil(durationMs / healthIntervalMs) + 2 >
    CLASSROOM_MAX_HEALTH_SAMPLES
  )
    throw new Error("CLASSROOM_LOAD_HEALTH_OBSERVATIONS_UNBOUNDED");
  const observationIntervalMs = canonicalMaximum(
    raw.observationIntervalMs,
    DEFAULT_CLASSROOM_LOAD.observationIntervalMs,
    "observation_interval_ms",
  );
  if (
    Math.ceil(durationMs / observationIntervalMs) + 2 >
    CLASSROOM_MAX_DURABILITY_OBSERVATIONS
  )
    throw new Error("CLASSROOM_LOAD_DURABILITY_OBSERVATIONS_UNBOUNDED");
  const disconnectHoldMs = positiveInteger(
    raw.disconnectHoldMs,
    DEFAULT_CLASSROOM_LOAD.disconnectHoldMs,
    "disconnect_hold_ms",
  );
  const maxConnectionRecoveryMs = canonicalMaximum(
    raw.budgets?.maxConnectionRecoveryMs,
    DEFAULT_CLASSROOM_LOAD.budgets.maxConnectionRecoveryMs,
    "max_connection_recovery_ms",
  );
  if (disconnectHoldMs >= maxConnectionRecoveryMs)
    throw new Error("CLASSROOM_LOAD_DISCONNECT_EXCEEDS_RECOVERY_BUDGET");
  const maxReportBytes = canonicalMaximum(
    raw.budgets?.maxReportBytes,
    DEFAULT_CLASSROOM_LOAD.budgets.maxReportBytes,
    "max_report_bytes",
  );
  if (maxReportBytes < CLASSROOM_MINIMUM_REPORT_BYTES)
    throw new Error("CLASSROOM_LOAD_REPORT_BUDGET_TOO_SMALL");

  return {
    clientCount,
    durationMs,
    typingIntervalMs,
    sampleEvery,
    healthIntervalMs,
    observationIntervalMs,
    finalSettleMs: Math.max(
      COMPACTION_IDLE_MS,
      positiveInteger(
        raw.finalSettleMs,
        DEFAULT_CLASSROOM_LOAD.finalSettleMs,
        "final_settle_ms",
      ),
    ),
    disconnectHoldMs,
    disconnects,
    room,
    artifactId,
    partitionKey,
    schemaVersion,
    gatewayUrl,
    healthUrl:
      raw.healthUrl === undefined
        ? gatewayUrl
          ? deriveGatewayHealthUrl(gatewayUrl)
          : null
        : absoluteUrl(raw.healthUrl, undefined, "health_url", [
            "http:",
            "https:",
          ]),
    token,
    state,
    convex: { url: convexUrl, bridgeKey, bridgeKeyEnvironment },
    browser: {
      headless: raw.browser?.headless !== false,
      channel,
      executablePath,
    },
    reportPath: boundedText(
      raw.reportPath,
      ".shots/reformation/P5.V1/classroom-load.json",
      "report_path",
      2_000,
    ),
    budgets: {
      minimumDurationMs,
      typingP95Ms,
      minimumTypingSamples,
      maxConnectionRecoveryMs,
      durabilityAckP95Ms: canonicalMaximum(
        raw.budgets?.durabilityAckP95Ms,
        DEFAULT_CLASSROOM_LOAD.budgets.durabilityAckP95Ms,
        "durability_ack_p95_ms",
      ),
      maxDurabilityPending: canonicalMaximum(
        raw.budgets?.maxDurabilityPending,
        DEFAULT_CLASSROOM_LOAD.budgets.maxDurabilityPending,
        "max_durability_pending",
      ),
      maxRawTypingSamples,
      maxReportBytes,
      maxYjsDocumentBytes,
      maxConvexUpdateRows: canonicalMaximum(
        raw.budgets?.maxConvexUpdateRows,
        DEFAULT_CLASSROOM_LOAD.budgets.maxConvexUpdateRows,
        "max_convex_update_rows",
      ),
      maxConvexUncompactedBytes: canonicalMaximum(
        raw.budgets?.maxConvexUncompactedBytes,
        DEFAULT_CLASSROOM_LOAD.budgets.maxConvexUncompactedBytes,
        "max_convex_uncompacted_bytes",
      ),
    },
  };
}

export function redactedClassroomLoadConfig(config) {
  return {
    clientCount: config.clientCount,
    durationMs: config.durationMs,
    typingIntervalMs: config.typingIntervalMs,
    sampleEvery: config.sampleEvery,
    healthIntervalMs: config.healthIntervalMs,
    observationIntervalMs: config.observationIntervalMs,
    finalSettleMs: config.finalSettleMs,
    disconnectHoldMs: config.disconnectHoldMs,
    disconnects: config.disconnects,
    room: config.room,
    artifactId: config.artifactId,
    partitionKey: config.partitionKey,
    schemaVersion: config.schemaVersion,
    tokenMode: config.token.mode,
    state: {
      fragmentName: config.state.fragmentName,
      probeMapName: config.state.probeMapName,
      paragraphPrefix: config.state.paragraphPrefix,
      initialUpdateProvided: Boolean(config.state.initialUpdateBase64),
    },
    convexUrl: config.convex.url,
    browser: {
      headless: config.browser.headless,
      channel: config.browser.channel,
      executablePathProvided: Boolean(config.browser.executablePath),
    },
    budgets: config.budgets,
  };
}
