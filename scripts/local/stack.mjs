import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INSTANCE_SCHEMA_VERSION,
  LOCAL_CONVEX_BACKEND_STARTUP_TIMEOUT_SECS,
  convexEnvFrom,
  derivedInstanceEnv,
  isFatalServiceExit,
  localConvexProjectPackage,
  normalizeInstanceId,
  parseEnv,
  portsForInstance,
  savedBackendArguments,
  serializeEnv,
  upsertEnv,
  validateRequiredEnv,
  withLocalConvexCliEnv,
} from "./stack-config.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const nextCli = resolve(
  repositoryRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const convexCli = resolve(
  repositoryRoot,
  "node_modules",
  "convex",
  "bin",
  "main.js",
);
const defaultRuntimeRoot = resolve(repositoryRoot, ".spectra-local");
const LOCAL_CONVEX_READY_TIMEOUT_MS =
  LOCAL_CONVEX_BACKEND_STARTUP_TIMEOUT_SECS * 1000;

function parseArguments(argv) {
  const result = { command: argv[0] ?? "start", values: {}, flags: new Set() };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--"))
      throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === "yes") {
      result.flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for --${name}.`);
    result.values[name] = value;
    index += 1;
  }
  return result;
}

function runtimeRootFrom(environment) {
  const configured = String(environment.SPECTRA_LOCAL_ROOT ?? "").trim();
  return configured ? resolve(repositoryRoot, configured) : defaultRuntimeRoot;
}

function assertInside(parent, target) {
  const child = relative(resolve(parent), resolve(target));
  if (
    !child ||
    child.startsWith(`..${sep}`) ||
    child === ".." ||
    isAbsolute(child)
  ) {
    throw new Error(`Refusing to operate outside ${resolve(parent)}.`);
  }
}

function instancePaths(instanceId, environment) {
  const runtimeRoot = runtimeRootFrom(environment);
  const instanceRoot = resolve(runtimeRoot, "instances", String(instanceId));
  assertInside(runtimeRoot, instanceRoot);
  const projectRoot = resolve(instanceRoot, "project");
  return {
    runtimeRoot,
    instanceRoot,
    projectRoot,
    projectPackage: resolve(projectRoot, "package.json"),
    manifest: resolve(instanceRoot, "instance.json"),
    appEnv: resolve(instanceRoot, "env.local"),
    convexEnv: resolve(instanceRoot, "convex.env"),
    projectEnv: resolve(projectRoot, ".env.local"),
    convexState: resolve(projectRoot, ".convex"),
    convexConfig: resolve(
      projectRoot,
      ".convex",
      "local",
      "default",
      "config.json",
    ),
    runtimeState: resolve(instanceRoot, "runtime.json"),
  };
}

async function loadManifest(paths) {
  if (!existsSync(paths.manifest)) return null;
  const parsed = JSON.parse(await readFile(paths.manifest, "utf8"));
  if (parsed.schemaVersion !== INSTANCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported instance manifest at ${paths.manifest}.`);
  }
  return parsed;
}

function numericOption(value, fallback, label) {
  if (value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed))
    throw new Error(`${label} must be an integer.`);
  return parsed;
}

