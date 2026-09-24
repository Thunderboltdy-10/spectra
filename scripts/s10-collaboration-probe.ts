/** Browser probe for a coordinator-scheduled S10 slot. Importing it does not connect. */
import * as Y from "yjs";
import { HocuspocusArtifactTransport } from "../src/features/spectra/collaboration/hocuspocus-transport";
import { BoundedYjsLocalPersistence } from "../src/features/spectra/realtime/persistence/local-yjs-persistence";
import { structuredCollection } from "../src/features/spectra/work/models/yjs/structured-adapters";

type Runtime = {
  transport: HocuspocusArtifactTransport;
  persistence: BoundedYjsLocalPersistence;
  unsubscribe: () => void;
  states: Array<{ at: number; state: string; pending: number }>;
  documentRevision: number;
  updateCount: number;
  updateBytes: number;
};
let runtime: Runtime | null = null;

function current() {
  if (!runtime) throw new Error("S10_PROBE_NOT_STARTED");
  return runtime;
}

function fixture() {
  const active = current();
  const title = active.transport.document.getMap("spectra:work-v2:live-meta").get("title");
  if (typeof title !== "string" || !title.startsWith("S10-COLLAB-"))
    throw new Error("S10_PROBE_REQUIRES_DISPOSABLE_FIXTURE_TITLE");
  return active;
}

export async function start(artifactId: string, schemaVersion: number) {
  if (runtime) throw new Error("S10_PROBE_ALREADY_STARTED");
  if (!artifactId || !Number.isSafeInteger(schemaVersion) || schemaVersion <= 0)
    throw new Error("S10_PROBE_FIXTURE_ID_AND_SCHEMA_REQUIRED");
  const transport = new HocuspocusArtifactTransport(artifactId, "root", schemaVersion);
  const persistence = new BoundedYjsLocalPersistence({
    key: `work:${artifactId}:root:sheets:v${schemaVersion}`,
    document: transport.document,
    modelVersion: schemaVersion,
  });
  const states: Runtime["states"] = [];
  const unsubscribe = transport.subscribeSync(() => {
    const state = transport.getSyncSnapshot();
    states.push({ at: Date.now(), state: state.state, pending: state.unsynchronizedChanges });
    if (states.length > 500) states.shift();
    if (state.state === "synchronized" && state.unsynchronizedChanges === 0)
      persistence.markRemoteDurable();
  });
  const active: Runtime = { transport, persistence, unsubscribe, states, documentRevision: 0, updateCount: 0, updateBytes: 0 };
  const onUpdate = (update: Uint8Array) => {
    active.documentRevision += 1;
    active.updateCount += 1;
    active.updateBytes += update.byteLength;
  };
  transport.document.on("update", onUpdate);
  active.unsubscribe = () => {
    unsubscribe();
    transport.document.off("update", onUpdate);
  };
  runtime = active;
  const local = await persistence.initialize();
  if (local.pendingRemoteSync) transport.markLocalRecoveryPending();
  await transport.connect();
  return snapshot();
}

function cellMap(sheetId: string) {
  const sheet = structuredCollection(fixture().transport.document, ["sheets"])?.items.get(sheetId);
  const cells = sheet?.get("cells");
  if (!(cells instanceof Y.Map)) throw new Error("S10_PROBE_SHEET_MISSING");
  return cells;
}

export function cell(sheetId: string, address: string) {
  const value = cellMap(sheetId).get(address);
  return typeof value === "string" ? JSON.parse(value) : value ?? null;
}

/** Native cell-map edit through the real transport, without claiming editor UI evidence. */
export function editCell(sheetId: string, address: string, value: string | null) {
  if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(address)) throw new Error("S10_PROBE_ADDRESS_INVALID");
  const active = fixture();
  const cells = cellMap(sheetId);
  active.transport.transact(`${sheetId}:${address}`, () => {
    if (value === null) cells.delete(address);
    else cells.set(address, JSON.stringify({ ...(cell(sheetId, address) ?? {}), value }));
  });
  return snapshot();
}

export function snapshot() {
  const { transport, persistence, states, documentRevision, updateCount, updateBytes } = current();
  const sheets = structuredCollection(transport.document, ["sheets"]);
  return {
    sync: transport.getSyncSnapshot(),
    local: persistence.getSnapshot(),
    sheets: sheets ? sheets.order.toArray() : [],
    states: [...states],
    documentRevision,
    yjsEvents: { count: updateCount, bytes: updateBytes },
  };
}

/** Full state includes delete sets; equal state vectors alone do not prove convergence. */
export async function fingerprint() {
  const active = current();
  const capturedRevision = active.documentRevision;
  const update = Y.encodeStateAsUpdate(active.transport.document);
  const vector = Y.encodeStateVector(active.transport.document);
  const digest = async (bytes: Uint8Array) => {
    const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  };
  const [documentSha256, vectorSha256] = await Promise.all([digest(update), digest(vector)]);
  return {
    capturedRevision,
    changedDuringCapture: active.documentRevision !== capturedRevision || runtime !== active,
    documentBytes: update.byteLength,
    stateVectorBytes: vector.byteLength,
    documentSha256,
    vectorSha256,
  };
}

/** Chromium's estimate covers the whole page and is not an isolated editor allocation. */
export function heapEstimate() {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  return memory ? {
    sampledAt: Date.now(),
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  } : null;
}

export async function flush() { await current().transport.flush(); return snapshot(); }
export async function saveLocal() { await current().persistence.persistNow(); return snapshot(); }
export function disconnect() { current().transport.disconnect(); return snapshot(); }
export async function reconnect() { await current().transport.retry(); return snapshot(); }
export function close() {
  const { transport, persistence, unsubscribe } = current();
  const flushed = persistence.destroy();
  unsubscribe(); transport.destroy(); runtime = null;
  return flushed;
}
