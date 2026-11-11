import { pathToFileURL } from "node:url";

// Deploy gate for the Next.js tier. Runtime code keeps lenient development
// fallbacks (inline AI runs without SPECTRA_APP_URL, localhost URLs, Clerk
// development keys, the env ManageBac key); on a production deployment each of
// those silently changes behaviour for every school instead of failing. This
// runs in `prebuild` and fails a Vercel production build, reports the same
// problems as warnings on preview builds, and stays silent elsewhere (local
// stacks build with their own development environment).
// Convex-side variables live in the Convex deployment and are not visible
// here; the P2 ops report lists them for the deploy checklist.

const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|[^.]+\.localhost)$/i;

const BRIDGE_SECRETS = [
  "SPECTRA_SECRET_BRIDGE_KEY",
  "SPECTRA_COLLAB_BRIDGE_KEY",
  "SPECTRA_COLLAB_TOKEN_SECRET",
  "SPECTRA_CONNECTOR_BRIDGE_KEY",
];
// Optional keys: each falls back to a bridge key when unset, but a short
// value is picked over the fallback and then rejected at request time.
const OPTIONAL_SECRETS = [
  "SPECTRA_AGENT_EVAL_BRIDGE_KEY",
  "SPECTRA_AGENT_MANIFEST_SIGNING_KEY",
  "SPECTRA_MANAGEBAC_WORKER_HTTP_KEY",
];
const DEVELOPMENT_ONLY = {
  MANAGEBAC_API_KEY: "lets a blank admin token fall back to one shared ManageBac key",
  SPECTRA_TEST_INLINE_RUNS: "runs every AI run inside the request instead of the durable scheduler",
  SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN: "points ManageBac at a local fixture server",
  SPECTRA_ALLOW_LOCAL_MANAGEBAC_FIXTURE: "allows local ManageBac fixtures",
  SPECTRA_LOCAL_INSTANCE: "writes provider logs to the local filesystem",
  SPECTRA_LOCAL_SELF_HOSTED: "enables local rehearsal helpers",
};

const value = (env, name) => env[name]?.trim() ?? "";

// Spectra has no built-in model: src/features/spectra/ai/model-config.ts reads
// these and throws at request time when they are missing, so fail the build first.
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:/-]*$/i;
const REASONING_PROFILES = ["none", "minimal", "low", "medium", "high", "xhigh"];

function modelProblems(env) {
  const problems = [];
  for (const name of ["SPECTRA_MODEL_ID", "SPECTRA_FALLBACK_MODEL_ID"]) {
    const model = value(env, name);
    if (!model && name === "SPECTRA_MODEL_ID") problems.push(`${name} is missing (the model every Spectra turn uses).`);
    else if (model && !MODEL_ID.test(model)) problems.push(`${name} must be an OpenRouter model id like "vendor/model".`);
  }
  const profile = value(env, "SPECTRA_REASONING_PROFILE").toLowerCase();
  if (!REASONING_PROFILES.includes(profile))
    problems.push(`SPECTRA_REASONING_PROFILE must be one of ${REASONING_PROFILES.join(", ")}.`);
  if (!value(env, "SPECTRA_MODEL_PROVIDER"))
    problems.push("SPECTRA_MODEL_PROVIDER is missing (the OpenRouter provider that serves the model).");
  return problems;
}

function remoteUrl(env, name, protocols, purpose) {
  const raw = value(env, name);
  if (!raw) return `${name} is missing (${purpose}).`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return `${name} is not a URL (${purpose}).`;
  }
  if (!protocols.includes(url.protocol)) return `${name} must use ${protocols.map((p) => p.slice(0, -1)).join(" or ")} (${purpose}).`;
  if (LOCAL_HOST.test(url.hostname)) return `${name} points at ${url.hostname} (${purpose}).`;
  return null;
}

/** Problems that make a production deployment run in a development mode. */
export function deployEnvProblems(env) {
  const problems = [];
  const add = (problem) => problem && problems.push(problem);

  add(remoteUrl(env, "NEXT_PUBLIC_CONVEX_URL", ["https:"], "Convex deployment"));
  add(remoteUrl(env, "SPECTRA_APP_URL", ["https:"],
    "Convex scheduled callbacks; without it every AI run executes inline in the request"));
  add(remoteUrl(env, "NEXT_PUBLIC_SPECTRA_COLLAB_URL", ["wss:"], "realtime collaboration gateway"));
  if (!value(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY").startsWith("pk_live_"))
    add("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a production (pk_live_) key.");
  if (!value(env, "CLERK_SECRET_KEY").startsWith("sk_live_"))
    add("CLERK_SECRET_KEY must be a production (sk_live_) key.");
  if (!value(env, "CLERK_WEBHOOK_SECRET")) add("CLERK_WEBHOOK_SECRET is missing (Clerk account sync).");
  if (!value(env, "OPENROUTER_API_KEY")) add("OPENROUTER_API_KEY is missing (all AI features).");
  if (!value(env, "SPECTRA_AGENT_HUB_URL")) add("SPECTRA_AGENT_HUB_URL is missing (Codex and Claude Code through the Bridge).");
  for (const problem of modelProblems(env)) add(problem);

  const key = Buffer.from(value(env, "SPECTRA_MASTER_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) add("SPECTRA_MASTER_ENCRYPTION_KEY must be 32 base64-encoded bytes.");
  for (const name of BRIDGE_SECRETS)
    if (value(env, name).length < 32) add(`${name} must be at least 32 characters.`);
  for (const name of OPTIONAL_SECRETS)
    if (value(env, name) && value(env, name).length < 32) add(`${name} is set but shorter than 32 characters.`);
  const seen = new Map();
  for (const name of [...BRIDGE_SECRETS, ...OPTIONAL_SECRETS]) {
    const secret = value(env, name);
    if (secret && seen.has(secret)) add(`${name} reuses the value of ${seen.get(secret)}; each trust boundary needs its own key.`);
    else if (secret) seen.set(secret, name);
  }

  for (const [name, effect] of Object.entries(DEVELOPMENT_ONLY))
    if (value(env, name)) add(`${name} must not be set in production: it ${effect}.`);
  return problems;
}

function main() {
  const target = process.env.VERCEL_ENV;
  if (target !== "production" && target !== "preview") {
    console.log("Deploy env check skipped (not a Vercel production or preview build).");
    return;
  }
  const problems = deployEnvProblems(process.env);
  if (!problems.length) {
    console.log(`Deploy env check passed for ${target}.`);
    return;
  }
  const log = target === "production" ? console.error : console.warn;
  log(`Deploy env check found ${problems.length} problem(s) for ${target}:`);
  for (const problem of problems) log(`- ${problem}`);
  if (target === "production") process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