async function ensureInstance(instanceId, options, environment) {
  const paths = instancePaths(instanceId, environment);
  await mkdir(paths.projectRoot, { recursive: true });
  const current = await loadManifest(paths);
  let template;
  if (existsSync(paths.appEnv)) {
    template = await readFile(paths.appEnv, "utf8");
  } else {
    const explicitSource = options.values["source-env"]
      ? resolve(repositoryRoot, options.values["source-env"])
      : null;
    const source =
      explicitSource ??
      (existsSync(resolve(repositoryRoot, ".env.local"))
        ? resolve(repositoryRoot, ".env.local")
        : resolve(repositoryRoot, ".env.local.example"));
    if (!existsSync(source)) {
      throw new Error(`No local environment template exists at ${source}.`);
    }
    template = await readFile(source, "utf8");
  }
  const templateEnv = parseEnv(template);
  const configuredBase =
    options.values["port-base"] ??
    environment.SPECTRA_LOCAL_PORT_BASE ??
    templateEnv.SPECTRA_LOCAL_PORT_BASE;
  const configuredStride =
    options.values["port-stride"] ??
    environment.SPECTRA_LOCAL_PORT_STRIDE ??
    templateEnv.SPECTRA_LOCAL_PORT_STRIDE;
  const hasExplicitPortMapping =
    String(configuredBase ?? "").trim() ||
    String(configuredStride ?? "").trim();
  const requestedPorts =
    current && !hasExplicitPortMapping
      ? current.ports
      : portsForInstance(instanceId, {
          base: numericOption(configuredBase, 3000, "Port base"),
          stride: numericOption(configuredStride, 20, "Port stride"),
        });
  const ports = current?.ports ?? requestedPorts;
  if (current && JSON.stringify(ports) !== JSON.stringify(requestedPorts)) {
    throw new Error(
      `Instance ${instanceId} already uses port block ${ports.blockStart}. ` +
        "Reset it before changing --port-base or --port-stride.",
    );
  }

  const envText = upsertEnv(template, derivedInstanceEnv(instanceId, ports));
  await writeFile(paths.appEnv, envText, { encoding: "utf8", mode: 0o600 });

  const functionsPath = relative(
    paths.projectRoot,
    resolve(repositoryRoot, "convex"),
  )
    .split(sep)
    .join("/");
  await writeFile(
    resolve(paths.projectRoot, "convex.json"),
    `${JSON.stringify({ functions: functionsPath }, null, 2)}\n`,
    "utf8",
  );
  const repositoryPackage = JSON.parse(
    await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
  );
  await writeFile(
    paths.projectPackage,
    `${JSON.stringify(
      localConvexProjectPackage(repositoryPackage, instanceId),
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    paths.manifest,
    `${JSON.stringify(
      {
        schemaVersion: INSTANCE_SCHEMA_VERSION,
        instanceId,
        ports,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { paths, ports };
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
      windowsHide: true,
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            `${options.label ?? command} stopped with ${signal ?? `code ${code}`}.`,
          ),
        );
    });
  });
}

function waitForProcessExit(child, label) {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveExit();
      else
        rejectExit(
          new Error(`${label} stopped with ${signal ?? `code ${code}`}.`),
        );
    });
  });
}

async function terminatePid(pid) {
  if (!processExists(pid)) return;
  if (process.platform === "win32") {
    await new Promise((resolveKill) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolveKill());
      killer.once("exit", () => resolveKill());
    });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 4_000;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (processExists(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process exited between probes.
    }
  }
}

async function portIsFree(port, host = "127.0.0.1") {
  return new Promise((resolveProbe) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolveProbe(false));
    server.listen({ host, port }, () => {
      server.close(() => resolveProbe(true));
    });
  });
}

async function assertPortsFree(ports, allowedPorts = new Set()) {
  for (const [name, port] of Object.entries(ports)) {
    if (name === "blockStart") continue;
    if (allowedPorts.has(port)) continue;
    const host = name === "web" ? "localhost" : "127.0.0.1";
    if (!(await portIsFree(port, host))) {
      throw new Error(`Instance port ${port} (${name}) is already in use.`);
    }
  }
}

function spawnService(label, command, args, { cwd, env }) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.spectraLabel = label;
  return child;
}

async function fetchText(url, timeoutMs = 1_500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitFor(label, probe, { timeoutMs, child } = {}) {
  const deadline = Date.now() + (timeoutMs ?? 120_000);
  let lastNotice = 0;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `${label} stopped before it became ready (code ${child.exitCode}).`,
      );
    }
    const result = await probe();
    if (result) return result;
    if (Date.now() - lastNotice > 30_000) {
      process.stdout.write(`Waiting for ${label}...\n`);
      lastNotice = Date.now();
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(
    `${label} did not become ready within ${Math.round((timeoutMs ?? 120_000) / 1000)} seconds.`,
  );
}

function savedBackendBinary(version) {
  if (!/^precompiled-\d{4}-\d{2}-\d{2}-[a-z0-9]+$/i.test(String(version ?? "")))
    throw new Error("Saved local Convex backend version is invalid; refusing an unpinned backend.");
  const cache = process.platform === "win32"
    ? resolve(process.env.LOCALAPPDATA || resolve(homedir(), "AppData", "Local"), "convex")
    : resolve(homedir(), ".cache", "convex");
  return resolve(cache, "binaries", version, process.platform === "win32" ? "convex-local-backend.exe" : "convex-local-backend");
}

