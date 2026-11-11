import { agentHubTicket } from "../../shared/agent-hub-ticket.mjs";
import WebSocket from "ws";
import { localBridgeRelay } from "./local-bridge-relay";

/*
 * The server's way to the work kept on someone's computer: straight to Bridge
 * when they run on the same machine, through the hub when the server is hosted.
 */

const LOCAL_BRIDGE = "ws://127.0.0.1:47615";
const TICKET_MS = 60_000;
const CALL_TIMEOUT_MS = 20_000;

const hubUrl = () => process.env.SPECTRA_AGENT_HUB_URL?.trim().replace(/\/$/, "") || null;

function hubTicket(accountId: string) {
  const secret = process.env.SPECTRA_COLLAB_TOKEN_SECRET?.trim();
  if (!secret) throw new Error("DEVICE_STORE_UNAVAILABLE: Spectra Bridge can't be reached from this server.");
  return agentHubTicket(accountId, secret, TICKET_MS);
}

/** How the AI's live connection reaches a room on the person's computer. */
export async function deviceRoomEndpoint(accountId: string) {
  const hub = hubUrl();
  if (!hub) {
    const relay = await localBridgeRelay(accountId);
    return { url: `${LOCAL_BRIDGE}/v1/rooms?${relay.query}`, token: relay.token, protocols: undefined };
  }
  return {
    url: `${hub}/_spectra/agent-hub/server?provider=rooms`,
    token: "hub",
    protocols: ["spectra-agent", await hubTicket(accountId)],
  };
}

export async function deviceStoreCall<T = unknown>(
  accountId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<T> {
  const hub = hubUrl();
  const started = Date.now();
  const relay = hub ? null : await localBridgeRelay(accountId, Math.min(timeoutMs, 2_500));
  const ticket = hub ? await hubTicket(accountId) : null;
  const socket = hub
    ? new WebSocket(`${hub}/_spectra/agent-hub/server?provider=store`, ["spectra-agent", ticket!])
    : new WebSocket(`${LOCAL_BRIDGE}/v1/store?${relay!.query}`, ["spectra-agent", relay!.token]);
  return new Promise<T>((resolve, reject) => {
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      socket.close();
      settle();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error("DEVICE_STORE_UNAVAILABLE: Spectra Bridge didn't answer.")));
    }, Math.max(1, timeoutMs - (Date.now() - started)));
    socket.on("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.on("message", (data) => {
      try {
        const reply = JSON.parse(String(data)) as { result?: T; error?: string };
        finish(() => (reply.error ? reject(new Error(reply.error)) : resolve(reply.result as T)));
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
    socket.on("error", () =>
      finish(() => reject(new Error("DEVICE_STORE_UNAVAILABLE: Spectra Bridge isn't reachable."))),
    );
    socket.on("close", (code) =>
      finish(() => reject(new Error(`DEVICE_STORE_UNAVAILABLE: Spectra Bridge closed the connection (${code}).`))),
    );
  });
}

/** This computer's store, if Bridge answers quickly. Work never waits on it for long. */
export async function reachableDeviceStore(accountId: string) {
  try {
    const summary = await deviceStoreCall<{ storeId?: string }>(accountId, "summary", {}, 2_500);
    return summary.storeId ?? null;
  } catch {
    return null;
  }
}
