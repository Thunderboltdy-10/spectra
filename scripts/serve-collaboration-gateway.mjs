#!/usr/bin/env node
/**
 * Supported gateway entry: load the same environment as the web process.
 * Existing exports win over .env.local, including secrets and host/port.
 * The local stack selects its instance file with --env-file <path>.
 * Use --supervise to recover this launcher's own child after it exits.
 * Occupied addresses are refused; stop the owning launcher before restarting.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadCollaborationEnv } from "./load-collaboration-env.mjs";
import { gatewayBinding, runGatewayProcess } from "./collaboration-gateway-process.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function serveCollaborationGateway({
  args = process.argv.slice(2),
  environment = process.env,
  root = repositoryRoot,
  runtime = process,
  runGateway = runGatewayProcess,
} = {}) {
  let envPath = resolve(root, ".env.local");
  let supervise = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--supervise") supervise = true;
    else if (arg === "--env-file" && args[index + 1] && !args[index + 1].startsWith("--")) {
      envPath = resolve(root, args[++index]);
      if (!existsSync(envPath)) throw new Error(`Collaboration env file not found: ${envPath}`);
    } else if (arg === "--force") {
      throw new Error("--force is no longer supported. Stop the owning launcher explicitly; existing listeners are never stopped or reused.");
    } else throw new Error(`Unknown or incomplete gateway option: ${arg}`);
  }
  const loaded = loadCollaborationEnv(envPath, environment);
  const binding = gatewayBinding(environment);
  runtime.stdout.write(
    `Spectra collab env: ${loaded.envPath} convex=${loaded.convexUrl} bind=${binding.host}:${binding.port} tokenFp=${loaded.tokenFingerprint} bridgeFp=${loaded.bridgeFingerprint} tokenLen=${loaded.tokenSecretLength} bridgeLen=${loaded.bridgeKeyLength}\n`,
  );
  environment.SPECTRA_COLLAB_SERVED_BY = "serve-collaboration-gateway.mjs";
  return runGateway({
    entry: resolve(root, "scripts", "collaboration-gateway.mjs"),
    cwd: root,
    environment,
    supervise,
    runtime,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveCollaborationGateway().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