async function savedBackendConfig(paths, ports) {
  if (!existsSync(paths.convexConfig)) return null;
  const config = JSON.parse(await readFile(paths.convexConfig, "utf8"));
  if (config.ports?.cloud !== ports.convexCloud || config.ports?.site !== ports.convexSite)
    throw new Error("Saved local Convex ports differ from this instance; refusing to select another deployment.");
  if (!config.deploymentName || !config.adminKey || !config.backendVersion || !config.instanceSecret)
    throw new Error("Saved local Convex configuration is incomplete; refusing to select another deployment.");
  return config;
}

function convexArguments(ports, env, configure) {
  const args = ["dev"];
  if (configure) {
    args.push("--configure", "existing", "--dev-deployment", "local");
    const team = String(env.SPECTRA_LOCAL_CONVEX_TEAM ?? "").trim();
    const project = String(env.SPECTRA_LOCAL_CONVEX_PROJECT ?? "").trim();
    if (Boolean(team) !== Boolean(project)) {
      throw new Error(
        "Set both SPECTRA_LOCAL_CONVEX_TEAM and SPECTRA_LOCAL_CONVEX_PROJECT, or leave both empty for the Convex prompt.",
      );
    }
    if (team) args.push("--team", team, "--project", project);
  }
  args.push(
    "--local-cloud-port",
    String(ports.convexCloud),
    "--local-site-port",
    String(ports.convexSite),
    "--codegen",
    "disable",
    "--typecheck",
    "disable",
    "--tail-logs",
    "disable",
  );
  return args;
}

async function readConvexConfiguration(paths, ports) {
  const config = JSON.parse(await readFile(paths.convexConfig, "utf8"));
  if (
    config.ports?.cloud !== ports.convexCloud ||
    config.ports?.site !== ports.convexSite
  ) {
    throw new Error(
      `Convex selected ports ${config.ports?.cloud}/${config.ports?.site}, ` +
        `but this instance owns ${ports.convexCloud}/${ports.convexSite}. Reset the instance and try again.`,
    );
  }
  const deploymentName = String(config.deploymentName ?? "").trim();
  if (!deploymentName)
    throw new Error(
      "The local Convex deployment did not record a deployment name.",
    );
  const selectionText = existsSync(paths.projectEnv)
    ? await readFile(paths.projectEnv, "utf8")
    : "";
  const selection = {
    CONVEX_DEPLOYMENT: `local:${deploymentName}`,
    NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${ports.convexCloud}`,
    NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${ports.convexSite}`,
  };
  await writeFile(paths.projectEnv, upsertEnv(selectionText, selection), {
    encoding: "utf8",
    mode: 0o600,
  });
  const appText = await readFile(paths.appEnv, "utf8");
  await writeFile(paths.appEnv, upsertEnv(appText, selection), {
    encoding: "utf8",
    mode: 0o600,
  });
  return deploymentName;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  await terminatePid(child.pid);
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
}

async function syncSavedLocalBackend(paths, ports, appEnv, reusable) {
    const selfHostedEnvPath = resolve(
      paths.projectRoot,
      ".convex-self-hosted.env",
    );
    await writeFile(
      selfHostedEnvPath,
      `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:${ports.convexCloud}\n` +
        `CONVEX_SELF_HOSTED_ADMIN_KEY=${reusable.adminKey}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const childEnv = withLocalConvexCliEnv({
      ...process.env,
      ...appEnv,
      CONVEX_SELF_HOSTED_URL: `http://127.0.0.1:${ports.convexCloud}`,
      CONVEX_SELF_HOSTED_ADMIN_KEY: reusable.adminKey,
    });
    delete childEnv.CONVEX_DEPLOYMENT;
    delete childEnv.CONVEX_DEPLOY_KEY;
    try {
      const convex = spawnService(
        "Convex",
        process.execPath,
        [
          convexCli,
          "dev",
          "--once",
          "--env-file",
          selfHostedEnvPath,
          "--codegen",
          "disable",
          "--typecheck",
          "disable",
          "--tail-logs",
          "disable",
        ],
        { cwd: paths.projectRoot, env: childEnv },
      );
      await waitForProcessExit(convex, "Offline local Convex sync");
      const currentAppEnv = parseEnv(await readFile(paths.appEnv, "utf8"));
      const backendEnv = convexEnvFrom(currentAppEnv);
      await writeFile(paths.convexEnv, serializeEnv(backendEnv), {
        encoding: "utf8",
        mode: 0o600,
      });
      await runProcess(
        process.execPath,
        [
          convexCli,
          "env",
          "set",
          "--force",
          "--env-file",
          selfHostedEnvPath,
          "--from-file",
          paths.convexEnv,
        ],
        {
          cwd: paths.projectRoot,
          env: childEnv,
          label: "Convex environment synchronization",
        },
      );
      process.stdout.write(
        `Reused saved local Convex deployment ${reusable.deploymentName} through its local endpoint.\n`,
      );
    } finally {
      await rm(selfHostedEnvPath, { force: true });
    }
}

