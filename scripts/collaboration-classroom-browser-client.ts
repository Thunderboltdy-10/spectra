import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import * as Y from "yjs";

type Session = {
  token: string;
  documentName: string;
  url: string;
  level?: string;
  expiresAt?: number;
  expiresInMs?: number;
};

type StartOptions = {
  runId: string;
  clientIndex: number;
  clientCount: number;
  clientId: string;
  expectedRoom: string | null;
  connection:
    | {
        mode: "session";
        endpoint: string;
        artifactId: string;
        partitionKey: string;
        schemaVersion: number;
      }
    | {
        mode: "static";
        token: string;
        gatewayUrl: string;
        room: string;
      };
  state: {
    fragmentName: string;
    probeMapName: string;
    paragraphPrefix: string;
    initialUpdateBase64: string | null;
  };
  typingIntervalMs: number;
  sampleEvery: number;
  maxSamples: number;
  reconnect: {
    delay: number;
    factor: number;
    minDelay: number;
    maxDelay: number;
    jitter: boolean;
    maxAttempts: number;
    initialDelay: number;
  };
};

type TypingSample = {
  sampleId: string;
  clientIndex: number;
  sequence: number;
  localMs: number;
};

type RemoteSample = {
  sampleId: string;
  remoteMs: number;
};

type DisconnectRecord = {
  at: number;
  code: number;
  reason: string;
  planned: boolean;
  expected: boolean;
  recoveryMs?: number;
};

type Runtime = {
  options: StartOptions;
  document: Y.Doc;
  provider: HocuspocusProvider;
  websocket: HocuspocusProviderWebsocket;
  session: Session;
  writer: Y.XmlText;
  probeMap: Y.Map<unknown>;
  typingTimer: number | null;
  typingDelayTimer: number | null;
  sequence: number;
  operations: number;
  localSamples: TypingSample[];
  remoteSamples: RemoteSample[];
  remoteSampleIds: Set<string>;
  pendingAcks: Map<string, number>;
  localDurabilityPending: boolean;
  acknowledged: number;
  failed: number;
  maxPending: number;
  ackLatencies: number[];
  status: string;
  statusTransitions: Array<{ at: number; status: string }>;
  disconnects: DisconnectRecord[];
  activeDisconnect: DisconnectRecord | null;
  plannedDisconnect: boolean;
  errors: string[];
};

let runtime: Runtime | null = null;

function epochNow() {
  return performance.timeOrigin + performance.now();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  error: string,
) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started >= timeoutMs) throw new Error(error);
    await sleep(25);
  }
}

function bytesFromBase64(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1)
    binary += String.fromCharCode(bytes[index]!);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(bytes: Uint8Array) {
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return base64Url(new Uint8Array(digest));
}

function expectedDisconnectReason(reason: string) {
  return /TOKEN_EXPIRED|SESSION_EXPIRED|ACCESS OR PERMISSIONS CHANGED/i.test(
    reason,
  );
}

