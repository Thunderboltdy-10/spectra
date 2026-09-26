/** Deterministic request identity shared by trusted Node preparation and the
 * Convex effect. Binary transport encoding does not change the identity. */
type DigestInput = {
  requestDigest?: string;
  append: { update: string | ArrayBuffer; payloadRef?: string; payloadDigest?: string; byteLength?: number };
  [key: string]: unknown;
};

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, sorted(child)]));
}

async function sha256(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
    byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function nativeAiUpdateIdentity(append: DigestInput["append"]) {
  const bytes = typeof append.update === "string"
    ? Uint8Array.from(atob(append.update), character => character.charCodeAt(0)) : new Uint8Array(append.update);
  if (append.payloadRef) {
    if (bytes.byteLength || !/^[a-f0-9]{64}$/.test(append.payloadDigest ?? "") ||
        !Number.isSafeInteger(append.byteLength) || append.byteLength! < 1)
      throw new Error("AI_NATIVE_UPDATE_INVALID");
    return { updateDigest: append.payloadDigest!, byteLength: append.byteLength! };
  }
  if (append.payloadDigest !== undefined || append.byteLength !== undefined)
    throw new Error("AI_NATIVE_UPDATE_INVALID");
  if (!bytes.byteLength) throw new Error("AI_NATIVE_UPDATE_INVALID");
  return { updateDigest: await sha256(bytes), byteLength: bytes.byteLength };
}

export async function nativeAiRequestDigest(input: DigestInput) {
  const { requestDigest: _requestDigest, append, ...request } = input;
  const { update: _update, ...descriptor } = append;
  const identity = await nativeAiUpdateIdentity(append);
  return sha256(new TextEncoder().encode(JSON.stringify(sorted({ ...request, append: { ...descriptor, ...identity } }))));
}
