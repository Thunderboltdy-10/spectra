/**
 * Load `.env.local` for the collaboration gateway with the same secret
 * surface Next uses. The parser handles CRLF file delimiters; supplied secret
 * bytes are preserved because Next's signer uses them without trimming.
 *
 * Like the web start path, existing environment values win and the file fills
 * missing values, including host/port. The local stack supplies its selected
 * instance environment; a root file must never replace that instance's keys.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const EXAMPLE_CONVEX = /example\.convex\.cloud/i;
const SECRET_KEYS = new Set(["SPECTRA_COLLAB_TOKEN_SECRET", "SPECTRA_COLLAB_BRIDGE_KEY"]);

/** Optional compatibility switch for callers deliberately ignoring file ports. */
const PROCESS_OWNED_KEYS = new Set([
  "SPECTRA_COLLAB_PORT",
  "SPECTRA_COLLAB_HOST",
  "SPECTRA_WEB_PORT",
]);

export function stripEnvValue(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim();
}

/** Stable short fingerprint for logs — never the secret itself. */
export function secretFingerprint(value, prefixLength = 12) {
  const secret = String(value ?? "");
  if (!secret) return "missing";
  return createHash("sha256")
    .update(secret, "utf8")
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
  const applyFilePorts = options.applyFilePorts !== false;
  // Capture the supplied deployment before a file can fill the other URL alias.
  const suppliedConvexUrl = stripEnvValue(target.NEXT_PUBLIC_CONVEX_URL) ||
    stripEnvValue(target.CONVEX_URL);
  const parsed = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  for (const [key, raw] of Object.entries(parsed)) {
    const value = SECRET_KEYS.has(key) ? String(raw) : stripEnvValue(raw);
    if (!value) continue;
    if (PROCESS_OWNED_KEYS.has(key) && !applyFilePorts) continue;
    if (target[key] === undefined) {
      target[key] = value;
    }
  }

  for (const key of PROCESS_OWNED_KEYS) {
    if (target[key] !== undefined) target[key] = stripEnvValue(target[key]);
  }

  const token = String(target.SPECTRA_COLLAB_TOKEN_SECRET ?? "");
  const bridge = String(target.SPECTRA_COLLAB_BRIDGE_KEY ?? "");
  const convexUrl = suppliedConvexUrl || stripEnvValue(target.NEXT_PUBLIC_CONVEX_URL) ||
    stripEnvValue(target.CONVEX_URL);

  if (stripEnvValue(token).length < 32) {
    throw new Error(
      "COLLABORATION_TOKEN_CONFIG_MISSING: Supply SPECTRA_COLLAB_TOKEN_SECRET (≥32 chars) in the environment or selected env file to match Next.",
    );
  }
  if (stripEnvValue(bridge).length < 32) {
    throw new Error(
      "COLLABORATION_BRIDGE_CONFIG_MISSING: Supply SPECTRA_COLLAB_BRIDGE_KEY (≥32 chars) in the environment or selected env file to match Next.",
    );
  }
  if (!convexUrl) {
    throw new Error(
      "COLLABORATION_CONVEX_URL_MISSING: Supply NEXT_PUBLIC_CONVEX_URL in the environment or selected env file.",
    );
  }
  if (EXAMPLE_CONVEX.test(convexUrl)) {
    throw new Error(
      "COLLABORATION_CONVEX_URL_EXAMPLE: Refusing example.convex.cloud. Point NEXT_PUBLIC_CONVEX_URL at the live local/cloud deployment used by Next.",
    );
  }

  target.SPECTRA_COLLAB_TOKEN_SECRET = token;
  target.SPECTRA_COLLAB_BRIDGE_KEY = bridge;
  target.NEXT_PUBLIC_CONVEX_URL = convexUrl;
  target.CONVEX_URL = convexUrl;

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
