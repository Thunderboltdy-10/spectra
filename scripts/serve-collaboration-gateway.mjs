#!/usr/bin/env node
/**
 * Live / local recipe: start the Spectra collaboration gateway with secrets
 * loaded from `.env.local` (CRLF-safe), matching the Next process that mints
 * collab JWTs.
 *
 * One-liner (from repo root, same tree as web):
 *   node scripts/serve-collaboration-gateway.mjs
 *
 * Supervise + auto-restart (dev):
 *   node scripts/serve-collaboration-gateway.mjs --supervise
 *
 * Matched Live pair (example ports):
 *   Next web on :3040  →  npm run dev:web   (loads .env.local)
 *   Gateway            →  node scripts/serve-collaboration-gateway.mjs
 * Both must share SPECTRA_COLLAB_TOKEN_SECRET + SPECTRA_COLLAB_BRIDGE_KEY.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadCollaborationEnv } from "./load-collaboration-env.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const supervise = process.argv.includes("--supervise");

const loaded = loadCollaborationEnv(resolve(repositoryRoot, ".env.local"));
process.stdout.write(
  `Spectra collab env: ${loaded.envPath} convex=${loaded.convexUrl} tokenLen=${loaded.tokenSecretLength} bridgeLen=${loaded.bridgeKeyLength}\n`,
);

const entry = supervise
  ? resolve(scriptDirectory, "dev-collaboration-gateway.mjs")
  : resolve(scriptDirectory, "collaboration-gateway.mjs");

const child = spawn(process.execPath, [entry], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}
