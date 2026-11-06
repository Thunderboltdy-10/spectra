import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

/*
 * Connects Spectra's server to the Bridge on the user's own computer.
 *
 * A deployed server cannot reach 127.0.0.1, and a computer at home accepts no
 * incoming connections. So both dial out to here. The Bridge keeps one control
 * socket open for its account. When the server wants a CLI session it connects
 * with a ticket for that account; the hub asks the account's newest Bridge to
 * open a pipe, and from then on passes frames both ways without reading them.
 *
 * Nothing is stored and no frame is inspected. Rooms never touch this.
 */

export const AGENT_HUB_PREFIX = "/_spectra/agent-hub/";
const PROTOCOL = "spectra-agent";
/** Provider frames can carry whole documents. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const PIPE_WAIT_MS = 8_000;
const PING_MS = 20_000;
/** Frames the server sends before the pipe exists. */
const MAX_WAITING_FRAMES = 64;
export const NO_BRIDGE_CLOSE = 4404;
export const PIPE_TIMEOUT_CLOSE = 4408;

const base64url = (value) => Buffer.from(value).toString("base64url");

export function signAgentHubTicket(claims, key) {
  const body = base64url(JSON.stringify({ ...claims, aud: "spectra-agent-hub" }));
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function readAgentHubTicket(ticket, key, now = Date.now()) {
  const [body, signature] = String(ticket ?? "").split(".");
  if (!body || !signature || !key) return null;
  const wanted = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (claims.aud !== "spectra-agent-hub" || typeof claims.sub !== "string" || !claims.sub) return null;
    return typeof claims.exp === "number" && claims.exp > now ? claims : null;
  } catch {
    return null;
  }
}

function offeredTicket(request) {
  const offered = String(request.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((value) => value.trim());
  return offered.find((value) => value !== PROTOCOL) ?? null;
}

function refuse(socket, status) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function forward(from, to) {
  from.on("message", (data, isBinary) => {
    if (to.readyState === WebSocket.OPEN) to.send(data, { binary: isBinary });
  });
}

/**
 * Takes the hub's paths from the HTTP server's upgrade event and hands every
 * other upgrade to whoever was already listening.
 *
 * @param {import("node:http").Server} httpServer
 * @param {{ serverKey: string, bridgeKey: string, now?: () => number, pipeWaitMs?: number }} options
 */
export function installAgentHub(httpServer, { serverKey, bridgeKey, now = () => Date.now(), pipeWaitMs = PIPE_WAIT_MS }) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });
  /** @type {Map<string, Set<WebSocket>>} */
  const bridges = new Map();
  /** @type {Map<string, { server: WebSocket, waiting: Array<[unknown, boolean]>, timer: ReturnType<typeof setTimeout> }>} */
  const pending = new Map();

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

  const accept = (request, socket, head, then) =>
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });
      ws.on("error", () => ws.terminate());
      then(ws);
    });

  const onBridge = (ws, accountId) => {
    const set = bridges.get(accountId) ?? new Set();
    set.add(ws);
    bridges.set(accountId, set);
    ws.on("close", () => {
      set.delete(ws);
      if (!set.size && bridges.get(accountId) === set) bridges.delete(accountId);
    });
  };

  const onServer = (ws, accountId, provider) => {
    const newest = [...(bridges.get(accountId) ?? [])].at(-1);
    if (!newest || newest.readyState !== WebSocket.OPEN) {
      ws.close(NO_BRIDGE_CLOSE, "The Bridge is not connected");
      return;
    }
    const sid = randomBytes(24).toString("base64url");
    const session = {
      server: ws,
      waiting: [],
      timer: setTimeout(() => {
        pending.delete(sid);
        ws.close(PIPE_TIMEOUT_CLOSE, "The Bridge did not answer");
      }, pipeWaitMs),
    };
    pending.set(sid, session);
    const hold = (data, isBinary) => {
      if (session.waiting.length >= MAX_WAITING_FRAMES) ws.close(1009, "Too many frames before the Bridge answered");
      else session.waiting.push([data, isBinary]);
    };
    ws.on("message", hold);
    session.hold = hold;
    ws.on("close", () => {
      if (!pending.delete(sid)) return;
      clearTimeout(session.timer);
    });
    newest.send(JSON.stringify({ open: sid, provider }));
  };

  const onPipe = (ws, sid) => {
    const session = pending.get(sid);
    if (!session) {
      ws.close(PIPE_TIMEOUT_CLOSE, "That session has gone");
      return;
    }
    pending.delete(sid);
    clearTimeout(session.timer);
    const { server, waiting, hold } = session;
    server.off("message", hold);
    for (const [data, isBinary] of waiting) ws.send(data, { binary: isBinary });
    forward(server, ws);
    forward(ws, server);
    server.on("close", () => ws.close());
    ws.on("close", () => {
      if (server.readyState === WebSocket.OPEN) server.close();
    });
  };

  const handle = (request, socket, head) => {
    // Browsers always send an Origin. Only the Bridge and the server belong here.
    if (request.headers.origin) return refuse(socket, "403 Forbidden");
    const url = new URL(request.url, "http://hub");
    const role = url.pathname.slice(AGENT_HUB_PREFIX.length);
    if (role === "pipe") {
      // The session id was given only to the account's own Bridge.
      const sid = url.searchParams.get("sid");
      if (!sid || !pending.has(sid)) return refuse(socket, "404 Not Found");
      return accept(request, socket, head, (ws) => onPipe(ws, sid));
    }
    if (role === "bridge") {
      const claims = readAgentHubTicket(offeredTicket(request), bridgeKey, now());
      if (!claims) return refuse(socket, "401 Unauthorized");
      return accept(request, socket, head, (ws) => onBridge(ws, claims.sub));
    }
    if (role === "server") {
      const provider = url.searchParams.get("provider");
      if (provider !== "codex" && provider !== "claude") return refuse(socket, "400 Bad Request");
      const claims = readAgentHubTicket(offeredTicket(request), serverKey, now());
      if (!claims) return refuse(socket, "401 Unauthorized");
      return accept(request, socket, head, (ws) => onServer(ws, claims.sub, provider));
    }
    return refuse(socket, "404 Not Found");
  };

  const others = httpServer.listeners("upgrade").slice();
  httpServer.removeAllListeners("upgrade");
  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url?.startsWith(AGENT_HUB_PREFIX)) return handle(request, socket, head);
    for (const listener of others) listener.call(httpServer, request, socket, head);
  });

  return {
    bridgeConnected: (accountId) => bridges.has(accountId),
    close() {
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.close(1012, "Restarting");
      wss.close();
    },
  };
}
