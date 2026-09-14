/**
 * Load `.env.local` for the collaboration gateway with the same secret
 * surface Next uses. Strips CRLF / trailing whitespace from values so a
 * Windows-edited env file cannot desync JWT / bridge HMAC verification.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "./local/stack-config.mjs";

const EXAMPLE_CONVEX = /example\.convex\.cloud/i;

export function stripEnvValue(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim();
}

/**
 * @param {string} [envPath]
 * @param {NodeJS.ProcessEnv} [target]
 */
export function loadCollaborationEnv(
  envPath = resolve(process.cwd(), ".env.local"),
  target = process.env,
) {
  if (!existsSync(envPath)) {
    throw new Error(
      `COLLABORATION_ENV_MISSING: ${envPath} not found. Copy .env.local.example and set SPECTRA_COLLAB_TOKEN_SECRET + SPECTRA_COLLAB_BRIDGE_KEY to match the Next process.`,
    );
  }
  const parsed = parseEnv(readFileSync(envPath, "utf8"));
  for (const [key, raw] of Object.entries(parsed)) {
    const value = stripEnvValue(raw);
    if (!value) continue;
    // Always prefer .env.local for collab secrets so a shell export cannot
    // silently desync Next (:3040) from the gateway.
    if (
      key === "SPECTRA_COLLAB_TOKEN_SECRET" ||
      key === "SPECTRA_COLLAB_BRIDGE_KEY" ||
      key === "NEXT_PUBLIC_CONVEX_URL" ||
      key === "CONVEX_URL" ||
      !(key in target) ||
      target[key] === undefined ||
      target[key] === ""
    ) {
      target[key] = value;
    }
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

  return {
    envPath,
    tokenSecretLength: token.length,
    bridgeKeyLength: bridge.length,
    convexUrl,
  };
}
