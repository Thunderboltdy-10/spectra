import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile as readFileAsync, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceManifest } from "../reformation-evidence.mjs";
import { createPreflightEvidence } from "./preflight-evidence.mjs";
import {
  commandVersion,
  probeBridgeReadiness,
  probeConvexReadiness,
  probeGatewayReadiness,
  probeWebReadiness,
  productionBuildHash,
} from "./readiness.mjs";
import { normalizeInstanceId, parseEnv, portsForInstance } from "./stack-config.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (!["instance", "unit", "out", "fixture"].includes(name)) throw new Error(`Unknown option: --${name}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}.`);
    values[name] = value;
    index += 1;
  }
  return values;
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return "unknown";
  return String(result.stdout).trim();
}

async function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const instanceId = normalizeInstanceId(options.instance ?? "1");
  const unit = options.unit ?? "P8.P1";
  const out = resolve(
    repositoryRoot,
    options.out ?? `.shots/reformation/${unit}/preflight.json`,
  );
  const instanceRoot = resolve(
    repositoryRoot,
    process.env.SPECTRA_LOCAL_ROOT ?? ".spectra-local",
    "instances",
    String(instanceId),
  );
  const appEnvPath = resolve(instanceRoot, "env.local");
  const manifestPath = resolve(instanceRoot, "instance.json");
  const appEnv = existsSync(appEnvPath)
    ? parseEnv(await readFileAsync(appEnvPath, "utf8"))
    : parseEnv(process.env.NEXT_PUBLIC_CONVEX_URL ? `NEXT_PUBLIC_CONVEX_URL=${process.env.NEXT_PUBLIC_CONVEX_URL}` : "");
  const instanceManifest = existsSync(manifestPath)
    ? JSON.parse(await readFileAsync(manifestPath, "utf8"))
    : null;
  const ports = instanceManifest?.ports ?? portsForInstance(instanceId);
  const convexUrl = appEnv.NEXT_PUBLIC_CONVEX_URL ?? `http://127.0.0.1:${ports.convexCloud}`;
  const webOrigin = `http://localhost:${ports.web}`;
  const gatewayOrigin = `http://127.0.0.1:${ports.collaboration}`;
  const [convex, gateway, web, bridge, build] = await Promise.all([
    probeConvexReadiness(convexUrl),
    probeGatewayReadiness(gatewayOrigin),
    probeWebReadiness(webOrigin),
    probeBridgeReadiness(),
    productionBuildHash(repositoryRoot),
  ]);
  const fixturePath = options.fixture ? resolve(options.fixture) : null;
  const hashes = {};
  if (fixturePath) {
    hashes.sacrificialFixture = {
      path: fixturePath,
      sha256: await sha256File(fixturePath),
    };
  }
  const gitStatus = gitOutput(["status", "--porcelain"]);
  const manifest = createPreflightEvidence({
    unit,
    commit: gitOutput(["rev-parse", "HEAD"]),
    environment: {
      node: process.version,
      npm: commandVersion("npm") ?? "unknown",
      rustc: commandVersion("rustc") ?? "unknown",
      cargo: commandVersion("cargo") ?? "unknown",
      os: `${process.platform} ${process.arch}`,
      instanceId,
      instanceData: resolve(instanceRoot, "project", ".convex"),
      convexUrl,
      webOrigin,
      gatewayOrigin,
      mode: web.body?.mode ?? "unknown",
      productionBuildId: build?.buildId ?? null,
      productionBuildIdSha256: build?.sha256 ?? null,
      gitStatus: gitStatus === "unknown" ? "unknown" : gitStatus ? "dirty" : "clean",
    },
    hashes,
    probes: { web, convex, gateway, bridge },
    out,
  });
  validateEvidenceManifest(manifest);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${out}\n`);
  process.stdout.write(
    `  web=${web.status} convex=${convex.status} gateway=${gateway.status} bridge=${bridge.status}\n`,
  );
  process.stdout.write("Service health only; authenticated and native acceptance remain unverified.\n");
  if (manifest.verdict === "blocked") process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
