import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexQuery } from "./convex-server";
import { getConvexUrl } from "./env";

/** A machine token alone never authorizes another student's local connection. */
export class AccountMismatchError extends Error {
  constructor() {
    super("DEVICE_STORE_UNAVAILABLE: Spectra Bridge on this computer is connected to a different Spectra account. Reconnect it in Devices.");
    this.name = "AccountMismatchError";
  }
}

export async function localBridgeRelay(accountId?: string, timeoutMs = 2_500) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = () => new Error("DEVICE_STORE_UNAVAILABLE: Spectra Bridge cannot verify this account's connection on this computer. Update or reconnect your Bridge.");
  const notRunning = () => new Error("DEVICE_STORE_UNAVAILABLE: Spectra Bridge isn't running on this computer. Open it from the Start menu.");
  // A Bridge paired to someone else is running: say so, so the person reconnects it instead of restarting it.
  const otherAccount = () => new AccountMismatchError();
  try {
    return await Promise.race([
      (async () => {
        const base = process.env.LOCALAPPDATA || process.env.HOME || "";
        let token: string;
        let response: Response;
        try {
          token = readFileSync(join(base, "Spectra", "agent-relay.token"), "utf8").trim();
          response = await fetch("http://127.0.0.1:47615/v1/agent/identity", {
            headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
          });
        } catch {
          throw notRunning();
        }
        if (!response.ok) throw unavailable();
        const identity = await response.json() as { deviceId?: unknown; generation?: unknown; accountId?: unknown; deployment?: unknown };
        if (typeof identity.deviceId !== "string" || !identity.deviceId || typeof identity.generation !== "string" || !identity.generation) throw unavailable();
        if (typeof identity.accountId !== "string" || !identity.accountId || typeof identity.deployment !== "string"
          || identity.deployment.replace(/\/+$/, "") !== getConvexUrl().replace(/\/+$/, "")) throw unavailable();
        const owner = await convexQuery<{ deviceId: string }, string | null>("bridge:localRelayAccount", { deviceId: identity.deviceId });
        if (!owner || owner !== identity.accountId) throw unavailable();
        if (accountId !== undefined && accountId !== owner) throw otherAccount();
        return { token, accountId: owner, query: `deviceId=${encodeURIComponent(identity.deviceId)}&generation=${encodeURIComponent(identity.generation)}` };
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(notRunning()); }, timeoutMs); }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DEVICE_STORE_UNAVAILABLE")) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}
