import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeInstanceId, parseEnv } from "./stack-config.mjs";
import {
  assertLocalSeedTarget,
  bootstrapJoinUrl,
  identityForAccount,
  parseSeedArguments,
  resolveOperatorEmail,
  schoolCreateArgs,
  seedMaterial,
  verifyBootstrapProjection,
} from "./seed-config.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const convexCli = resolve(repositoryRoot, "node_modules", "convex", "bin", "main.js");

function assertInside(parent, target) {
  const child = relative(resolve(parent), resolve(target));
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`Refusing to use a bootstrap path outside ${resolve(parent)}.`);
  }
}

function instancePaths(instanceId) {
  const runtimeRoot = resolve(
    repositoryRoot,
    String(process.env.SPECTRA_LOCAL_ROOT ?? ".spectra-local"),
  );
  const instanceRoot = resolve(runtimeRoot, "instances", String(instanceId));
  assertInside(runtimeRoot, instanceRoot);
  return {
    runtimeRoot,
    instanceRoot,
    appEnv: resolve(instanceRoot, "env.local"),
    manifest: resolve(instanceRoot, "instance.json"),
    projectRoot: resolve(instanceRoot, "project"),
    projectEnv: resolve(instanceRoot, "project", ".env.local"),
    joinUrl: resolve(instanceRoot, "bootstrap-admin-invitation.txt"),
    summary: resolve(instanceRoot, "bootstrap-summary.json"),
  };
}

async function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) return resolveRun(stdout.trim());
      rejectRun(
        new Error(
          `${options.label ?? command} failed${stderr.trim() ? `: ${stderr.trim()}` : "."}`,
        ),
      );
    });
  });
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

async function convexRun(paths, env, args, label) {
  const output = await run(process.execPath, [convexCli, "run", ...args, "--deployment", "local", "--codegen", "disable", "--typecheck", "disable"], {
    cwd: paths.projectRoot,
    env: { ...process.env, ...env },
    label,
  });
  return parseJsonOutput(output, label);
}

function accountLookupSource(email) {
  return `const account = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", ${JSON.stringify(email)})).unique(); return account ? { clerkId: account.clerkId, email: account.email, name: account.name } : null;`;
}

function projectionSource(seedKey, adminEmail) {
  return `const saga = await ctx.db.query("schoolOnboardingSagas").withIndex("by_idempotency", q => q.eq("idempotencyKey", ${JSON.stringify(seedKey)})).unique(); if (!saga) return { school: null, saga: null, invitation: null, membership: null }; const school = await ctx.db.get(saga.schoolId); const invitation = saga.invitationId ? await ctx.db.get(saga.invitationId) : null; const admin = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", ${JSON.stringify(adminEmail)})).unique(); const memberships = admin ? await ctx.db.query("schoolMemberships").withIndex("by_account_status", q => q.eq("accountId", admin._id).eq("status", "active")).collect() : []; const membership = memberships.find(item => item.schoolId === saga.schoolId) ?? null; return { school: school ? { name: school.name, slug: school.slug, status: school.status } : null, saga: { idempotencyKey: saga.idempotencyKey, status: saga.status }, invitation: invitation ? { email: invitation.email, role: invitation.role, status: invitation.status } : null, membership: membership ? { role: membership.role, status: membership.status } : null };`;
}

async function writePrivateFile(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600);
}

async function main() {
  const options = parseSeedArguments(process.argv.slice(2));
  const instanceId = normalizeInstanceId(options.values.instance ?? "1");
  const paths = instancePaths(instanceId);
  for (const path of [paths.appEnv, paths.manifest, paths.projectEnv]) {
    if (!existsSync(path)) {
      throw new Error(
        `Local instance ${instanceId} is not configured. Start it once before seeding.`,
      );
    }
  }
  if (!existsSync(convexCli)) {
    throw new Error("Convex CLI is missing. Run npm ci in this worktree.");
  }
  const [appEnvText, projectEnvText, manifestText] = await Promise.all([
    readFile(paths.appEnv, "utf8"),
    readFile(paths.projectEnv, "utf8"),
    readFile(paths.manifest, "utf8"),
  ]);
  const appEnv = parseEnv(appEnvText);
  const projectEnv = parseEnv(projectEnvText);
  const manifest = JSON.parse(manifestText);
  assertLocalSeedTarget({ appEnv, projectEnv, ports: manifest.ports });
  const operatorEmail = resolveOperatorEmail(appEnv, options.values["operator-email"]);
  const adminEmail = options.values["admin-email"]
    ? options.values["admin-email"]
    : "";
  if (!adminEmail) {
    throw new Error("Pass account A with --admin-email after both local sign-ins.");
  }
  const material = seedMaterial({
    instanceId,
    env: appEnv,
    operatorEmail,
    adminEmail,
  });
  const runtimeEnv = { ...appEnv, ...projectEnv };

  const operator = await convexRun(
    paths,
    runtimeEnv,
    ["--inline-query", accountLookupSource(material.operatorEmail)],
    "Operator account lookup",
  );
  if (!operator) {
    throw new Error(
      "The secondary account is not registered locally. Sign profile B into the local app, then rerun the seed.",
    );
  }
  if (operator.email !== material.operatorEmail) {
    throw new Error("The local operator account does not match SUPER_ADMIN_EMAILS.");
  }

  if (!options.flags.has("verify-only")) {
    await convexRun(
      paths,
      runtimeEnv,
      [
        "schools:create",
        JSON.stringify(schoolCreateArgs(material)),
        "--identity",
        JSON.stringify(identityForAccount(operator)),
      ],
      "School onboarding saga",
    );
    const joinUrl = bootstrapJoinUrl(
      appEnv.NEXT_PUBLIC_APP_URL,
      material.invitationToken,
    );
    await writePrivateFile(paths.joinUrl, `${joinUrl}\n`);
  }

  const projection = await convexRun(
    paths,
    runtimeEnv,
    ["--inline-query", projectionSource(material.seedKey, material.adminEmail)],
    "Bootstrap projection verification",
  );
  const summary = verifyBootstrapProjection(projection, material);
  await writePrivateFile(
    paths.summary,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        instanceId,
        operatorEmail: material.operatorEmail,
        adminEmail: material.adminEmail,
        ...summary,
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `Local bootstrap ${options.flags.has("verify-only") ? "verified" : "seeded"} for instance ${instanceId}.\n` +
      `  School: ${summary.school}\n` +
      `  Saga: ${summary.sagaStatus}\n` +
      `  Account A established: ${summary.adminEstablished ? "yes" : "not yet — accept the saved invitation"}\n` +
      `  Private invitation file: ${paths.joinUrl}\n` +
      `  Summary: ${paths.summary}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
