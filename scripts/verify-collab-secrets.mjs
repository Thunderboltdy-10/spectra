#!/usr/bin/env node
/**
 * Compare Next (.env.local / process) collab secrets against the gateway env
 * surface. Prints fingerprints only — never secret values.
 *
 *   node scripts/verify-collab-secrets.mjs
 *   SPECTRA_COLLAB_PORT=1234 node scripts/verify-collab-secrets.mjs
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  loadCollaborationEnv,
  secretFingerprint,
  stripEnvValue,
} from "./load-collaboration-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env.local");

const nextEnv = { ...process.env };
const gatewayEnv = { ...process.env };

// Simulate Next: --env-file=.env.local fills empty keys including ports.
loadCollaborationEnv(envPath, nextEnv, { applyFilePorts: true });
// The supported gateway uses the same environment precedence, including ports.
loadCollaborationEnv(envPath, gatewayEnv);
if (!stripEnvValue(gatewayEnv.SPECTRA_COLLAB_PORT)) {
  gatewayEnv.SPECTRA_COLLAB_PORT = stripEnvValue(process.env.SPECTRA_COLLAB_PORT) || "1234";
}

const nextToken = nextEnv.SPECTRA_COLLAB_TOKEN_SECRET;
const gwToken = gatewayEnv.SPECTRA_COLLAB_TOKEN_SECRET;
const nextBridge = nextEnv.SPECTRA_COLLAB_BRIDGE_KEY;
const gwBridge = gatewayEnv.SPECTRA_COLLAB_BRIDGE_KEY;

const nextTokenFp = secretFingerprint(nextToken);
const gwTokenFp = secretFingerprint(gwToken);
const nextBridgeFp = secretFingerprint(nextBridge);
const gwBridgeFp = secretFingerprint(gwBridge);

const tokenMatch = nextToken && nextToken === gwToken;
const bridgeMatch = nextBridge && nextBridge === gwBridge;
const nextPort = stripEnvValue(nextEnv.SPECTRA_COLLAB_PORT) || "(unset→1234)";
const gwPort = stripEnvValue(gatewayEnv.SPECTRA_COLLAB_PORT) || "1234";

process.stdout.write(
  [
    `verify-collab-secrets`,
    `  env: ${envPath}`,
    `  tokenFp next=${nextTokenFp} gateway=${gwTokenFp} match=${tokenMatch}`,
    `  bridgeFp next=${nextBridgeFp} gateway=${gwBridgeFp} match=${bridgeMatch}`,
    `  port next=${nextPort} gateway=${gwPort}`,
    `  tokenLen next=${nextToken.length} gateway=${gwToken.length}`,
    "",
  ].join("\n"),
);

if (!tokenMatch || !bridgeMatch) {
  process.stderr.write(
    "COLLABORATION_SECRET_MISMATCH: Next and gateway would not share SPECTRA_COLLAB_* secrets. Start gateway via: SPECTRA_COLLAB_PORT=1234 node scripts/serve-collaboration-gateway.mjs\n",
  );
  process.exit(1);
}

process.stdout.write("ok: secrets match\n");
