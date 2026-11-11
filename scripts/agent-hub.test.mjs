import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { NO_BRIDGE_CLOSE, PIPE_TIMEOUT_CLOSE, installAgentHub, readAgentHubTicket, signAgentHubTicket } from "./agent-hub.mjs";

const serverKey = "s".repeat(40);
const bridgeKey = "b".repeat(40);
const soon = () => Date.now() + 60_000;
const opened = [];

async function hub(options = {}) {
  const http = createServer();
  const rooms = new WebSocketServer({ noServer: true });
  const roomUpgrades = [];
  http.on("upgrade", (request, socket, head) => {
    roomUpgrades.push(request.url);
    rooms.handleUpgrade(request, socket, head, (ws) => ws.close());
  });
  const installed = installAgentHub(http, { serverKey, bridgeKey, ...options });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const { port } = http.address();
  const url = `ws://127.0.0.1:${port}/_spectra/agent-hub`;
  opened.push(() => {
    installed.close();
    http.close();
  });
  return { url, port, installed, roomUpgrades };
}

function connect(url, ticket, headers) {
  const socket = new WebSocket(url, ticket ? ["spectra-agent", ticket] : ["spectra-agent"], { headers });
  // Ending a socket still connecting emits an error nobody is waiting for.
  socket.on("error", () => undefined);
  opened.push(() => socket.terminate());
  return socket;
}

const nextFrame = (socket) => once(socket, "message").then(([data]) => String(data));
const closed = (socket) => once(socket, "close").then(([code]) => code);
const refused = (socket) =>
  new Promise((resolve) => socket.on("unexpected-response", (_request, response) => resolve(response.statusCode)));

afterEach(() => {
  for (const close of opened.splice(0)) close();
});

describe("agent hub tickets", () => {
  it("accepts its own and refuses forged, expired or other keys", async () => {
    const ticket = await signAgentHubTicket({ sub: "acct", exp: soon() }, serverKey);
    expect(readAgentHubTicket(ticket, serverKey)?.sub).toBe("acct");
    expect(readAgentHubTicket(ticket, bridgeKey)).toBeNull();
    expect(readAgentHubTicket(await signAgentHubTicket({ sub: "acct", exp: Date.now() - 1 }, serverKey), serverKey)).toBeNull();
    expect(readAgentHubTicket(`${ticket}x`, serverKey)).toBeNull();
    expect(readAgentHubTicket("nonsense", serverKey)).toBeNull();
  });
});

describe("agent hub", () => {
  it("pipes the server to the account's Bridge and keeps frames sent before the pipe opened", async () => {
    const { url } = await hub();
    const control = connect(`${url}/bridge`, await signAgentHubTicket({ sub: "acct", exp: soon() }, bridgeKey));
    await once(control, "open");
    const server = connect(`${url}/server?provider=codex`, await signAgentHubTicket({ sub: "acct", exp: soon() }, serverKey));
    const asked = nextFrame(control);
    await once(server, "open");
    server.send("early");
    const { open, provider } = JSON.parse(await asked);
    expect(provider).toBe("codex");
    const pipe = connect(`${url}/pipe?sid=${open}`);
    const first = nextFrame(pipe);
    await once(pipe, "open");
    expect(await first).toBe("early");
    const reply = nextFrame(server);
    pipe.send("from the cli");
    expect(await reply).toBe("from the cli");
    const ended = closed(pipe);
    server.close();
    await ended;
  });

  it("says so when the account has no Bridge, and never reaches another account's", async () => {
    const { url } = await hub();
    const control = connect(`${url}/bridge`, await signAgentHubTicket({ sub: "someone-else", exp: soon() }, bridgeKey));
    await once(control, "open");
    const server = connect(`${url}/server?provider=claude`, await signAgentHubTicket({ sub: "acct", exp: soon() }, serverKey));
    expect(await closed(server)).toBe(NO_BRIDGE_CLOSE);
  });

  it("gives up when the Bridge does not answer", async () => {
    const { url } = await hub({ pipeWaitMs: 30 });
    const control = connect(`${url}/bridge`, await signAgentHubTicket({ sub: "acct", exp: soon() }, bridgeKey));
    await once(control, "open");
    const server = connect(`${url}/server?provider=codex`, await signAgentHubTicket({ sub: "acct", exp: soon() }, serverKey));
    expect(await closed(server)).toBe(PIPE_TIMEOUT_CLOSE);
  });

  it("refuses browsers, wrong keys, unknown pipes, and unknown providers", async () => {
    const { url } = await hub();
    const ticket = await signAgentHubTicket({ sub: "acct", exp: soon() }, serverKey);
    expect(await refused(connect(`${url}/server?provider=codex`, ticket, { Origin: "https://example.com" }))).toBe(403);
    expect(await refused(connect(`${url}/bridge`, ticket))).toBe(401);
    expect(await refused(connect(`${url}/pipe?sid=nope`))).toBe(404);
    expect(await refused(connect(`${url}/server?provider=gemini`, ticket))).toBe(400);
  });

  it("leaves every other upgrade to the rooms", async () => {
    const { port, roomUpgrades } = await hub();
    const room = connect(`ws://127.0.0.1:${port}/some-room`);
    await closed(room);
    expect(roomUpgrades).toEqual(["/some-room"]);
  });
});
