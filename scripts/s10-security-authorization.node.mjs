import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCollaborationAuthorizationGuard } from "./collaboration-persist.mjs";

function fixture(authorize = async () => ({ allowed: true, canModify: true })) {
  let time = 1_000;
  const calls = [];
  const context = { authorizationCheckedAt: time, canModify: true };
  const connection = { context };
  const guard = createCollaborationAuthorizationGuard({
    authorize,
    now: () => time,
    closeConnection: (peer, code) => calls.push({ peer, code }),
  });
  guard.watch(connection);
  return { guard, context, connection, calls, at: value => { time = value; } };
}

test("a sweep cannot renew an expired grant before its timer callback runs", async () => {
  const f = fixture();
  try {
    f.at(16_000);
    await assert.rejects(f.guard.refresh(f.context), /AUTHORIZATION_UNAVAILABLE/);
    assert.equal(f.context.authorizationCheckedAt, 1_000);
    assert.equal(f.context.canModify, false);
    assert.deepEqual(f.calls, [{ peer: f.connection, code: 1013 }]);
  } finally { f.guard.dispose(); }
});

test("an in-flight successful response cannot renew past the prior hard deadline", async () => {
  let reply;
  const response = new Promise(resolve => { reply = resolve; });
  const f = fixture(() => response);
  try {
    f.at(15_999);
    const refresh = f.guard.refresh(f.context);
    f.at(16_000);
    reply({ allowed: true, canModify: true });
    await assert.rejects(refresh, /AUTHORIZATION_UNAVAILABLE/);
    assert.equal(f.context.authorizationCheckedAt, 1_000);
    assert.deepEqual(f.calls, [{ peer: f.connection, code: 1013 }]);
  } finally { f.guard.dispose(); }
});

test("a definitive denial closes only the affected connection", async () => {
  const f = fixture(async () => ({ allowed: false }));
  const other = { context: { authorizationCheckedAt: 1_000, canModify: true } };
  f.guard.watch(other);
  try {
    await assert.rejects(f.guard.refresh(f.context), /ACCESS_REVOKED/);
    assert.deepEqual(f.calls, [{ peer: f.connection, code: 4403 }]);
    assert.equal(await f.guard.require(other.context), other.context);
    assert.equal(other.context.canModify, true);
  } finally { f.guard.dispose(); }
});

test("brief transient failure preserves only the remaining last-success lease", async () => {
  const f = fixture(async () => { throw new Error("fetch failed"); });
  try {
    f.at(10_000);
    assert.equal(await f.guard.refresh(f.context), f.context);
    assert.equal(f.context.authorizationCheckedAt, 1_000);
    f.at(16_000);
    await assert.rejects(f.guard.require(f.context), /AUTHORIZATION_UNAVAILABLE/);
    assert.deepEqual(f.calls, [{ peer: f.connection, code: 1013 }]);
  } finally { f.guard.dispose(); }
});

test("the real message hook rejects a queued edit that expires while waiting", async () => {
  const source = readFileSync(new URL("./collaboration-gateway.mjs", import.meta.url), "utf8");
  const start = source.indexOf("  async beforeHandleMessage({");
  const end = source.indexOf("  async afterHandleMessage(", start);
  assert(start >= 0 && end > start);
  const f = fixture();
  let enqueues = 0;
  const rejected = [];
  const hook = new Function(
    "reauthorize", "extractYjsUpdate", "acquireDocumentMessage",
    "isNativeArtifactDocument", "canonicalDurableUpdate", "messageQueue",
    "releaseDocumentMessage", "rejectPeerUpdate", "process",
    `const shuttingDown = false; return ({${source.slice(start, end)}}).beforeHandleMessage;`,
  )(
    context => f.guard.require(context),
    () => new Uint8Array([1]),
    async () => { f.at(16_000); },
    () => false,
    () => null,
    () => ({ push: () => { enqueues++; } }),
    () => {},
    (_connection, reason) => rejected.push(reason),
    { stderr: { write: () => {} } },
  );
  try {
    await assert.rejects(hook({ context: f.context, document: {}, update: new Uint8Array([1]), socketId: "fixture", connection: f.connection }), /AUTHORIZATION_UNAVAILABLE/);
    assert.equal(enqueues, 0);
    assert.equal(rejected.length, 1);
  } finally { f.guard.dispose(); }
});

