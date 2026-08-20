import { z } from "zod";

export const BRIDGE_URL = "http://127.0.0.1:47615";
export const BRIDGE_PROTOCOL_VERSION = "1.0";

const healthSchema = z.object({ version: z.string(), paired: z.boolean(), protocolVersion: z.string(), port: z.literal(47615), bindError: z.string().nullable().optional() }).strict();
export type BridgeHealth = z.infer<typeof healthSchema>;
export type BridgeConnectionState = "connected" | "disconnected" | "paused" | "update-required";

export function protocolMajor(value: string) { const parsed = Number(value.split(".")[0]); return Number.isSafeInteger(parsed) ? parsed : null; }

export async function bridgeHealth(signal?: AbortSignal): Promise<BridgeHealth | null> {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/health`, { signal, cache: "no-store" });
    if (!response.ok) return null;
    return healthSchema.parse(await response.json());
  } catch { return null; }
}

export function bridgeConnectionState(health: BridgeHealth | null): BridgeConnectionState {
  if (!health) return "disconnected";
  if (protocolMajor(health.protocolVersion) !== protocolMajor(BRIDGE_PROTOCOL_VERSION)) return "update-required";
  return health.paired ? "connected" : "disconnected";
}

export async function offerPairing(input: { challenge: string; shortCode: string; browserOrigin: string; expiresAt: number }) {
  const response = await fetch(`${BRIDGE_URL}/v1/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(await response.text());
}

export async function pairingStatus(challenge: string) {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/pair/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge }) });
    if (!response.ok) return null;
    return z.object({ paired: z.boolean(), sessionToken: z.string().optional() }).parse(await response.json());
  } catch { return null; }
}
