/** Offline reproductions of launch blockers; does not launch/connect a runtime. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as Y from "yjs";
import { BoundedYjsLocalPersistence, MemoryYjsStore } from "../src/features/spectra/realtime/persistence/local-yjs-persistence";
import { COLLABORATION_AUTHORIZE_CACHE_MS, isTransientCollaborationFailure } from "./collaboration-persist.mjs";

const gateway = readFileSync("scripts/collaboration-gateway.mjs", "utf8");
const authCode = gateway.slice(gateway.indexOf("async function refreshAuthorization("), gateway.indexOf("const server = new Server("));
const sweepCode = gateway.slice(gateway.indexOf("async function enforceActivePolicyVersions("), gateway.indexOf("const policySweep ="));
function authorization(bridge: () => Promise<unknown>) {
  return new Function("bridge", "isTransientCollaborationFailure", "COLLABORATION_AUTHORIZE_CACHE_MS", "forceCanonicalReconnect", "process",
    `${authCode}; return {refreshAuthorization, reauthorize};`)(bridge, isTransientCollaborationFailure,
      COLLABORATION_AUTHORIZE_CACHE_MS, () => undefined, { stderr: { write: () => undefined } });
}
const context = () => ({ artifactId: "disposable", partitionKey: "root", accountId: "fixture-actor",
  policyVersion: 0, canModify: true, authorizationCheckedAt: Date.now() - 3_600_000,
  expiresAt: Math.floor(Date.now() / 1000) - 60 });

async function staleAuthorization() {
  const stale = context();
  const auth = authorization(async () => { throw new Error("fetch failed"); });
  const granted = await auth.refreshAuthorization(stale);
  assert.equal(granted.canModify, true);
  const hanging = authorization(() => new Promise(() => undefined));
  const staleDuringHang = context();
  const hangGranted = await hanging.reauthorize(staleDuringHang, { allowStale: true });
  assert.equal(hangGranted.canModify, true);
  const closeCalls: unknown[] = [];
  let actorRefreshes = 0;
  const connections = new Set([{ context: context(), sendStateless: () => undefined,
    webSocket: { close: (...args: unknown[]) => closeCalls.push(args) } }]);
  const sweep = new Function("bridge", "activeConnections", "refreshAuthorization",
    `let policySweepRunning = false; ${sweepCode}; return enforceActivePolicyVersions;`)(
      async () => { throw new Error("fetch failed"); }, connections,
      async () => { actorRefreshes += 1; throw new Error("fetch failed"); });
  await sweep();
  assert.equal(closeCalls.length, 0);
  assert.equal(actorRefreshes, 0);
  assert.equal(connections.size, 1);
  return {
    reproduced: true,
    grantAgeMs: Date.now() - stale.authorizationCheckedAt,
    transientFailureKeptModify: granted.canModify,
    hangingRefreshKeptModify: hangGranted.canModify,
    policyOutageActorRefreshes: actorRefreshes,
    expiredQuietConnectionClosed: closeCalls.length > 0,
    desiredSafeOutcomeSatisfied: false,
  };
}

async function seed(store: MemoryYjsStore, key: string) {
  const doc = new Y.Doc(); doc.getMap("draft").set("baseline", true);
  const update = Y.encodeStateAsUpdate(doc);
  await store.put({ key, update, bytes: update.byteLength, updatedAt: 1, lastOpenedAt: 1,
    pendingRemoteSync: false, modelVersion: 1 });
  doc.destroy();
}
async function tab(store: MemoryYjsStore, key: string, maxWorks = 24) {
  const document = new Y.Doc();
  const persistence = new BoundedYjsLocalPersistence({ key, document, modelVersion: 1, store, maxWorks, debounceMs: 60_000 });
  await persistence.initialize();
  return { document, persistence };
}
async function storedDraft(store: MemoryYjsStore, key: string) {
  const stored = await store.get(key);
  if (!stored) return null;
  const doc = new Y.Doc(); Y.applyUpdate(doc, stored.update);
  const draft = doc.getMap("draft").toJSON(); doc.destroy();
  return { draft, pendingRemoteSync: stored.pendingRemoteSync };
}

async function overwritePending(ackSecondTab: boolean) {
  const store = new MemoryYjsStore(); const key = `two-tabs:${ackSecondTab}`;
  await seed(store, key);
  const a = await tab(store, key); const b = await tab(store, key);
  a.document.getMap("draft").set("offline-a", "must survive");
  b.document.getMap("draft").set("tab-b", "separate change");
  await a.persistence.persistNow();
  if (ackSecondTab) b.persistence.markRemoteDurable();
  await b.persistence.persistNow();
  const stored = await storedDraft(store, key);
  assert(stored);
  assert.equal(stored.draft["offline-a"], undefined);
  assert.equal(stored.draft["tab-b"], "separate change");
  assert.equal(stored.pendingRemoteSync, !ackSecondTab);
  await a.persistence.destroy(); await b.persistence.destroy();
  a.document.destroy(); b.document.destroy();
  return { reproduced: true, ackSecondTab, offlineARecovered: false,
    storedPendingRemoteSync: stored.pendingRemoteSync, desiredSafeOutcomeSatisfied: false };
}

async function evictionRace() {
  const store = new MemoryYjsStore(); const victim = "eviction-victim";
  await seed(store, victim);
  const a = await tab(store, victim); const b = await tab(store, "new-work", 1);
  const originalList = store.listMeta.bind(store);
  let raced = false;
  store.listMeta = async () => {
    const records = await originalList();
    if (!raced) {
      raced = true;
      a.document.getMap("draft").set("offline-a", "must survive eviction");
      await a.persistence.persistNow();
      assert.equal((await store.get(victim))?.pendingRemoteSync, true);
    }
    return records;
  };
  b.document.getMap("draft").set("tab-b", "new work");
  await b.persistence.persistNow();
  const missing = (await store.get(victim)) === null;
  assert.equal(missing, true);
  const localState = a.persistence.getSnapshot().state;
  assert.equal(localState, "local_only");
  await a.persistence.destroy(); await b.persistence.destroy();
  a.document.destroy(); b.document.destroy();
  return { reproduced: true, victimBecamePendingAfterMetadataRead: raced,
    pendingVictimDeleted: missing, victimTabStillReports: localState, desiredSafeOutcomeSatisfied: false };
}

async function main() {
  const evidence = {
    observedAt: new Date().toISOString(),
    mode: "offline actual gateway handlers + real local persistence with deterministic MemoryYjsStore interleavings",
    gatewaySha256: createHash("sha256").update(gateway).digest("hex"),
    persistenceSha256: createHash("sha256").update(readFileSync("src/features/spectra/realtime/persistence/local-yjs-persistence.ts")).digest("hex"),
    staleAuthorization: await staleAuthorization(),
    pendingOverwrite: await overwritePending(false),
    acknowledgedOverwrite: await overwritePending(true),
    evictionRace: await evictionRace(),
  };
  const output = process.argv[2] ?? ".spectra-local/launch-audit/evidence/S10-COLLAB/blockers-repro.json";
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
