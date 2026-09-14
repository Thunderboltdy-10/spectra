import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, relative, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeInstanceId, parseEnv } from "./stack-config.mjs";
import { assertLocalSeedTarget, identityForAccount } from "./seed-config.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const convexCli = resolve(repositoryRoot, "node_modules", "convex", "bin", "main.js");

function usage() {
  throw new Error(
    "Usage: node scripts/local/student-resource-rehearsal.mjs <snapshot|apply|restore> --student-email <email> [--school-id <id>] [--role student|teacher|school_admin] [--snapshot-file <path>]",
  );
}

function parse(argv) {
  const [command, ...rest] = argv;
  if (!["snapshot", "apply", "restore"].includes(command)) usage();
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key?.startsWith("--") || !rest[index + 1] || rest[index + 1].startsWith("--")) usage();
    values[key.slice(2)] = rest[index + 1];
    index += 1;
  }
  if (!values["student-email"]) usage();
  return { command, values };
}

function assertInside(parent, target) {
  const child = relative(resolve(parent), resolve(target));
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error(`Refusing to use a rehearsal snapshot outside ${resolve(parent)}.`);
}

async function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0
      ? resolveRun(stdout.trim())
      : rejectRun(new Error(`${options.label ?? command} failed${stderr.trim() ? `: ${stderr.trim()}` : "."}`)));
  });
}

async function main() {
  const { command, values } = parse(process.argv.slice(2));
  const instanceId = normalizeInstanceId(values.instance ?? "1");
  const runtimeRoot = resolve(repositoryRoot, String(process.env.SPECTRA_LOCAL_ROOT ?? ".spectra-local"));
  const instanceRoot = resolve(runtimeRoot, "instances", String(instanceId));
  const appEnvPath = resolve(instanceRoot, "env.local");
  const manifestPath = resolve(instanceRoot, "instance.json");
  const projectRoot = resolve(instanceRoot, "project");
  const projectEnvPath = resolve(projectRoot, ".env.local");
  const defaultSnapshot = resolve(instanceRoot, "student-resource-rehearsal.json");
  const snapshotPath = resolve(values["snapshot-file"] ?? defaultSnapshot);
  assertInside(runtimeRoot, snapshotPath);
  for (const path of [appEnvPath, manifestPath, projectEnvPath]) if (!existsSync(path)) throw new Error(`Local instance ${instanceId} is not configured.`);
  if (!existsSync(convexCli)) throw new Error("Convex CLI is missing. Run npm ci in this worktree.");
  const [appEnvText, projectEnvText, manifestText] = await Promise.all([readFile(appEnvPath, "utf8"), readFile(projectEnvPath, "utf8"), readFile(manifestPath, "utf8")]);
  const appEnv = parseEnv(appEnvText);
  const projectEnv = parseEnv(projectEnvText);
  const manifest = JSON.parse(manifestText);
  assertLocalSeedTarget({ appEnv, projectEnv, ports: manifest.ports });
  const runtimeEnv = { ...appEnv, ...projectEnv, SPECTRA_LOCAL_REHEARSAL: "1" };
  const selfHosted = Boolean(process.env.CONVEX_SELF_HOSTED_URL);
  const commandEnv = { ...process.env, ...runtimeEnv };
  if (selfHosted) delete commandEnv.CONVEX_DEPLOYMENT;
  const deploymentArgs = selfHosted ? [] : ["--deployment", "local"];
  const cliArgs = (args) => [...args, ...deploymentArgs, "--codegen", "disable", "--typecheck", "disable"];
  const lookup = await run(process.execPath, cliArgs([convexCli, "run", "--inline-query", `const account = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", ${JSON.stringify(String(values["operator-email"] ?? appEnv.SUPER_ADMIN_EMAILS?.split(",")[0] ?? "").trim().toLowerCase())})).unique(); return account ? { clerkId: account.clerkId, email: account.email, name: account.name } : null;`]), { cwd: projectRoot, env: commandEnv, label: "Local operator lookup" });
  const operator = JSON.parse(lookup);
  if (!operator) throw new Error("Configured local operator account was not found.");
  const identity = JSON.stringify(identityForAccount(operator));
  const target = { accountEmail: String(values["student-email"]).trim().toLowerCase(), ...(values["school-id"] ? { schoolId: values["school-id"] } : {}) };
  if (command === "snapshot") {
    const snapshot = JSON.parse(await run(process.execPath, cliArgs([convexCli, "run", "localStudentRehearsal:snapshot", JSON.stringify(target), "--identity", identity]), { cwd: projectRoot, env: commandEnv, label: "Rehearsal snapshot" }));
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`Saved reversible student rehearsal snapshot: ${snapshotPath}\n`);
    return;
  }
  if (command === "apply") {
    if (!values["school-id"]) throw new Error("--school-id is required for apply.");
    const result = await run(process.execPath, cliArgs([convexCli, "run", "localStudentRehearsal:apply", JSON.stringify({ ...target, role: values.role ?? "student" }), "--identity", identity]), { cwd: projectRoot, env: commandEnv, label: "Rehearsal apply" });
    process.stdout.write(`Applied local student rehearsal context: ${result}\nRestore with the same snapshot file when finished.\n`);
    return;
  }
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const result = await run(process.execPath, cliArgs([convexCli, "run", "localStudentRehearsal:restore", JSON.stringify({ snapshot }), "--identity", identity]), { cwd: projectRoot, env: commandEnv, label: "Rehearsal restore" });
  process.stdout.write(`Restored local student rehearsal context idempotently: ${result}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
