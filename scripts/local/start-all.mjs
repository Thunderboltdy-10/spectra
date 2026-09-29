import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeBridgeReadiness } from "./readiness.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const runtimeRoot = resolve(
  repositoryRoot,
  String(process.env.SPECTRA_LOCAL_ROOT ?? ".spectra-local").trim() || ".spectra-local",
);
const defaultBridgePort = 47615;
const defaultTimeoutSeconds = 900;

function parseArguments(argv) {
  const options = {
    instance: 1,
    mode: "development",
    timeoutSeconds: defaultTimeoutSeconds,
    bridge: true,
    buildBridge: false,
    bridgeDataDir: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--no-bridge") {
      options.bridge = false;
      continue;
    }
    if (token === "--build-bridge") {
      options.buildBridge = true;
      continue;
    }
    const match = /^(--instance|--mode|--timeout-seconds|--bridge-data-dir)=(.*)$/.exec(
      token,
    );
    if (match) {
      applyOption(options, match[1], match[2]);
      continue;
    }
    if (["--instance", "--mode", "--timeout-seconds", "--bridge-data-dir"].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${token}.`);
      }
      applyOption(options, token, value);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isSafeInteger(options.instance) || options.instance < 1 || options.instance > 1000) {
    throw new Error("--instance must be a positive integer between 1 and 1000.");
  }
  if (!["development", "production"].includes(options.mode)) {
    throw new Error('--mode must be "development" or "production".');
  }
  if (!Number.isSafeInteger(options.timeoutSeconds) || options.timeoutSeconds < 5) {
    throw new Error("--timeout-seconds must be an integer of at least 5.");
  }
  return options;
}

function applyOption(options, name, value) {
  switch (name) {
    case "--instance":
      options.instance = Number(value);
      break;
    case "--mode":
      options.mode = String(value).trim();
      break;
    case "--timeout-seconds":
      options.timeoutSeconds = Number(value);
      break;
    case "--bridge-data-dir":
      options.bridgeDataDir = String(value).trim();
      break;
    default:
      throw new Error(`Unsupported option ${name}.`);
  }
}

function printHelp() {
  process.stdout.write(`Spectra local launcher\n\n` +
    `Starts the local Convex deployment, collaboration gateway, Next server and Bridge.\n\n` +
    `Usage: node scripts/local/start-all.mjs [options]\n\n` +
    `  --instance <id>             Local stack instance (default: 1)\n` +
    `  --mode <development|production>  Server mode (default: development)\n` +
    `  --timeout-seconds <n>       Readiness timeout (default: 900)\n` +
    `  --bridge-data-dir <path>    Bridge journal directory\n` +
    `  --no-bridge                 Start only the local web stack\n` +
    `  --build-bridge              Build the release Bridge if it is missing\n` +
    `  --help                      Show this help\n`);
}

function defaultPorts(instance) {
  const blockStart = 3000 + (instance - 1) * 20;
  return {
    web: blockStart,
    collaboration: blockStart + 1,
    convexCloud: blockStart + 2,
    convexSite: blockStart + 3,
  };
}

async function readInstance(instance) {
  const instanceRoot = resolve(runtimeRoot, "instances", String(instance));
  const manifestPath = resolve(instanceRoot, "instance.json");
  let manifest = null;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  }
  return {
    instanceRoot,
    runtimeStatePath: resolve(instanceRoot, "runtime.json"),
    convexConfig: resolve(instanceRoot, "project", ".convex", "local", "default", "config.json"),
    ports: manifest?.ports ?? defaultPorts(instance),
  };
}

function chooseNode() {
  const candidates = process.platform === "win32"
    ? [resolve(runtimeRoot, "launch-audit", "node-runtime", "node-v24.20.0-win-x64", "node.exe")]
    : [];
  return candidates.find((candidate) => existsSync(candidate)) ?? process.execPath;
}

function bridgeExecutable() {
  return resolve(
    repositoryRoot,
    "bridge",
    "target",
    "release",
    process.platform === "win32" ? "spectra-bridge.exe" : "spectra-bridge",
  );
}

async function isPortOccupied(port) {
  return new Promise((resolveResult) => {
    const server = createServer();
    server.once("error", () => resolveResult(true));
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.close(() => resolveResult(false));
    });
  });
}

async function fetchJson(url, timeoutMs = 4_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.trim();
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function readRuntimeState(instance) {
  try {
    return JSON.parse(await readFile(instance.runtimeStatePath, "utf8"));
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stackReadiness(ports) {
  const [convex, web, gateway] = await Promise.all([
    fetchJson(`http://127.0.0.1:${ports.convexCloud}/instance_name`),
    fetchJson(`http://localhost:${ports.web}/api/health`),
    fetchJson(`http://127.0.0.1:${ports.collaboration}/_spectra/health`),
  ]);
  const convexName = typeof convex.body === "string" ? convex.body.trim() : "";
  const ready = Boolean(
    convex.ok && typeof convex.body === "string" && convex.body.trim() &&
      web.ok && web.body?.service === "spectra-web" && web.body?.status === "ready" &&
      gateway.ok && gateway.body?.service === "spectra-collaboration-gateway" && gateway.body?.status === "ready",
  );
  return {
    ready,
    convexName,
    webStatus: web.body?.status ?? `HTTP ${web.status || "unavailable"}`,
    gatewayStatus: gateway.body?.status ?? `HTTP ${gateway.status || "unavailable"}`,
  };
}

