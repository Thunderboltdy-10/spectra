const DEFAULT_SECRET = "managebac-dev-secret";

function base64Encode(bytes: Uint8Array) {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function base64Decode(value: string) {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function deriveKey(secret: string) {
  const secretBytes = new TextEncoder().encode(secret || DEFAULT_SECRET);
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptManagebacToken(token: string, secret?: string) {
  const key = await deriveKey(secret ?? DEFAULT_SECRET);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );
  return `${base64Encode(iv)}.${base64Encode(new Uint8Array(encrypted))}`;
}

export async function decryptManagebacToken(payload: string, secret?: string) {
  const [ivPart, encryptedPart] = payload.split(".");
  if (!ivPart || !encryptedPart) {
    throw new Error("Invalid ManageBac token payload");
  }
  const key = await deriveKey(secret ?? DEFAULT_SECRET);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(ivPart) },
    key,
    base64Decode(encryptedPart),
  );
  return new TextDecoder().decode(decrypted);
}
