const MANAGEBAC_SECRET_ENV = "MANAGEBAC_CONFIG_SECRET";
const MANAGEBAC_FALLBACK_SECRET_ENVS = ["CLERK_SECRET_KEY", "OPENROUTER_API_KEY", "CONVEX_DEPLOYMENT"] as const;

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
  const secretBytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function fallbackManagebacConfigSecret() {
  if (typeof process === "undefined") return undefined;
  for (const envName of MANAGEBAC_FALLBACK_SECRET_ENVS) {
    const value = process.env[envName]?.trim();
    if (value && value.length >= 16) {
      return value;
    }
  }
  return undefined;
}

function resolveManagebacConfigSecret(secret?: string) {
  const resolved = secret?.trim()
    || (typeof process !== "undefined" ? process.env.MANAGEBAC_CONFIG_SECRET?.trim() : undefined)
    || fallbackManagebacConfigSecret();
  if (!resolved) {
    throw new Error(`${MANAGEBAC_SECRET_ENV} is required for ManageBac token encryption and sync.`);
  }
  if (resolved.length < 16) {
    throw new Error(`${MANAGEBAC_SECRET_ENV} must be at least 16 characters long.`);
  }
  return resolved;
}

export async function encryptManagebacToken(token: string, secret?: string) {
  const key = await deriveKey(resolveManagebacConfigSecret(secret));
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
  const key = await deriveKey(resolveManagebacConfigSecret(secret));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(ivPart) },
    key,
    base64Decode(encryptedPart),
  );
  return new TextDecoder().decode(decrypted);
}