async function acquireSession(options: StartOptions): Promise<Session> {
  if (options.connection.mode === "static")
    return {
      token: options.connection.token,
      documentName: options.connection.room,
      url: options.connection.gatewayUrl,
    };
  let lastFailure = "CLASSROOM_LOAD_TOKEN_REQUEST_FAILED";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let response: Response;
    let payload: Partial<Session> & { error?: unknown };
    try {
      response = await fetch(options.connection.endpoint, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactId: options.connection.artifactId,
          partitionKey: options.connection.partitionKey,
          schemaVersion: options.connection.schemaVersion,
          clientId: options.clientId,
          realtimeProvider: "hocuspocus",
        }),
        signal: AbortSignal.timeout(8_000),
      });
      payload = (await response.json()) as Partial<Session> & {
        error?: unknown;
      };
    } catch (error) {
      lastFailure = `CLASSROOM_LOAD_TOKEN_REQUEST_FAILED:${error instanceof Error ? error.message : String(error)}`;
      await sleep(500);
      continue;
    }
    if (
      response.ok &&
      typeof payload.token === "string" &&
      typeof payload.documentName === "string" &&
      typeof payload.url === "string"
    ) {
      if (
        options.expectedRoom &&
        payload.documentName !== options.expectedRoom
      )
        throw new Error("CLASSROOM_LOAD_ROOM_MISMATCH");
      const expiresInMs =
        typeof payload.expiresInMs === "number" && payload.expiresInMs > 0
          ? payload.expiresInMs
          : 0;
      return {
        token: payload.token,
        documentName: payload.documentName,
        url: payload.url,
        level: payload.level,
        expiresAt: Date.now() + expiresInMs,
      };
    }
    lastFailure = `CLASSROOM_LOAD_TOKEN_REQUEST_FAILED:${response.status}:${JSON.stringify(payload.error ?? "invalid response")}`;
    if (response.status !== 401) throw new Error(lastFailure);
    await sleep(500);
  }
  throw new Error(lastFailure);
}

function findOrCreateWriter(document: Y.Doc, options: StartOptions): Y.XmlText {
  const fragment = document.getXmlFragment(options.state.fragmentName);
  const writerId = `${options.state.paragraphPrefix}-${options.runId}-${options.clientIndex}`;
  for (const child of fragment.toArray()) {
    if (
      child instanceof Y.XmlElement &&
      child.getAttribute("blockId") === writerId
    ) {
      const text = child
        .toArray()
        .find((entry): entry is Y.XmlText => entry instanceof Y.XmlText);
      if (text) return text;
    }
  }
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.setAttribute("blockId", writerId);
  const text = new Y.XmlText();
  paragraph.push([text]);
  text.insert(0, `Classroom load client ${options.clientIndex + 1}: `);
  fragment.push([paragraph]);
  return text;
}

function recordError(value: unknown) {
  if (!runtime) return;
  const message = value instanceof Error ? value.message : String(value);
  if (runtime.errors.length < 100) runtime.errors.push(message.slice(0, 500));
}

function noteRecoveredIfSettled() {
  if (
    !runtime?.activeDisconnect ||
    runtime.status !== "connected" ||
    !runtime.provider.synced ||
    runtime.provider.hasUnsyncedChanges ||
    runtime.pendingAcks.size > 0 ||
    runtime.localDurabilityPending
  )
    return;
  runtime.activeDisconnect.recoveryMs =
    epochNow() - runtime.activeDisconnect.at;
  runtime.activeDisconnect = null;
}

function noteStatus(status: string) {
  if (!runtime || runtime.status === status) return;
  runtime.status = status;
  if (runtime.statusTransitions.length < 300)
    runtime.statusTransitions.push({ at: Date.now(), status });
  noteRecoveredIfSettled();
}

function onStateless(payload: string) {
  if (!runtime) return;
  try {
    const message = JSON.parse(payload) as {
      type?: string;
      updateIds?: unknown;
      message?: unknown;
    };
    const ids = Array.isArray(message.updateIds)
      ? message.updateIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (message.type === "spectra.durable_pending") {
      const now = epochNow();
      for (const id of ids) runtime.pendingAcks.set(id, now);
      runtime.maxPending = Math.max(
        runtime.maxPending,
        runtime.pendingAcks.size,
      );
    } else if (message.type === "spectra.durable_ack") {
      const now = epochNow();
      for (const id of ids) {
        const pendingAt = runtime.pendingAcks.get(id);
        if (pendingAt !== undefined && runtime.ackLatencies.length < 10_000)
          runtime.ackLatencies.push(now - pendingAt);
        runtime.pendingAcks.delete(id);
        runtime.acknowledged += 1;
      }
      if (
        runtime.pendingAcks.size === 0 &&
        !runtime.provider.hasUnsyncedChanges
      )
        runtime.localDurabilityPending = false;
      noteRecoveredIfSettled();
    } else if (message.type === "spectra.durable_failed") {
      runtime.failed += 1;
      recordError(message.message ?? "COLLABORATION_DURABLE_FAILED");
    }
  } catch (error) {
    recordError(error);
  }
}