async function configureAndSyncConvex(paths, ports, appEnv) {
  const reusable = await existingLocalBackend(paths, ports);
  if (reusable !== null) {
    await syncSavedLocalBackend(paths, ports, appEnv, reusable);
    return { deploymentName: reusable.deploymentName, child: null };
  }
  const saved = await savedBackendConfig(paths, ports);
  if (saved) {
    const binary = savedBackendBinary(saved.backendVersion);
    if (!existsSync(binary))
      throw new Error(`The saved local Convex binary is missing at ${binary}. Restore that pinned version before starting; no cloud project will be selected automatically.`);
    const database = resolve(paths.projectRoot, ".convex", "local", "default", "convex_local_backend.sqlite3");
    if (!existsSync(database))
      throw new Error(`Saved local Convex database is missing at ${database}; refusing to create an empty replacement.`);
    const databaseGiB = ((await stat(database)).size / 1024 ** 3).toFixed(2);
    process.stdout.write(`Starting saved local Convex backend (${databaseGiB} GiB database). A cold start may take several minutes; this is the existing database, not a new deployment.\n`);
    const backend = spawnService(
      "Convex",
      binary,
      savedBackendArguments(saved, resolve(paths.projectRoot, ".convex", "local", "default")),
      { cwd: paths.projectRoot, env: process.env },
    );
    try {
      await waitFor("saved local Convex backend", async () =>
        (await fetchText(`http://127.0.0.1:${ports.convexCloud}/instance_name`, 4_000))?.trim() === saved.deploymentName,
      { timeoutMs: LOCAL_CONVEX_READY_TIMEOUT_MS, child: backend });
      await syncSavedLocalBackend(paths, ports, appEnv, saved);
      return { deploymentName: saved.deploymentName, child: backend };
    } catch (error) {
      await stopChild(backend);
      throw error;
    }
  }
  const firstConfiguration = !existsSync(paths.convexConfig);
  if (firstConfiguration) {
    process.stdout.write(
      "This instance needs its one-time local Convex selection. Follow the Convex prompt if team/project were not set in env.local.\n",
    );
  }
  const childEnv = withLocalConvexCliEnv({ ...process.env, ...appEnv });
  if (firstConfiguration) {
    delete childEnv.CONVEX_DEPLOYMENT;
    delete childEnv.CONVEX_SELF_HOSTED_URL;
    delete childEnv.CONVEX_SELF_HOSTED_ADMIN_KEY;
  }
  const convex = spawnService(
    "Convex",
    process.execPath,
    [convexCli, ...convexArguments(ports, appEnv, firstConfiguration)],
    { cwd: paths.projectRoot, env: childEnv },
  );
  try {
    await waitFor(
      "local Convex configuration",
      async () => {
        if (!existsSync(paths.convexConfig)) return false;
        return Boolean(
          await fetchText(
            `http://127.0.0.1:${ports.convexCloud}/instance_name`,
          ),
        );
      },
      { timeoutMs: LOCAL_CONVEX_READY_TIMEOUT_MS, child: convex },
    );
    const deploymentName = await readConvexConfiguration(paths, ports);
    const currentAppEnv = parseEnv(await readFile(paths.appEnv, "utf8"));
    const backendEnv = convexEnvFrom(currentAppEnv);
    await writeFile(paths.convexEnv, serializeEnv(backendEnv), {
      encoding: "utf8",
      mode: 0o600,
    });
    await runProcess(
      process.execPath,
      [convexCli, "env", "set", "--force", "--from-file", paths.convexEnv],
      {
        cwd: paths.projectRoot,
        env: withLocalConvexCliEnv({ ...process.env, ...currentAppEnv }),
        label: "Convex environment synchronization",
      },
    );
    return { deploymentName, child: convex };
  } catch (error) {
    await stopChild(convex);
    throw error;
  }
}