async function stackIsReady(ports) {
  return (await stackReadiness(ports)).ready;
}

async function bridgeStatus(bridgeOrigin = `http://127.0.0.1:${defaultBridgePort}`) {
  const probe = await probeBridgeReadiness(bridgeOrigin);
  return { ok: probe.status === "ready", body: probe.body };
}

function startDetached(label, executable, args, cwd, environment, logDirectory) {
  const stdoutPath = resolve(logDirectory, `${label}.stdout.log`);
  const stderrPath = resolve(logDirectory, `${label}.stderr.log`);
  const stdout = requireFileHandle(stdoutPath, "a");
  const stderr = requireFileHandle(stderrPath, "a");
  const child = spawn(executable, args, {
    cwd,
    env: environment,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  });
  child.unref();
  return { pid: child.pid, stdoutPath, stderrPath };
}

// First-time project selection needs the caller's terminal, before detaching.
async function configureFreshInstance(node, stackScript, instanceId, instance) {
  if (existsSync(instance.convexConfig)) return;
  await new Promise((resolveConfiguration, rejectConfiguration) => {
    const child = spawn(node, [stackScript, "configure", "--instance", String(instanceId)], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectConfiguration);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        rejectConfiguration(new Error(
          `Local Convex configuration stopped with ${signal ?? `code ${code}`}. ` +
          "Run this launcher in an interactive terminal, or set both " +
          "SPECTRA_LOCAL_CONVEX_TEAM and SPECTRA_LOCAL_CONVEX_PROJECT in the instance env.local.",
        ));
      } else if (!existsSync(instance.convexConfig)) {
        rejectConfiguration(new Error("Local Convex configuration finished without saving a deployment; refusing to detach an unconfigured stack."));
      } else {
        resolveConfiguration();
      }
    });
  });
}

function requireFileHandle(path, flags) {
  return openSync(path, flags);
}