function typeOnce(forceSample = false) {
  if (!runtime) throw new Error("CLASSROOM_LOAD_CLIENT_NOT_STARTED");
  runtime.sequence += 1;
  const sampled =
    forceSample || runtime.sequence % runtime.options.sampleEvery === 0;
  const sampleId = `${runtime.options.runId}:${runtime.options.clientIndex}:${runtime.sequence}`;
  const observerIndex =
    (runtime.options.clientIndex + 1) % runtime.options.clientCount;
  const sentAt = epochNow();
  const started = performance.now();
  runtime.document.transact(
    () => {
      runtime!.writer.insert(runtime!.writer.length, "·");
      if (sampled)
        runtime!.probeMap.set(
          `client:${runtime!.options.clientIndex}:${runtime!.sequence % 3}`,
          {
            sampleId,
            clientIndex: runtime!.options.clientIndex,
            sequence: runtime!.sequence,
            observerIndex,
            sentAt,
          },
        );
    },
    {
      kind: "spectra-region",
      regionId: `classroom-load:${runtime.options.clientIndex}`,
      clientId: runtime.options.clientId,
    },
  );
  const localMs = performance.now() - started;
  runtime.operations += 1;
  if (sampled) {
    if (runtime.localSamples.length >= runtime.options.maxSamples)
      throw new Error("CLASSROOM_LOAD_RAW_SAMPLES_UNBOUNDED");
    runtime.localSamples.push({
      sampleId,
      clientIndex: runtime.options.clientIndex,
      sequence: runtime.sequence,
      localMs,
    });
  }
  return { sampleId, sampled, localMs };
}

function beginTyping(staggerMs = 0) {
  if (
    !runtime ||
    runtime.typingTimer !== null ||
    runtime.typingDelayTimer !== null
  )
    return;
  runtime.typingDelayTimer = window.setTimeout(() => {
    if (!runtime) return;
    runtime.typingDelayTimer = null;
    runtime.typingTimer = window.setInterval(() => {
      try {
        typeOnce();
      } catch (error) {
        recordError(error);
      }
    }, runtime.options.typingIntervalMs);
  }, staggerMs);
}

function stopTyping() {
  if (!runtime) return;
  if (runtime.typingDelayTimer !== null) {
    window.clearTimeout(runtime.typingDelayTimer);
    runtime.typingDelayTimer = null;
  }
  if (runtime.typingTimer !== null) {
    window.clearInterval(runtime.typingTimer);
    runtime.typingTimer = null;
  }
}

async function waitForSettled(timeoutMs = 30_000) {
  if (!runtime) throw new Error("CLASSROOM_LOAD_CLIENT_NOT_STARTED");
  runtime.provider.flushPendingUpdates();
  await waitFor(
    () =>
      Boolean(runtime) &&
      runtime!.provider.synced &&
      !runtime!.provider.hasUnsyncedChanges &&
      runtime!.pendingAcks.size === 0 &&
      !runtime!.localDurabilityPending &&
      runtime!.status === "connected",
    timeoutMs,
    "CLASSROOM_LOAD_CLIENT_SETTLE_TIMEOUT",
  );
  noteRecoveredIfSettled();
}

