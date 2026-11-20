/*
 * The secret a desktop sign-in rides on. The app's window makes it and opens
 * the browser with it in the address's fragment, which never reaches a server.
 * Both sides derive the same three things from it: the id the sealed sign-in
 * waits under, the key that seals it, and a short code the person compares.
 */

const PREFIX = "spectra-desktop-sign-in";
/** Where the browser keeps the secret while the person signs in there. */
export const HANDOFF_STORAGE_KEY = "spectra:desktop-sign-in";
export const HANDOFF_FRAGMENT = "s";
export const DESKTOP_SIGN_IN_PATH = "/desktop/sign-in";

function base64url(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(value: string) {
  const text = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

async function sha256(label: string, secret: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${PREFIX}:${label}:${secret}`)));
}

export function newHandoffSecret() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function validHandoffSecret(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export async function handoffId(secret: string) {
  return Array.from(await sha256("id", secret), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Six digits, shown in the app and in the browser, so the person can see they match. */
export async function handoffCode(secret: string) {
  const bytes = await sha256("code", secret);
  const value = ((bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!) % 1_000_000;
  const digits = String(value).padStart(6, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

async function key(secret: string) {
  return crypto.subtle.importKey("raw", await sha256("key", secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealTicket(secret: string, ticket: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(ticket)),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return base64url(out);
}

export async function openTicket(secret: string, sealed: string) {
  const bytes = fromBase64url(sealed);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    await key(secret),
    bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}

export function handoffUrl(origin: string, secret: string) {
  return `${origin.replace(/\/+$/, "")}${DESKTOP_SIGN_IN_PATH}#${HANDOFF_FRAGMENT}=${secret}`;
}