test("the real connected hook expires a quiet socket while the real policy sweep hangs", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const source = readFileSync(new URL("./collaboration-gateway.mjs", import.meta.url), "utf8");
  const activeConnections = new Set();
  const closed = [];
  const context = { artifactId: "fixture", partitionKey: "root", authorizationCheckedAt: 1_000, canModify: true };
  const connection = { context, document: {}, onClose: () => {}, webSocket: { close: code => closed.push(code) } };
  const guard = createCollaborationAuthorizationGuard({
    authorize: () => new Promise(() => {}),
    closeConnection: (peer, code) => { activeConnections.delete(peer); peer.webSocket.close(code); },
  });
  const connectedStart = source.indexOf("  async connected({ connection })");
  const connectedEnd = source.indexOf("  async beforeHandleMessage(", connectedStart);
  const sweepStart = source.indexOf("async function enforceActivePolicyVersions()");
  const sweepEnd = source.indexOf("const policySweep =", sweepStart);
  assert(connectedStart >= 0 && connectedEnd > connectedStart && sweepStart >= 0 && sweepEnd > sweepStart);
  const connected = new Function("reauthorize", "activeConnections", "authorizationGuard",
    "openDocuments", "durableHeadKey", "catchUpCanonicalRoom", "forceCanonicalReconnect", "collaborationFailureMessage",
    `return ({${source.slice(connectedStart, connectedEnd)}}).connected;`)(
    value => guard.require(value), activeConnections, guard,
    new Map(), () => "fixture-room", async () => {}, () => {}, String,
  );
  const sweep = new Function("activeConnections", "bridge", "refreshAuthorization",
    `let policySweepRunning = false; ${source.slice(sweepStart, sweepEnd)} return enforceActivePolicyVersions;`)(
    activeConnections, () => new Promise(() => {}), value => guard.refresh(value),
  );
  try {
    await connected({ connection });
    void sweep();
    t.mock.timers.tick(14_999);
    assert.equal(activeConnections.has(connection), true);
    assert.deepEqual(closed, []);
    t.mock.timers.tick(1);
    assert.equal(activeConnections.has(connection), false);
    assert.deepEqual(closed, [1013]);
    await assert.rejects(guard.require(context), /AUTHORIZATION_UNAVAILABLE/);
  } finally { guard.dispose(); }
});

test("a hanging refresh is coalesced, times out, and its late reply cannot extend access", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  let reply;
  let requests = 0;
  const response = new Promise(resolve => { reply = resolve; });
  const context = { authorizationCheckedAt: 1_000, canModify: true };
  const closed = [];
  const guard = createCollaborationAuthorizationGuard({
    authorize: () => { requests++; return response; },
    closeConnection: (_connection, code) => closed.push(code),
  });
  guard.watch({ context });
  try {
    const first = guard.refresh(context);
    const second = guard.refresh(context);
    await Promise.resolve();
    assert.equal(requests, 1);
    t.mock.timers.tick(5_000);
    // A timeout may use the still-fresh prior lease, without renewing it.
    await Promise.all([first, second]);
    assert.equal(context.authorizationCheckedAt, 1_000);
    reply({ allowed: true, canModify: true });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(context.authorizationCheckedAt, 1_000);
    t.mock.timers.tick(10_000);
    assert.deepEqual(closed, [1013]);
    await assert.rejects(guard.require(context), /AUTHORIZATION_UNAVAILABLE/);
  } finally { guard.dispose(); }
});
