import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEvidenceManifest,
  validateEvidenceManifest,
} from "../reformation-evidence.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..", "..");
export const evidenceRoot = resolve(
  repositoryRoot,
  ".shots",
  "reformation",
  "P8.V1",
);
export const cardIds = Object.freeze([
  "A0",
  "A1",
  "B0",
  "B1",
  "B2",
  "B3",
  "B4",
  "C0",
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "D0",
  "D1",
  "D2",
  "D3",
  "E0",
  "E1",
  "E2",
  "E3",
  "E4",
  "E5",
  "E6",
  "E7",
  "E8",
  "E9",
  "E10",
  "F0",
  "F1",
  "F2",
  "F3",
  "G0",
  "G1",
  "G2",
  "G3",
  "T0",
  "T1",
  "T2",
  "Z0",
  "Z1",
  "Z2",
]);
export const cardStatuses = Object.freeze([
  "pending",
  "running",
  "passed",
  "failed",
  "blocked",
]);

function parseArguments(argv) {
  const command = argv[0] ?? "status";
  const values = {};
  const flags = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--"))
      throw new Error(`Unexpected argument ${token}.`);
    const name = token.slice(2);
    if (name === "reopen") {
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for --${name}.`);
    values[name] = value;
    index += 1;
  }
  return { command, values, flags };
}

async function git(args) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("git", args, {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun(stdout.trim());
      else rejectRun(new Error(stderr.trim() || `git exited with ${code}`));
    });
  });
}

export function createRunState({
  instance,
  commit,
  buildId = null,
  now = new Date().toISOString(),
}) {
  return {
    schemaVersion: 1,
    unit: "P8.V1",
    createdAt: now,
    updatedAt: now,
    candidate: { commit, buildId, instance },
    cards: Object.fromEntries(
      cardIds.map((id) => [
        id,
        { status: "pending", attempts: [], evidence: [] },
      ]),
    ),
  };
}

export function updateCard(
  state,
  {
    card,
    status,
    evidence,
    note,
    reopen = false,
    now = new Date().toISOString(),
  },
) {
  if (!cardIds.includes(card)) throw new Error(`Unknown P8.V1 card ${card}.`);
  if (!cardStatuses.includes(status))
    throw new Error(`Unknown card status ${status}.`);
  const current = state.cards[card];
  if (current.status === "passed" && status !== "passed" && !reopen) {
    throw new Error(
      `${card} already passed. Use --reopen only when a repair invalidated its seam.`,
    );
  }
  const attempt = { at: now, status };
  if (note) attempt.note = note;
  if (evidence) attempt.evidence = evidence;
  current.status = status;
  current.attempts.push(attempt);
  if (evidence && !current.evidence.includes(evidence))
    current.evidence.push(evidence);
  state.updatedAt = now;
  return state;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function prepare(instance) {
  await mkdir(resolve(evidenceRoot, "browser"), { recursive: true });
  await mkdir(resolve(evidenceRoot, "cost"), { recursive: true });
  await mkdir(resolve(evidenceRoot, "native"), { recursive: true });
  await mkdir(resolve(evidenceRoot, "faults"), { recursive: true });
  await mkdir(resolve(evidenceRoot, "reports"), { recursive: true });
  const statePath = resolve(evidenceRoot, "run-state.json");
  const manifestPath = resolve(evidenceRoot, "manifest.json");
  const commit = await git(["rev-parse", "HEAD"]);
  const buildPath = resolve(repositoryRoot, ".next", "BUILD_ID");
  const buildId = existsSync(buildPath)
    ? (await readFile(buildPath, "utf8")).trim()
    : null;
  if (!existsSync(statePath)) {
    await writeFile(
      statePath,
      `${JSON.stringify(createRunState({ instance, commit, buildId }), null, 2)}\n`,
      "utf8",
    );
  }
  if (!existsSync(manifestPath)) {
    const manifest = createEvidenceManifest({
      unit: "P8.V1",
      commit,
      environment: { mode: "production", localInstance: instance },
      verdict: "open",
    });
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }
  process.stdout.write(
    `Prepared ${evidenceRoot}. Existing card results were preserved.\n`,
  );
}

async function doctor(instance) {
  const statePath = resolve(evidenceRoot, "run-state.json");
  const manifestPath = resolve(evidenceRoot, "manifest.json");
  const instanceRoot = resolve(
    repositoryRoot,
    ".spectra-local",
    "instances",
    String(instance),
  );
  const checks = {
    commit: await git(["rev-parse", "HEAD"]),
    clean: (await git(["status", "--porcelain"])) === "",
    runState: existsSync(statePath),
    validManifest: false,
    instanceManifest: existsSync(resolve(instanceRoot, "instance.json")),
    instanceRuntime: existsSync(resolve(instanceRoot, "runtime.json")),
    buildId: existsSync(resolve(repositoryRoot, ".next", "BUILD_ID")),
  };
  if (existsSync(manifestPath)) {
    validateEvidenceManifest(await readJson(manifestPath));
    checks.validManifest = true;
  }
  process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
  if (
    !checks.clean ||
    !checks.runState ||
    !checks.validManifest ||
    !checks.instanceManifest
  ) {
    process.exitCode = 1;
  }
}

async function main() {
  const { command, values, flags } = parseArguments(process.argv.slice(2));
  const instance = Number(values.instance ?? 1);
  if (!Number.isInteger(instance) || instance < 1)
    throw new Error("--instance must be a positive integer.");
  if (command === "prepare") return prepare(instance);
  if (command === "doctor") return doctor(instance);
  const statePath = resolve(evidenceRoot, "run-state.json");
  if (!existsSync(statePath))
    throw new Error("Run prepare before reading or changing P8 state.");
  const state = await readJson(statePath);
  if (command === "status") {
    const summary = Object.fromEntries(
      cardStatuses.map((status) => [
        status,
        cardIds.filter((id) => state.cards[id]?.status === status),
      ]),
    );
    process.stdout.write(
      `${JSON.stringify({ candidate: state.candidate, summary }, null, 2)}\n`,
    );
    return;
  }
  if (command !== "mark")
    throw new Error('Use "prepare", "doctor", "status", or "mark".');
  if (!values.card || !values.status)
    throw new Error("mark requires --card and --status.");
  updateCard(state, {
    card: values.card,
    status: values.status,
    evidence: values.evidence,
    note: values.note,
    reopen: flags.has("reopen"),
  });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  process.stdout.write(`Marked ${values.card} ${values.status}.\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
