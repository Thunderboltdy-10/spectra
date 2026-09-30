import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { gatewayHealthPayload, isGatewayHealthBody } from "../collaboration-health.mjs";

export { gatewayHealthPayload, isGatewayHealthBody };

const BRIDGE_DEFAULT_URL = "http://127.0.0.1:47615";

async function fetchJson(url, timeoutMs = 1_500, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", ...headers },
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.trim();
    }
    return {
      ok: response.ok, status: response.status, body,
      allowedOrigin: response.headers.get("access-control-allow-origin"),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : "fetch failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function isServiceReady(payload) {
  return payload?.status === "ready";
}

export async function probeConvexReadiness(convexUrl) {
  const base = String(convexUrl ?? "").replace(/\/$/, "");
  if (!base) {
    return { service: "convex", status: "not_ready", detail: "Convex URL missing" };
  }
  const probed = await fetchJson(`${base}/instance_name`);
  const name =
    typeof probed.body === "string"
      ? probed.body.trim()
      : typeof probed.body?.instanceName === "string"
        ? probed.body.instanceName.trim()
        : "";
  if (probed.ok && name) {
    return { service: "convex", status: "ready", detail: name };
  }
  return {
    service: "convex",
    status: "not_ready",
    detail: probed.status ? `HTTP ${probed.status}` : String(probed.body),
  };
}

export async function probeGatewayReadiness(gatewayOrigin) {
  const base = String(gatewayOrigin ?? "").replace(/\/$/, "");
  const probed = await fetchJson(`${base}/_spectra/health`);
  if (probed.ok && isGatewayHealthBody(probed.body)) {
    return {
      service: probed.body.service,
      status: probed.body.status,
      detail: probed.body.dependencies?.convex?.status ?? probed.body.status,
      body: probed.body,
    };
  }
  return {
    service: "spectra-collaboration-gateway",
    status: "not_ready",
    detail: probed.status ? `HTTP ${probed.status}` : String(probed.body),
  };
}

export async function probeWebReadiness(webOrigin) {
  const base = String(webOrigin ?? "").replace(/\/$/, "");
  const probed = await fetchJson(`${base}/api/health`, 4_000);
  if (
    probed.ok &&
    probed.body?.service === "spectra-web" &&
    (probed.body.status === "ready" ||
      probed.body.status === "degraded" ||
      probed.body.status === "not_ready")
  ) {
    return {
      service: probed.body.service,
      status: probed.body.status,
      detail: probed.body.mode,
      body: probed.body,
    };
  }
  return {
    service: "spectra-web",
    status: "not_ready",
    detail: probed.status ? `HTTP ${probed.status}` : String(probed.body),
  };
}

export async function probeBridgeReadiness(bridgeUrl = BRIDGE_DEFAULT_URL, browserOrigin) {
  const base = String(bridgeUrl ?? BRIDGE_DEFAULT_URL).replace(/\/$/, "");
  const probed = await fetchJson(
    `${base}/v1/health`, 1_500, browserOrigin ? { Origin: browserOrigin } : {},
  );
  const body = probed.body;
  // Rust HealthResponse uses serde(rename_all = "camelCase"). Retain legacy
  // snake_case compatibility for older local Bridge builds.
  const protocolVersion = body?.protocolVersion ?? body?.protocol_version;
  const bindError = body?.bindError ?? body?.bind_error;
  if (
    probed.ok &&
    body &&
    typeof body === "object" &&
    typeof protocolVersion === "string" &&
    protocolVersion.trim() &&
    typeof body.paired === "boolean" &&
    !bindError
  ) {
    if (browserOrigin && probed.allowedOrigin !== browserOrigin) {
      return {
        service: "spectra-bridge", status: "not_ready",
        detail: `Bridge does not allow ${browserOrigin}. Restart it through this local launcher to configure the app origin.`,
        body,
      };
    }
    return {
      service: "spectra-bridge",
      status: "ready",
      detail: body.paired ? "paired" : "listening",
      body,
    };
  }
  if (probed.ok && bindError) {
    return {
      service: "spectra-bridge",
      status: "not_ready",
      detail: String(bindError),
      body,
    };
  }
  return {
    service: "spectra-bridge",
    status: "not_ready",
    detail: probed.status ? `HTTP ${probed.status}` : String(probed.body),
  };
}

export function commandVersion(command, args = ["--version"]) {
  const candidates =
    process.platform === "win32" && !/[.]/.test(command)
      ? [`${command}.cmd`, command]
      : [command];
  for (const bin of candidates) {
    const result = spawnSync(bin, args, {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      return String(result.stdout || result.stderr)
        .trim()
        .split(/\r?\n/)[0];
    }
  }
  return null;
}

export async function productionBuildHash(repositoryRoot) {
  const buildIdPath = resolve(repositoryRoot, ".next", "BUILD_ID");
  if (!existsSync(buildIdPath)) return null;
  const buildId = (await readFile(buildIdPath, "utf8")).trim();
  return {
    buildId,
    sha256: createHash("sha256").update(buildId).digest("hex"),
  };
}
