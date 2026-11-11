const DEFAULT_PORT_BASE = 3000;
const DEFAULT_PORT_STRIDE = 20;

export const INSTANCE_SCHEMA_VERSION = 1;

/** Services whose death must not take down Convex. */
export const RESTARTABLE_SERVICE_LABELS = Object.freeze([
  "Collaboration gateway",
  "Next.js",
]);

/**
 * Collaboration is a restart-safe peer (ARCHITECTURE-PLATFORM): rooms reload
 * from Convex. Treating its exit as instance death makes gateway-kill recovery
 * untestable and turns a realtime outage into a whole-school outage.
 */
export function isFatalServiceExit(label) {
  return !RESTARTABLE_SERVICE_LABELS.includes(String(label ?? ""));
}

/** Local SQLite can take ~5 minutes to bind after a restart (P6.V1). */
export const LOCAL_CONVEX_BACKEND_STARTUP_TIMEOUT_SECS = 900;

/** A saved local deployment can be restarted from its pinned cached backend
 * without asking Convex Cloud to reselect the project. */
export function savedBackendArguments(config, stateDirectory) {
  const name = String(config?.deploymentName ?? "").trim();
  const secret = String(config?.instanceSecret ?? "").trim();
  const cloud = config?.ports?.cloud;
  const site = config?.ports?.site;
  if (!name || !secret || !Number.isSafeInteger(cloud) || !Number.isSafeInteger(site))
    throw new Error("Saved local Convex configuration is incomplete; refusing to select another deployment.");
  return [
    "--port", String(cloud),
    "--site-proxy-port", String(site),
    "--instance-name", name,
    "--instance-secret", secret,
    "--local-storage", `${stateDirectory}/convex_local_storage`,
    "--beacon-tag", "cli-local-dev",
    `${stateDirectory}/convex_local_backend.sqlite3`,
  ];
}

export function withLocalConvexCliEnv(env = {}) {
  return {
    ...env,
    CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: String(
      LOCAL_CONVEX_BACKEND_STARTUP_TIMEOUT_SECS,
    ),
  };
}

export const CONVEX_ENV_KEYS = [
  "CLERK_JWT_ISSUER_DOMAIN",
  "OPENROUTER_API_KEY",
  "SPECTRA_AGENT_EVAL_BRIDGE_KEY",
  "SPECTRA_AGENT_HUB_URL",
  "SPECTRA_APP_URL",
  "SPECTRA_COLLAB_BRIDGE_KEY",
  "SPECTRA_CONNECTOR_BRIDGE_KEY",
  "SPECTRA_EMBEDDING_MODEL",
  "SPECTRA_EMBEDDING_PROVIDER",
  "SPECTRA_SECRET_BRIDGE_KEY",
  "SUPER_ADMIN_EMAILS",
];

const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_JWT_ISSUER_DOMAIN",
  "OPENROUTER_API_KEY",
  "SPECTRA_MODEL_ID",
  "SPECTRA_REASONING_PROFILE",
  "SPECTRA_MODEL_PROVIDER",
  "SPECTRA_MASTER_ENCRYPTION_KEY",
  "SPECTRA_COLLAB_TOKEN_SECRET",
  "SPECTRA_COLLAB_BRIDGE_KEY",
  "SPECTRA_CONNECTOR_BRIDGE_KEY",
  "SPECTRA_SECRET_BRIDGE_KEY",
];

const STRONG_SECRET_KEYS = [
  "SPECTRA_COLLAB_TOKEN_SECRET",
  "SPECTRA_COLLAB_BRIDGE_KEY",
  "SPECTRA_CONNECTOR_BRIDGE_KEY",
  "SPECTRA_SECRET_BRIDGE_KEY",
];

export function normalizeInstanceId(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      "Instance id must be a positive integer (for example: --instance 1).",
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 1_000) {
    throw new Error("Instance id must be between 1 and 1000.");
  }
  return parsed;
}

export function localConvexProjectPackage(repositoryPackage, instanceId) {
  const id = normalizeInstanceId(instanceId);
  const convexVersion = repositoryPackage?.dependencies?.convex;
  if (typeof convexVersion !== "string" || !convexVersion.trim()) {
    throw new Error(
      "The repository package.json must declare the Convex runtime dependency.",
    );
  }
  return {
    name: `spectra-local-instance-${id}`,
    private: true,
    dependencies: { convex: convexVersion },
  };
}