async function existingLocalBackend(paths, ports) {
  if (!existsSync(paths.convexConfig)) return null;
  let config;
  try {
    config = JSON.parse(await readFile(paths.convexConfig, "utf8"));
  } catch {
    return null;
  }
  const deploymentName = String(config.deploymentName ?? "").trim();
  const adminKey = String(config.adminKey ?? "").trim();
  if (
    !deploymentName ||
    !adminKey ||
    config.ports?.cloud !== ports.convexCloud ||
    config.ports?.site !== ports.convexSite
  ) {
    return null;
  }
  const listening = !(await portIsFree(ports.convexCloud, "127.0.0.1"));
  let runningName = await fetchText(
    `http://127.0.0.1:${ports.convexCloud}/instance_name`,
    listening ? 30_000 : 1_500,
  );
  if (listening && !runningName) {
    process.stdout.write("Waiting for the saved local Convex backend to finish its startup work.\n");
    await waitFor("saved local Convex backend", async () => {
      runningName = await fetchText(`http://127.0.0.1:${ports.convexCloud}/instance_name`, 30_000);
      return Boolean(runningName);
    }, { timeoutMs: LOCAL_CONVEX_READY_TIMEOUT_MS });
  }
  return runningName?.trim() === deploymentName
    ? { deploymentName, adminKey }
    : null;
}

async function readRuntimeState(paths) {
  if (!existsSync(paths.runtimeState)) return null;
  try {
    return JSON.parse(await readFile(paths.runtimeState, "utf8"));
  } catch {
    return null;
  }
}

async function addInstance(instanceId, options, environment) {
  const { paths, ports } = await ensureInstance(
    instanceId,
    options,
    environment,
  );
  process.stdout.write(
    `Local instance ${instanceId} is ready to configure.\n` +
      `  Web:   http://localhost:${ports.web}\n` +
      `  Convex: http://127.0.0.1:${ports.convexCloud}\n` +
      `  Collab: ws://localhost:${ports.web}/_spectra/realtime\n` +
      `  Env:    ${paths.appEnv}\n` +
      `  Data:   ${paths.convexState}\n`,
  );
}

