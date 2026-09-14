/**
 * Load `.env.local` for the collaboration gateway with the same secret
 * surface Next uses. Strips CRLF / trailing whitespace from values so a
 * Windows-edited env file cannot desync JWT / bridge HMAC verification.
 *
 * Port/host keys from the file are ignored unless `applyFilePorts` is true —
 * Live web often binds collab on :1234 while an instance `.env.local` still
 * carries SPECTRA_COLLAB_PORT=3001. Prefer an already-exported
 * SPECTRA_COLLAB_PORT (e.g. SPECTRA_COLLAB_PORT=1234), else leave unset so the
 * gateway defaults to 1234.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "./local/stack-config.mjs";

const EXAMPLE_CONVEX = /example\.convex\.cloud/i;

/** Keys the Live process owns; never clobber a non-empty process export. */
const PROCESS_OWNED_KEYS = new Set([
  "SPECTRA_COLLAB_PORT",
  "SPECTRA_COLLAB_HOST",
  "SPECTRA_WEB_PORT",
]);

/** Always take these from `.env.local` so shell exports cannot desync JWT/HMAC. */
const FORCE_FILE_KEYS = new Set([
  "SPECTRA_COLLAB_TOKEN_SECRET",
  "SPECTRA_COLLAB_BRIDGE_KEY",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_URL",
]);

export function stripEnvValue(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim();
}

/** Stable short fingerprint for logs — never the secret itself. */
export function secretFingerprint(value, prefixLength = 12) {
  const normalized = stripEnvValue(value);
  if (!normalized) return "missing";
  return createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, prefixLength);
}

/**
 * @param {string} [envPath]
 * @param {NodeJS.ProcessEnv} [target]
 * @param {{ applyFilePorts?: boolean }} [options]
 */
export function loadCollaborationEnv(
  envPath = resolve(process.cwd(), ".env.local"),
  target = process.env,
  options = {},
) {
  const applyFilePorts = options.applyFilePorts === true;
  if (!existsSync(envPath)) {
    throw new Error(
      `COLLABORATION_ENV_MISSING: ${envPath} not found. Copy .env.local.example and set SPECTRA_COLLAB_TOKEN_SECRET + SPECTRA_COLLAB_BRIDGE_KEY to match the Next process.`,
    );
  }

  /** @type {Record<string, string>} */
  const preservedOwned = {};
  for (const key of PROCESS_OWNED_KEYS) {
    const current = stripEnvValue(target[key]);
    if (current) preservedOwned[key] = current;
  }

  const parsed = parseEnv(readFileSync(envPath, "utf8"));
  for (const [key, raw] of Object.entries(parsed)) {
    const value = stripEnvValue(raw);
    if (!value) continue;
    if (PROCESS_OWNED_KEYS.has(key) && !applyFilePorts) continue;
    if (
      FORCE_FILE_KEYS.has(key) ||
      !(key in target) ||
      target[key] === undefined ||
      target[key] === ""
    ) {
      target[key] = value;
    }
  }

  // Prefer already-exported port/host over anything the file may have applied.
  for (const [key, value] of Object.entries(preservedOwned)) {
    target[key] = value;
  }

  const token = stripEnvValue(target.SPECTRA_COLLAB_TOKEN_SECRET);
  const bridge = stripEnvValue(target.SPECTRA_COLLAB_BRIDGE_KEY);
  const convexUrl = stripEnvValue(
    target.NEXT_PUBLIC_CONVEX_URL || target.CONVEX_URL,
  );

  if (!token || token.length < 32) {
    throw new Error(
      "COLLABORATION_TOKEN_CONFIG_MISSING: Set SPECTRA_COLLAB_TOKEN_SECRET (≥32 chars) in .env.local to match Next.",
    );
  }
  if (!bridge || bridge.length < 32) {
    throw new Error(
      "COLLABORATION_BRIDGE_CONFIG_MISSING: Set SPECTRA_COLLAB_BRIDGE_KEY (≥32 chars) in .env.local.",
    );
  }
  if (!convexUrl) {
    throw new Error(
      "COLLABORATION_CONVEX_URL_MISSING: Set NEXT_PUBLIC_CONVEX_URL in .env.local.",
    );
  }
  if (EXAMPLE_CONVEX.test(convexUrl)) {
    throw new Error(
      "COLLABORATION_CONVEX_URL_EXAMPLE: Refusing example.convex.cloud. Point NEXT_PUBLIC_CONVEX_URL at the live local/cloud deployment used by Next.",
    );
  }

  target.SPECTRA_COLLAB_TOKEN_SECRET = token;
  target.SPECTRA_COLLAB_BRIDGE_KEY = bridge;
  if (!target.NEXT_PUBLIC_CONVEX_URL) target.NEXT_PUBLIC_CONVEX_URL = convexUrl;
  if (!target.CONVEX_URL) target.CONVEX_URL = convexUrl;

  const bindPort = stripEnvValue(target.SPECTRA_COLLAB_PORT) || "1234";
  return {
    envPath,
    tokenSecretLength: token.length,
    bridgeKeyLength: bridge.length,
    tokenFingerprint: secretFingerprint(token),
    bridgeFingerprint: secretFingerprint(bridge),
    convexUrl,
    bindPort,
  };
}
