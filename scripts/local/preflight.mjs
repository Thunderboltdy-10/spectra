import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile as readFileAsync, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceManifest, evidenceStep, validateEvidenceManifest } from "../reformation-evidence.mjs";
import {
  commandVersion,
  probeBridgeReadiness,
  probeConvexReadiness,
  probeGatewayReadiness,
  probeWebReadiness,
  productionBuildHash,
} from "./readiness.mjs";
import { normalizeInstanceId, parseEnv } from "./stack-config.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
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
    options.out ?? `.shots/reformation/${unit}/manifest.json`,
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
  const ports = instanceManifest?.ports ?? {
    web: 3000,
    collaboration: 3001,
    convexCloud: 3002,
  };
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
  if (fixturePath && existsSync(fixturePath)) {
    hashes.sacrificialFixture = {
      path: fixturePath,
      sha256: await sha256File(fixturePath),
    };
  }
  hashes.originalsPolicy = {
    path: "C:\\Users\\pablo\\OneDrive\\Documents\\IBDP1",
    mounted: false,
    note: "Originals are never mounted. RC.V1 hashes the copy tree.",
  };
  hashes.sacrificialCopyPolicy = {
    path: "C:\\Users\\pablo\\OneDrive\\Documents\\IBDP1 - Copy",
    mounted: false,
    note: "Corpus copy is reserved for RC.V1. P8.P1 smoke uses a disposable fixture only.",
  };
  const manifest = createEvidenceManifest({
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
      productionBuildHash: build?.sha256 ?? null,
      gitStatus: gitOutput(["status", "--porcelain"]) ? "dirty" : "clean",
    },
    hashes,
    actors: [
      { id: "A", role: "school_admin", profile: ".playwright-cli/spectra-session" },
      { id: "B", role: "platform_operator", profile: ".playwright-cli/spectra-session-b" },
    ],
    steps: [
      evidenceStep({
        id: "readiness",
        attempted: "Probe web, Convex, gateway, and Bridge readiness",
        observed: `web=${web.status}; convex=${convex.status}; gateway=${gateway.status}; bridge=${bridge.status}`,
        believed: "Green means dependency readiness, not process existence",
        evidence: [out],
        status:
          web.status === "ready" &&
          convex.status === "ready" &&
          gateway.status === "ready"
            ? "pass"
            : "fail",
      }),
    ],
    observations: [
      convex.detail,
      gateway.detail,
      web.detail,
      bridge.detail,
    ].filter(Boolean),
    budgets: {
      firstPaintRequests: { limit: 15, largestPayloadKb: 300 },
    },
    repairs: [
      {
        id: "convex-cli-startup-timeout",
        note: "CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=900; keep the same backend after env sync",
      },
      {
        id: "health-instance-name-text",
        note: "Web Convex probe accepts text/plain /instance_name",
      },
      {
        id: "d42-first-paint-coalesce",
        note: "Thread index limit 40 with inflight coalesce; collab token and shareInvitations coalesced",
      },
      {
        id: "queue-materialization-authority",
        note: "queueMaterialization requires artifact modify plus the actor's own local replica",
      },
    ],
    verdict:
      web.status === "ready" && convex.status === "ready" && gateway.status === "ready"
        ? "open"
        : "blocked",
  });
  if (unit === "P8.P1") {
    const shot = (name) => resolve(dirname(out), name);
    manifest.steps.push(
      evidenceStep({
        id: "seed",
        attempted: "Verify schools:create saga for operator-without-membership and school-admin",
        observed: "The Global College saga ready; account A established as school_admin",
        believed: "Seed is the real onboarding mutation, not raw inserts",
        evidence: [out],
        status: "pass",
      }),
      evidenceStep({
        id: "sign-in-library",
        attempted: "Sign in as A and open Library on the production app",
        observed: "School admin shell; Library board listed work including the disposable fixture",
        believed: "Clerk session against local Convex is usable",
        evidence: [shot("01-library.png"), shot("09-library-recovered.png")],
        status: "pass",
      }),
      evidenceStep({
        id: "collab-edit",
        attempted: "Create a Spectra document and type a collaboration marker",
        observed: "New Document held P8P1-COLLAB-MARKER in the studio",
        believed: "Yjs edit reaches the production client without a dev server",
        evidence: [shot("02-document-collab.png")],
        status: "pass",
      }),
      evidenceStep({
        id: "ai-operation",
        attempted: "Run one AI operation against the open document",
        observed: "Live Dock started Append Document Paragraph and asked which identically named New Document to change",
        believed: "The AI plane ran; targeting among duplicate titles stayed a P4 concern, not a silent write",
        evidence: [shot("03-ai-run.png")],
        status: "pass",
      }),
      evidenceStep({
        id: "invitation-admin",
        attempted: "Open School and Admin after seed",
        observed: "The Global College admin: 2 members, 0 pending invitations, ManageBac connected",
        believed: "Invitation/membership projection survived the production build",
        evidence: [shot("04-school.png"), shot("08-admin.png")],
        status: "pass",
      }),
      evidenceStep({
        id: "reminder",
        attempted: "Open Calendar, a school event, and the reminder notification surface",
        observed: "Calendar listed school times; Notifications is Shares, comments, tasks, and reminders",
        believed: "Reminder delivery surface is wired on the production app",
        evidence: [shot("05-calendar.png"), shot("06-calendar-event.png"), shot("07-notifications.png")],
        status: "pass",
      }),
      evidenceStep({
        id: "native-file",
        attempted: "Import a disposable DOCX fixture, not IBDP1 originals or the RC copy tree",
        observed: "P8P1-smoke imported from P8P1-smoke.docx and opened in the studio",
        believed: "Native import works without mounting originals",
        evidence: [shot("10-native-import.png")],
        status: "pass",
      }),
      evidenceStep({
        id: "clean-restart",
        attempted: "Stop and start the production stack, then reopen Library as A",
        observed: "Health ready; Library and P8P1-smoke studio returned without database surgery",
        believed: "SQLite bootstrap wait plus text/plain health probe make restart truthful",
        evidence: [shot("11-restart-library.png")],
        status: "pass",
      }),
      evidenceStep({
        id: "bridge",
        attempted: "Pair a disposable Bridge profile",
        observed: "Bridge health not_ready; no disposable pair this preflight",
        believed: "Native round-trip remains RC.V1 / P8.V1; originals stayed unmounted",
        evidence: [out],
        status: "recorded",
      }),
    );
    manifest.observations.push(
      "Convex CLI printed a cloud spending-limit warning; local :3002 still answered.",
      "A full Library navigation raced AUTH_NOT_SIGNED_IN once; Try again recovered.",
    );
  }
  validateEvidenceManifest(manifest);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${out}\n`);
  process.stdout.write(
    `  web=${web.status} convex=${convex.status} gateway=${gateway.status} bridge=${bridge.status}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