export function portsForInstance(
  instanceId,
  { base = DEFAULT_PORT_BASE, stride = DEFAULT_PORT_STRIDE } = {},
) {
  const id = normalizeInstanceId(instanceId);
  if (!Number.isInteger(base) || base < 1_024) {
    throw new Error("The local port base must be an integer of at least 1024.");
  }
  if (!Number.isInteger(stride) || stride < 4) {
    throw new Error("The local port stride must be an integer of at least 4.");
  }
  const blockStart = base + (id - 1) * stride;
  const ports = {
    blockStart,
    web: blockStart,
    collaboration: blockStart + 1,
    convexCloud: blockStart + 2,
    convexSite: blockStart + 3,
  };
  if (Math.max(...Object.values(ports)) > 65_535) {
    throw new Error(`Instance ${id} maps beyond the valid TCP port range.`);
  }
  return ports;
}

function decodeEnvValue(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnv(text) {
  const result = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    result[match[1]] = decodeEnvValue(match[2]);
  }
  return result;
}

function encodeEnvValue(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (/^[A-Za-z0-9_./:@+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

export function upsertEnv(text, updates) {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const pending = new Map(
    Object.entries(updates).map(([key, value]) => [key, encodeEnvValue(value)]),
  );
  const output = lines.map((line) => {
    const match = /^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match || !pending.has(match[2])) return line;
    const value = pending.get(match[2]);
    pending.delete(match[2]);
    return `${match[1]}${match[2]}=${value}`;
  });
  if (pending.size > 0 && output.at(-1) !== "") output.push("");
  for (const [key, value] of pending) output.push(`${key}=${value}`);
  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

export function derivedInstanceEnv(instanceId, ports) {
  const id = normalizeInstanceId(instanceId);
  const appUrl = `http://localhost:${ports.web}`;
  const convexUrl = `http://127.0.0.1:${ports.convexCloud}`;
  return {
    SPECTRA_LOCAL_INSTANCE: String(id),
    SPECTRA_WEB_HOST: "localhost",
    SPECTRA_WEB_PORT: String(ports.web),
    SPECTRA_COLLAB_HOST: "127.0.0.1",
    SPECTRA_COLLAB_PORT: String(ports.collaboration),
    NEXT_PUBLIC_APP_URL: appUrl,
    SPECTRA_APP_URL: appUrl,
    SPECTRA_APP_ORIGIN: appUrl,
    NEXT_PUBLIC_CONVEX_URL: convexUrl,
    NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${ports.convexSite}`,
    NEXT_PUBLIC_SPECTRA_COLLAB_URL: `ws://localhost:${ports.web}/_spectra/realtime`,
    SPECTRA_CONVEX_URL: convexUrl,
  };
}

export function validateRequiredEnv(env) {
  const problems = [];
  for (const key of REQUIRED_ENV_KEYS) {
    if (!String(env[key] ?? "").trim()) problems.push(`${key} is empty`);
  }
  for (const key of STRONG_SECRET_KEYS) {
    const value = String(env[key] ?? "");
    if (value && value.length < 32)
      problems.push(`${key} must contain at least 32 characters`);
  }

  const encodedMasterKey = String(
    env.SPECTRA_MASTER_ENCRYPTION_KEY ?? "",
  ).trim();
  if (encodedMasterKey) {
    let byteLength = -1;
    try {
      byteLength = Buffer.from(encodedMasterKey, "base64").length;
    } catch {
      byteLength = -1;
    }
    if (byteLength !== 32) {
      problems.push(
        "SPECTRA_MASTER_ENCRYPTION_KEY must encode exactly 32 bytes as base64",
      );
    }
  }
  return problems;
}

export function convexEnvFrom(appEnv) {
  return Object.fromEntries(
    CONVEX_ENV_KEYS.flatMap((key) => {
      const value = String(appEnv[key] ?? "").trim();
      return value ? [[key, value]] : [];
    }),
  );
}

export function serializeEnv(env) {
  return `${Object.entries(env)
    .map(([key, value]) => `${key}=${encodeEnvValue(value)}`)
    .join("\n")}\n`;
}