async function startInstance(instanceId, options, environment) {
  if (!existsSync(convexCli)) {
    throw new Error(
      "Convex CLI is missing. Run npm install before starting a local instance.",
    );
  }
  const mode = String(options.values.mode ?? "development").trim();
  if (mode !== "development" && mode !== "production") {
    throw new Error('Local stack --mode must be "development" or "production".');
  }
  if (mode === "production") {
    const buildId = resolve(repositoryRoot, ".next", "BUILD_ID");
    if (!existsSync(buildId)) {
      throw new Error(
        "Production mode needs a build. Run npm run local:build -- --instance <id> first, so the client inlines the local Convex URL.",
      );
    }
  }
  const { paths, ports } = await ensureInstance(
    instanceId,
    options,
    environment,
  );
  const previousState = await readRuntimeState(paths);
  if (previousState?.launcherPid && processExists(previousState.launcherPid)) {
    throw new Error(
      `Instance ${instanceId} is already running (PID ${previousState.launcherPid}).`,
    );
  }
  await rm(paths.runtimeState, { force: true });
  const appEnv = parseEnv(await readFile(paths.appEnv, "utf8"));
  const problems = validateRequiredEnv(appEnv);
  if (problems.length > 0) {
    throw new Error(
      `Instance ${instanceId} cannot start. Fill ${paths.appEnv}:\n- ${problems.join("\n- ")}`,
    );
  }
  const reusableLocalBackend = await existingLocalBackend(paths, ports);
  await assertPortsFree(
    ports,
    reusableLocalBackend
      ? new Set([ports.convexCloud, ports.convexSite])
      : undefined,
  );

  const { deploymentName, child: convex } = await configureAndSyncConvex(
    paths,
    ports,
    appEnv,
  );
  const finalEnv = withLocalConvexCliEnv({
    ...process.env,
    ...parseEnv(await readFile(paths.appEnv, "utf8")),
    NODE_ENV: mode === "production" ? "production" : process.env.NODE_ENV,
  });
  const children = [convex].filter(Boolean);
  let shuttingDown = false;
  let shutdownPromise = null;

  const shutdown = (exitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    shutdownPromise = (async () => {
      await Promise.all(children.map((child) => stopChild(child)));
      await rm(paths.runtimeState, { force: true });
      process.exitCode = exitCode;
    })();
    return shutdownPromise;
  };

  process.once("SIGINT", () => void shutdown(0).finally(() => process.exit(0)));
  process.once(
    "SIGTERM",
    () => void shutdown(0).finally(() => process.exit(0)),
  );

  try {
    await waitFor(
      "local Convex backend",
      async () =>
        (await fetchText(
          `http://127.0.0.1:${ports.convexCloud}/instance_name`,
        )) === deploymentName,
      { timeoutMs: LOCAL_CONVEX_READY_TIMEOUT_MS, child: convex },
    );

    const collaboration = spawnService(
      "Collaboration gateway",
      process.execPath,
      [resolve(repositoryRoot, "scripts", "serve-collaboration-gateway.mjs"), "--supervise", "--env-file", paths.appEnv],
      { cwd: repositoryRoot, env: finalEnv },
    );
    const web = spawnService(
      "Next.js",
      process.execPath,
      [
        resolve(
          repositoryRoot,
          "scripts",
          mode === "production" ? "start-web.mjs" : "dev-web.mjs",
        ),
      ],
      { cwd: repositoryRoot, env: finalEnv },
    );
    children.push(collaboration, web);
    const startedAt = new Date().toISOString();

    const persistRuntime = async () => {
      await writeFile(
        paths.runtimeState,
        `${JSON.stringify(
          {
            schemaVersion: INSTANCE_SCHEMA_VERSION,
            instanceId,
            launcherPid: process.pid,
            startedAt,
            deploymentName,
            pids: Object.fromEntries(
              children
                .filter((child) => child?.pid && child.exitCode === null)
                .map((child) => [child.spectraLabel, child.pid]),
            ),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    };

    const attachExitHandler = (child) => {
      child.once("exit", (code, signal) => {
        if (shuttingDown) return;
        if (!isFatalServiceExit(child.spectraLabel)) {
          process.stderr.write(
            `${child.spectraLabel} stopped (${signal ?? `code ${code}`}); web and Convex stay up so collaboration can recover.\n`,
          );
          void persistRuntime();
          return;
        }
        process.stderr.write(
          `${child.spectraLabel} stopped unexpectedly (${signal ?? `code ${code}`}); stopping instance ${instanceId}.\n`,
        );
        void shutdown(code || 1).finally(() =>
          process.exit(process.exitCode ?? 1),
        );
      });
    };

    for (const child of children) attachExitHandler(child);

    await persistRuntime();

    await Promise.all([
      waitFor(
        "collaboration gateway",
        async () => {
          const text = await fetchText(
            `http://127.0.0.1:${ports.collaboration}/_spectra/health`,
          );
          if (!text) return false;
          try {
            const body = JSON.parse(text);
            return (
              body.service === "spectra-collaboration-gateway" &&
              body.status === "ready"
            );
          } catch {
            return false;
          }
        },
        { timeoutMs: 120_000, child: collaboration },
      ),
      waitFor(
        "Next.js server",
        async () => {
          const text = await fetchText(
          `http://localhost:${ports.web}/api/health`,
          4_000,
          );
          if (!text) return false;
          try {
            const body = JSON.parse(text);
            return body.service === "spectra-web" && body.status === "ready";
          } catch {
            return false;
          }
        },
        { timeoutMs: 180_000, child: web },
      ),
    ]);
  } catch (error) {
    await shutdown(1);
    throw error;
  }

  process.stdout.write(
    `\nSpectra local instance ${instanceId} is ready (${mode}).\n` +
      `  App:       http://localhost:${ports.web}\n` +
      `  Convex:    http://127.0.0.1:${ports.convexCloud}\n` +
      `  Dashboard: http://127.0.0.1:${ports.convexCloud}/_system/frontend\n` +
      `  Bridge:    SPECTRA_CONVEX_URL=http://127.0.0.1:${ports.convexCloud}\n` +
      `Press Ctrl+C to stop this instance.\n\n`,
  );

  await new Promise(() => {});
}

