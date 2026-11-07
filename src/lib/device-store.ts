import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

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
  const body = Buffer.from(
    JSON.stringify({ sub: accountId, exp: Date.now() + TICKET_MS, aud: "spectra-agent-hub" }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

function relayToken() {
  const base = process.env.LOCALAPPDATA || process.env.HOME || "";
  try {
    return readFileSync(join(base, "Spectra", "agent-relay.token"), "utf8").trim();
  } catch {
    throw new Error("DEVICE_STORE_UNAVAILABLE: Spectra Bridge isn't running on this computer.");
  }
}

/** How the AI's live connection reaches a room on the person's computer. */
export function deviceRoomEndpoint(accountId: string) {
  const hub = hubUrl();
  if (!hub) return { url: `${LOCAL_BRIDGE}/v1/rooms`, token: relayToken(), protocols: undefined };
  return {
    url: `${hub}/_spectra/agent-hub/server?provider=rooms`,
    token: "hub",
    protocols: ["spectra-agent", hubTicket(accountId)],
  };
}

export async function deviceStoreCall<T = unknown>(
  accountId: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<T> {
  const hub = hubUrl();
  const socket = hub
    ? new WebSocket(`${hub}/_spectra/agent-hub/server?provider=store`, ["spectra-agent", hubTicket(accountId)])
    : new WebSocket(`${LOCAL_BRIDGE}/v1/store`, ["spectra-agent", relayToken()]);
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
    }, timeoutMs);
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