export async function start(options: StartOptions) {
  if (runtime) throw new Error("CLASSROOM_LOAD_CLIENT_ALREADY_STARTED");
  const document = new Y.Doc();
  if (options.state.initialUpdateBase64)
    Y.applyUpdate(document, bytesFromBase64(options.state.initialUpdateBase64));
  const firstSession = await acquireSession(options);
  if (
    options.expectedRoom &&
    firstSession.documentName !== options.expectedRoom
  )
    throw new Error("CLASSROOM_LOAD_ROOM_MISMATCH");
  const websocket = new HocuspocusProviderWebsocket({
    url: firstSession.url,
    autoConnect: false,
    ...options.reconnect,
  });
  const probeMap = document.getMap(options.state.probeMapName);
  const placeholder = new Y.XmlText();
  const provider = new HocuspocusProvider({
    websocketProvider: websocket,
    name: firstSession.documentName,
    document,
    flushDelay: 0,
    token: async () => {
      if (
        runtime?.session.token &&
        typeof runtime.session.expiresAt === "number" &&
        runtime.session.expiresAt - Date.now() > 120_000
      )
        return runtime.session.token;
      const next = await acquireSession(options);
      if (runtime) runtime.session = next;
      return next.token;
    },
    onStatus: ({ status }) => noteStatus(status),
    onSynced: () => noteRecoveredIfSettled(),
    onStateless: ({ payload }) => onStateless(payload),
    onAuthenticationFailed: ({ reason }) =>
      recordError(`AUTHENTICATION_FAILED:${reason || "unknown"}`),
    onDisconnect: ({ event }) => {
      if (!runtime) return;
      const record: DisconnectRecord = {
        at: epochNow(),
        code: event.code,
        reason: event.reason || "",
        planned: runtime.plannedDisconnect,
        expected:
          runtime.plannedDisconnect || expectedDisconnectReason(event.reason),
      };
      runtime.plannedDisconnect = false;
      if (runtime.disconnects.length < 100) runtime.disconnects.push(record);
      else recordError("CLASSROOM_LOAD_DISCONNECT_RECORDS_UNBOUNDED");
      runtime.activeDisconnect = record;
      // A disconnect discards only the in-memory acknowledgement set. Yjs keeps
      // the local document and re-sends its state-vector delta on reconnect,
      // where it receives a fresh durable pending/ack lifecycle. Waiting for
      // the old socket's updateIds is a SETTLE_TIMEOUT that can never clear.
      runtime.pendingAcks.clear();
    },
  });
  runtime = {
    options,
    document,
    provider,
    websocket,
    session: firstSession,
    writer: placeholder,
    probeMap,
    typingTimer: null,
    typingDelayTimer: null,
    sequence: 0,
    operations: 0,
    localSamples: [],
    remoteSamples: [],
    remoteSampleIds: new Set(),
    pendingAcks: new Map(),
    localDurabilityPending: false,
    acknowledged: 0,
    failed: 0,
    maxPending: 0,
    ackLatencies: [],
    status: "created",
    statusTransitions: [],
    disconnects: [],
    activeDisconnect: null,
    plannedDisconnect: false,
    errors: [],
  };
  document.on("update", (_update, origin) => {
    if (
      !runtime ||
      !origin ||
      typeof origin !== "object" ||
      (origin as { clientId?: unknown }).clientId !== runtime.options.clientId
    )
      return;
    runtime.localDurabilityPending = true;
  });
  probeMap.observe((event) => {
    if (!runtime) return;
    for (const key of event.keysChanged) {
      const value = probeMap.get(key) as Record<string, unknown> | undefined;
      if (
        !value ||
        value.observerIndex !== runtime.options.clientIndex ||
        typeof value.sampleId !== "string" ||
        typeof value.sentAt !== "number" ||
        runtime.remoteSampleIds.has(value.sampleId)
      )
        continue;
      runtime.remoteSampleIds.add(value.sampleId);
      if (runtime.remoteSamples.length >= runtime.options.maxSamples)
        recordError("CLASSROOM_LOAD_REMOTE_SAMPLES_UNBOUNDED");
      else
        runtime.remoteSamples.push({
          sampleId: value.sampleId,
          remoteMs: Math.max(0, epochNow() - value.sentAt),
        });
    }
  });
  provider.attach();
  provider.setAwarenessField("user", {
    clientId: options.clientId,
    name: `Classroom load ${options.clientIndex + 1}`,
    actorKind: "human",
  });
  await websocket.connect();
  await waitFor(
    () => provider.synced && runtime?.status === "connected",
    90_000,
    "CLASSROOM_LOAD_INITIAL_SYNC_TIMEOUT",
  );
  document.transact(
    () => {
      runtime!.writer = findOrCreateWriter(document, options);
    },
    {
      kind: "spectra-region",
      regionId: `classroom-load:${options.clientIndex}`,
      clientId: options.clientId,
    },
  );
  await waitForSettled(90_000);
  return {
    documentName: firstSession.documentName,
    gatewayUrl: firstSession.url,
    level: firstSession.level ?? null,
  };
}