async function stopInstance(instanceId, environment) {
  const paths = instancePaths(instanceId, environment);
  const state = await readRuntimeState(paths);
  if (!state) {
    process.stdout.write(
      `Local instance ${instanceId} is not recorded as running.\n`,
    );
    return;
  }
  if (state.launcherPid && state.launcherPid !== process.pid) {
    await terminatePid(state.launcherPid);
  }
  for (const pid of Object.values(state.pids ?? {}))
    await terminatePid(Number(pid));
  await rm(paths.runtimeState, { force: true });
  process.stdout.write(`Stopped local instance ${instanceId}.\n`);
}

async function resetInstance(instanceId, options, environment) {
  const paths = instancePaths(instanceId, environment);
  if (!options.flags.has("yes")) {
    throw new Error(
      `Reset deletes the local Convex database at ${paths.convexState}. ` +
        "Run again with --yes after checking the instance id.",
    );
  }
  await stopInstance(instanceId, environment);
  assertInside(paths.instanceRoot, paths.convexState);
  await rm(paths.convexState, { recursive: true, force: true });
  await rm(paths.projectEnv, { force: true });
  await rm(paths.convexEnv, { force: true });
  process.stdout.write(
    `Reset local instance ${instanceId}. Its credential template remains at ${paths.appEnv}.\n`,
  );
}

async function buildInstance(instanceId, options, environment) {
  if (!existsSync(nextCli)) {
    throw new Error(
      "Next.js is missing. Run npm install before building a local instance.",
    );
  }
  const { paths } = await ensureInstance(instanceId, options, environment);
  if (!existsSync(paths.appEnv)) {
    throw new Error(
      `Instance ${instanceId} is not configured. Add it and fill ${paths.appEnv} first.`,
    );
  }
  const appEnv = parseEnv(await readFile(paths.appEnv, "utf8"));
  const problems = validateRequiredEnv(appEnv);
  if (problems.length > 0) {
    throw new Error(
      `Instance ${instanceId} cannot build. Fill ${paths.appEnv}:\n- ${problems.join("\n- ")}`,
    );
  }
  process.stdout.write(
    `Building the production app for local instance ${instanceId} (${appEnv.NEXT_PUBLIC_CONVEX_URL}).\n`,
  );
  await runProcess(process.execPath, [nextCli, "build"], {
    cwd: repositoryRoot,
    env: { ...process.env, ...appEnv, NODE_ENV: "production" },
    label: "Next.js production build",
  });
}

async function statusInstance(instanceId, environment) {
  const paths = instancePaths(instanceId, environment);
  const manifest = await loadManifest(paths);
  if (!manifest) {
    process.stdout.write(`Local instance ${instanceId} has not been added.\n`);
    return;
  }
  const state = await readRuntimeState(paths);
  const launcherRunning = Boolean(
    state?.launcherPid && processExists(state.launcherPid),
  );
  const [convexName, webHealthText, gatewayHealthText] = await Promise.all([
    fetchText(`http://127.0.0.1:${manifest.ports.convexCloud}/instance_name`),
    fetchText(`http://localhost:${manifest.ports.web}/api/health`),
    fetchText(`http://127.0.0.1:${manifest.ports.collaboration}/_spectra/health`),
  ]);
  const reportsReady = (value) => {
    try {
      return JSON.parse(value ?? "null")?.status === "ready";
    } catch {
      return false;
    }
  };
  const backendReady = Boolean(convexName && convexName === state?.deploymentName);
  const running = launcherRunning && backendReady &&
    reportsReady(webHealthText) && reportsReady(gatewayHealthText);
  const status = running ? "ready" : launcherRunning ? "not_ready" : "stopped";
  process.stdout.write(
    `Local instance ${instanceId}: ${status}\n` +
      `  App:    http://localhost:${manifest.ports.web}\n` +
      `  Convex: http://127.0.0.1:${manifest.ports.convexCloud}\n` +
      `  Env:    ${paths.appEnv}\n` +
      `  Data:   ${paths.convexState}\n`,
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const instanceId = normalizeInstanceId(options.values.instance ?? "1");
  switch (options.command) {
    case "build":
      return buildInstance(instanceId, options, process.env);
    case "add-instance":
      return addInstance(instanceId, options, process.env);
    case "start":
      return startInstance(instanceId, options, process.env);
    case "stop":
      return stopInstance(instanceId, process.env);
    case "reset":
      return resetInstance(instanceId, options, process.env);
    case "status":
      return statusInstance(instanceId, process.env);
    default:
      throw new Error(
        `Unknown local stack command "${options.command}". Use start, stop, reset, add-instance, build, or status.`,
      );
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
