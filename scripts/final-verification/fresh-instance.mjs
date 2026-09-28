import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..", "..");
export const defaultRuntimeRoot = resolve(repositoryRoot, ".spectra-local");

function assertInside(parent, target) {
  const child = relative(resolve(parent), resolve(target));
  if (!child || child === ".." || child.startsWith(`..${sep}`)) {
    throw new Error(`Refusing to operate outside ${resolve(parent)}.`);
  }
}

export async function listInstanceIds(runtimeRoot = defaultRuntimeRoot) {
  const instancesRoot = resolve(runtimeRoot, "instances");
  assertInside(runtimeRoot, instancesRoot);
  if (!existsSync(instancesRoot)) return [];
  const entries = await readdir(instancesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((left, right) => left - right);
}

export function nextUnusedInstance(ids) {
  const used = new Set(ids);
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

function parseArguments(argv) {
  const command = argv[0] ?? "plan";
  const values = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--"))
      throw new Error(`Unexpected argument ${token}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}.`);
    }
    values[token.slice(2)] = value;
    index += 1;
  }
  return { command, values };
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`Instance scaffold exited with code ${code}.`));
    });
  });
}

export async function createFreshInstance({
  sourceInstance = 1,
  targetInstance,
  runtimeRoot = defaultRuntimeRoot,
} = {}) {
  const ids = await listInstanceIds(runtimeRoot);
  const target = targetInstance ?? nextUnusedInstance(ids);
  if (ids.includes(target)) {
    throw new Error(
      `Instance ${target} already exists; a fresh replay must use a new id.`,
    );
  }
  const sourceEnv = resolve(
    runtimeRoot,
    "instances",
    String(sourceInstance),
    "env.local",
  );
  assertInside(runtimeRoot, sourceEnv);
  if (!existsSync(sourceEnv)) {
    throw new Error(`Credential template does not exist at ${sourceEnv}.`);
  }
  const stackScript = resolve(repositoryRoot, "scripts", "local", "stack.mjs");
  await run(process.execPath, [
    stackScript,
    "add-instance",
    "--instance",
    String(target),
    "--source-env",
    sourceEnv,
  ]);
  return target;
}

async function main() {
  const { command, values } = parseArguments(process.argv.slice(2));
  const ids = await listInstanceIds();
  const next = nextUnusedInstance(ids);
  if (command === "plan") {
    process.stdout.write(
      `${JSON.stringify({ existing: ids, next, destructive: false }, null, 2)}\n`,
    );
    return;
  }
  if (command !== "create") {
    throw new Error('Use "plan" or "create".');
  }
  const sourceInstance = Number(values["source-instance"] ?? 1);
  const targetInstance = values.instance ? Number(values.instance) : next;
  if (!Number.isInteger(sourceInstance) || sourceInstance < 1) {
    throw new Error("--source-instance must be a positive integer.");
  }
  if (!Number.isInteger(targetInstance) || targetInstance < 1) {
    throw new Error("--instance must be a positive integer.");
  }
  const created = await createFreshInstance({ sourceInstance, targetInstance });
  process.stdout.write(
    `Created empty local instance ${created} from instance ${sourceInstance}'s credential template. No database was copied or deleted.\n`,
  );
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
