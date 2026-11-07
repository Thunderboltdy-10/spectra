import { WebSocket, WebSocketServer } from "ws";
import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Carries a run's live events from the worker doing the work to the page that
 * asked for it. A scheduled worker has no connection to the browser, and the
 * durable log is written in batches because every write costs money, so words
 * would otherwise arrive in lumps a few seconds apart.
 *
 * Nothing here is stored. Each run keeps a short window of its recent frames in
 * memory so a page that subscribes a moment late misses nothing. Losing all of
 * it costs only smoothness: the durable log still has the run.
 */

export const RUN_RELAY_PREFIX = "/_spectra/run-relay/";
const PROTOCOL = "spectra-run-relay";
const AUDIENCE = "spectra-run-relay";
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const WINDOW_BYTES = 2 * 1024 * 1024;
/** A run with no publisher and no watcher goes after this long. */
const IDLE_MS = 2 * 60_000;
const PING_MS = 20_000;
/** A long run hands over to a fresh worker: the page stays while that happens. */
const END_GRACE_MS = 8_000;
export const RELAY_END_FRAME = JSON.stringify({ relay: "end" });

const base64url = (value) => Buffer.from(value).toString("base64url");

export function signRunRelayTicket(claims, key) {
  const body = base64url(JSON.stringify({ ...claims, aud: AUDIENCE }));
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function readRunRelayTicket(ticket, key, now = Date.now()) {
  const [body, signature] = String(ticket ?? "").split(".");
  if (!body || !signature || !key) return null;
  const wanted = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (claims.aud !== AUDIENCE || typeof claims.sub !== "string" || !claims.sub) return null;
    if (claims.role !== "publish" && claims.role !== "watch") return null;
    return typeof claims.exp === "number" && claims.exp > now ? claims : null;
  } catch {
    return null;
  }
}

function refuse(socket, status) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * Takes the relay's paths from the HTTP server's upgrade event and hands every
 * other upgrade to whoever was already listening.
 *
 * @param {import("node:http").Server} httpServer
 * @param {{ key: string, now?: () => number, idleMs?: number, windowBytes?: number, endGraceMs?: number }} options
 */
export function installRunRelay(httpServer, { key, now = () => Date.now(), idleMs = IDLE_MS, windowBytes = WINDOW_BYTES, endGraceMs = END_GRACE_MS }) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });
  /** @type {Map<string, { frames: string[], bytes: number, watchers: Set<WebSocket>, publisher: WebSocket | null, ended: boolean, idle: ReturnType<typeof setTimeout> | null }>} */
  const channels = new Map();

  const channelFor = (id) => {
    const existing = channels.get(id);
    if (existing) return existing;
    const created = { frames: [], bytes: 0, watchers: new Set(), publisher: null, ended: false, idle: null, ending: null };
    channels.set(id, created);
    return created;
  };
  const settle = (id, channel) => {
    if (channel.idle) clearTimeout(channel.idle);
    channel.idle = null;
    if (channel.publisher || channel.watchers.size) return;
    channel.idle = setTimeout(() => {
      if (channels.get(id) === channel && !channel.publisher && !channel.watchers.size) channels.delete(id);
    }, idleMs);
    channel.idle.unref?.();
  };

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, PING_MS);
  heartbeat.unref?.();

  const onPublisher = (ws, id) => {
    const channel = channelFor(id);
    // A worker that took over the run replaces the one that lost it.
    if (channel.publisher && channel.publisher.readyState === WebSocket.OPEN) channel.publisher.close(1000, "Replaced");
    channel.publisher = ws;
    channel.ended = false;
    if (channel.ending) clearTimeout(channel.ending);
    channel.ending = null;
    settle(id, channel);
    ws.on("message", (data) => {
      const frame = String(data);
      channel.frames.push(frame);
      channel.bytes += frame.length;
      while (channel.bytes > windowBytes && channel.frames.length > 1) channel.bytes -= channel.frames.shift().length;
      for (const watcher of channel.watchers) if (watcher.readyState === WebSocket.OPEN) watcher.send(frame);
    });
    ws.on("close", () => {
      if (channel.publisher !== ws) return;
      channel.publisher = null;
      channel.ending = setTimeout(() => {
        channel.ending = null;
        channel.ended = true;
        for (const watcher of channel.watchers) {
          if (watcher.readyState !== WebSocket.OPEN) continue;
          watcher.send(RELAY_END_FRAME);
          watcher.close(1000, "Finished");
        }
        settle(id, channel);
      }, endGraceMs);
      channel.ending.unref?.();
    });
  };

  const onWatcher = (ws, id) => {
    const channel = channelFor(id);
    channel.watchers.add(ws);
    settle(id, channel);
    for (const frame of channel.frames) ws.send(frame);
    ws.on("close", () => {
      channel.watchers.delete(ws);
      settle(id, channel);
    });
    if (channel.ended) {
      ws.send(RELAY_END_FRAME);
      ws.close(1000, "Finished");
    }
  };

  const handle = (request, socket, head) => {
    const url = new URL(request.url, "http://relay");
    const role = url.pathname.slice(RUN_RELAY_PREFIX.length);
    if (role !== "publish" && role !== "watch") return refuse(socket, "404 Not Found");
    const offered = String(request.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .find((value) => value !== PROTOCOL);
    const claims = readRunRelayTicket(offered, key, now());
    if (!claims || claims.role !== role) return refuse(socket, "401 Unauthorized");
    // Only a server holding the key can publish, and browsers always send an Origin.
    if (role === "publish" && request.headers.origin) return refuse(socket, "403 Forbidden");
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });
      ws.on("error", () => ws.terminate());
      if (role === "publish") onPublisher(ws, claims.sub);
      else onWatcher(ws, claims.sub);
    });
  };

  const others = httpServer.listeners("upgrade").slice();
  httpServer.removeAllListeners("upgrade");
  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url?.startsWith(RUN_RELAY_PREFIX)) return handle(request, socket, head);
    for (const listener of others) listener.call(httpServer, request, socket, head);
  });

  return {
    channelCount: () => channels.size,
    close() {
      clearInterval(heartbeat);
      for (const channel of channels.values()) {
        if (channel.idle) clearTimeout(channel.idle);
        if (channel.ending) clearTimeout(channel.ending);
      }
      channels.clear();
      for (const socket of wss.clients) socket.close(1012, "Restarting");
      wss.close();
    },
  };
}