export function startTyping(staggerMs = 0) {
  beginTyping(staggerMs);
}

export function pauseTyping() {
  stopTyping();
}

export async function flush(timeoutMs = 30_000) {
  await waitForSettled(timeoutMs);
}

export async function disconnectAndReconnect(holdMs: number) {
  if (!runtime) throw new Error("CLASSROOM_LOAD_CLIENT_NOT_STARTED");
  const wasTyping =
    runtime.typingTimer !== null || runtime.typingDelayTimer !== null;
  stopTyping();
  runtime.plannedDisconnect = true;
  runtime.websocket.disconnect();
  await waitFor(
    () => Boolean(runtime?.activeDisconnect),
    5_000,
    "CLASSROOM_LOAD_DISCONNECT_NOT_OBSERVED",
  );
  const disconnect = runtime.activeDisconnect!;
  const offline = typeOnce(true);
  await sleep(holdMs);
  await runtime.websocket.connect();
  runtime.provider.forceSync();
  runtime.provider.flushPendingUpdates();
  await waitForSettled();
  if (wasTyping) beginTyping(runtime.options.clientIndex * 5);
  return {
    sampleId: offline.sampleId,
    recoveryMs: disconnect.recoveryMs ?? null,
    offlineEditApplied: true,
    durable:
      runtime.pendingAcks.size === 0 &&
      !runtime.localDurabilityPending &&
      runtime.failed === 0,
  };
}

export function hasRemoteSample(sampleId: string) {
  return runtime?.remoteSampleIds.has(sampleId) ?? false;
}

export async function snapshot() {
  if (!runtime) throw new Error("CLASSROOM_LOAD_CLIENT_NOT_STARTED");
  const update = Y.encodeStateAsUpdate(runtime.document);
  const stateVector = Y.encodeStateVector(runtime.document);
  const sortedAckLatencies = [...runtime.ackLatencies].sort(
    (left, right) => left - right,
  );
  const p95Index = Math.max(0, Math.ceil(sortedAckLatencies.length * 0.95) - 1);
  return {
    index: runtime.options.clientIndex,
    ready: true,
    operations: runtime.operations,
    localSamples: runtime.localSamples,
    remoteSamples: runtime.remoteSamples,
    final: {
      synced:
        runtime.provider.synced &&
        !runtime.provider.hasUnsyncedChanges &&
        runtime.pendingAcks.size === 0 &&
        !runtime.localDurabilityPending &&
        runtime.status === "connected",
      status: runtime.status,
      documentBytes: update.byteLength,
      documentHash: await sha256(update),
      stateVectorHash: await sha256(stateVector),
    },
    durability: {
      acknowledged: runtime.acknowledged,
      failed: runtime.failed,
      pending: runtime.pendingAcks.size,
      maxPending: runtime.maxPending,
      ackP95Ms: sortedAckLatencies.length ? sortedAckLatencies[p95Index] : null,
      ackMaxMs: sortedAckLatencies.length ? sortedAckLatencies.at(-1) : null,
    },
    disconnects: runtime.disconnects,
    statusTransitions: runtime.statusTransitions,
    errors: runtime.errors,
  };
}

export function stop() {
  if (!runtime) return;
  stopTyping();
  runtime.provider.destroy();
  runtime.websocket.destroy();
  runtime.document.destroy();
  runtime = null;
}