async function runBridgeBuild() {
  const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
  await new Promise((resolveResult, reject) => {
    const child = spawn(cargo, ["build", "--release", "--manifest-path", resolve(repositoryRoot, "bridge", "Cargo.toml")], {
      cwd: repositoryRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveResult() : reject(new Error(`Bridge build exited with code ${code}.`)));
  });
}

async function waitFor(label, probe, timeoutSeconds, stopOnExitPid = null) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastNotice = 0;
  while (Date.now() < deadline) {
    if (stopOnExitPid && !processIsAlive(stopOnExitPid)) {
      throw new Error(`${label} launcher stopped. Check the local stack logs.`);
    }
    if (await probe()) return;
    if (Date.now() - lastNotice > 15_000) {
      process.stdout.write(`Waiting for ${label}...\n`);
      lastNotice = Date.now();
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`${label} did not become ready within ${timeoutSeconds} seconds.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const node = chooseNode();
  const instance = await readInstance(options.instance);
  const logDirectory = resolve(instance.instanceRoot, "logs");
  await mkdir(logDirectory, { recursive: true });
  const ports = instance.ports;
  const webOrigin = `http://localhost:${ports.web}`;
  const convexUrl = `http://127.0.0.1:${ports.convexCloud}`;
  const existingState = await readRuntimeState(instance);
  const existingStack = await stackIsReady(ports);

  let stackPid = existingState?.launcherPid;
  const stackStdoutPath = resolve(logDirectory, "start-all-stack.stdout.log");
  const stackStderrPath = resolve(logDirectory, "start-all-stack.stderr.log");
  if (!existingStack && !processIsAlive(stackPid)) {
    await configureFreshInstance(node, resolve(repositoryRoot, "scripts", "local", "stack.mjs"), options.instance, instance);
    const stack = startDetached(
      "start-all-stack",
      node,
      [resolve(repositoryRoot, "scripts", "local", "stack.mjs"), "start", "--instance", String(options.instance), "--mode", options.mode],
      repositoryRoot,
      { ...process.env },
      logDirectory,
    );
    stackPid = stack.pid;
    process.stdout.write(`Started local stack (PID ${stack.pid}). Startup progress: ${stackStdoutPath}\nErrors: ${stackStderrPath}\n`);
  } else if (existingStack) {
    process.stdout.write("Local stack is already ready; reusing it.\n");
  } else {
    process.stdout.write(`Local stack is starting already (PID ${stackPid}); waiting for it.\n`);
  }

  try {
    await waitFor("Convex, collaboration gateway and web server", () => stackIsReady(ports), options.timeoutSeconds, stackPid);
  } catch (error) {
    const status = await stackReadiness(ports);
    throw new Error(`${error instanceof Error ? error.message : String(error)} Convex: ${status.convexName || "unavailable"}; web: ${status.webStatus}; gateway: ${status.gatewayStatus}. Startup log: ${stackStdoutPath}; errors: ${stackStderrPath}`);
  }
  const stackReady = await stackReadiness(ports);
  process.stdout.write(
    `Local stack ready.\n` +
      `  Convex ready: ${stackReady.convexName}\n` +
      `  Web ready:    ${webOrigin}\n` +
      `  Gateway ready: http://127.0.0.1:${ports.collaboration}\n`,
  );

  if (!options.bridge) {
    process.stdout.write("Bridge startup skipped (--no-bridge).\n");
    return;
  }

  const existingBridge = await bridgeStatus();
  if (existingBridge.ok && !existingBridge.body?.bind_error) {
    const detail = existingBridge.body?.paired ? "paired" : "listening (pairing required)";
    process.stdout.write(`Bridge is already running (${detail}); reusing it.\n`);
    return;
  }
  if (await isPortOccupied(defaultBridgePort)) {
    throw new Error(`Port ${defaultBridgePort} is occupied, but it is not a healthy Spectra Bridge. Refusing to start a duplicate.`);
  }

  const executable = bridgeExecutable();
  if (!existsSync(executable)) {
    if (!options.buildBridge) {
      throw new Error(`Bridge executable is missing at ${executable}. Run this launcher with --build-bridge once, or build bridge/Cargo.toml with cargo.`);
    }
    process.stdout.write("Bridge executable is missing; building the release Bridge...\n");
    await runBridgeBuild();
  }

  const bridgeDataDir = options.bridgeDataDir
    ? (isAbsolute(options.bridgeDataDir) ? options.bridgeDataDir : resolve(repositoryRoot, options.bridgeDataDir))
    : resolve(instance.instanceRoot, "bridge");
  await mkdir(bridgeDataDir, { recursive: true });
  const bridgeEnvironment = {
    ...process.env,
    SPECTRA_CONVEX_URL: convexUrl,
    SPECTRA_ORIGINS: `${webOrigin},http://127.0.0.1:${ports.web}`,
    SPECTRA_BRIDGE_DATA_DIR: bridgeDataDir,
  };
  const bridge = startDetached(
    "start-all-bridge",
    executable,
    [],
    resolve(repositoryRoot, "bridge"),
    bridgeEnvironment,
    logDirectory,
  );
  process.stdout.write(`Started Bridge (PID ${bridge.pid}).\n`);
  await waitFor("Bridge", async () => {
    const status = await bridgeStatus();
    return status.ok && !status.body?.bind_error;
  }, options.timeoutSeconds, bridge.pid);
  const ready = await bridgeStatus();
  process.stdout.write(`Bridge ready: ${ready.body?.paired ? "paired" : "listening; pair it from Settings → Files and devices"}.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { bridgeStatus, configureFreshInstance, defaultPorts, parseArguments, stackIsReady, stackReadiness };
