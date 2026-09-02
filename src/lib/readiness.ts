export type ReadinessStatus = "ready" | "degraded" | "not_ready";

export type ReadinessDependency = {
  status: ReadinessStatus;
  detail?: string;
};

export type WebHealthPayload = {
  service: "spectra-web";
  status: ReadinessStatus;
  protocolVersion: number;
  mode: "production" | "development";
  dependencies: {
    convex: ReadinessDependency;
    gateway: ReadinessDependency;
  };
};

export function composeReadinessStatus(
  dependencies: readonly ReadinessDependency[],
): ReadinessStatus {
  if (dependencies.some((dependency) => dependency.status === "not_ready")) {
    return "not_ready";
  }
  if (dependencies.some((dependency) => dependency.status === "degraded")) {
    return "degraded";
  }
  return "ready";
}

export function isWebHealthBody(value: unknown): value is WebHealthPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as WebHealthPayload;
  return (
    payload.service === "spectra-web" &&
    (payload.status === "ready" ||
      payload.status === "degraded" ||
      payload.status === "not_ready") &&
    payload.protocolVersion === 1
  );
}

export function webHealthPayload(input: {
  mode: "production" | "development";
  convex: ReadinessDependency;
  gateway: ReadinessDependency;
  protocolVersion?: number;
}): WebHealthPayload {
  const convex: ReadinessDependency = {
    status: input.convex.status === "ready" ? "ready" : "not_ready",
    ...(input.convex.detail ? { detail: input.convex.detail } : {}),
  };
  const gateway: ReadinessDependency = {
    status:
      input.gateway.status === "ready" || input.gateway.status === "degraded"
        ? input.gateway.status
        : "not_ready",
    ...(input.gateway.detail ? { detail: input.gateway.detail } : {}),
  };
  return {
    service: "spectra-web",
    status: composeReadinessStatus([convex, gateway]),
    protocolVersion: input.protocolVersion ?? 1,
    mode: input.mode,
    dependencies: { convex, gateway },
  };
}

async function probeJson(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json, text/plain" },
    });
    const text = await response.text();
    let body: unknown = text.trim();
    try {
      body = JSON.parse(text);
    } catch {
      // Convex /instance_name is text/plain; gateway health is JSON.
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        detail: error instanceof Error ? error.message : "fetch failed",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeConvexDependency(
  convexUrl: string | undefined,
  timeoutMs = 1_200,
): Promise<ReadinessDependency> {
  const base = String(convexUrl ?? "").trim().replace(/\/$/, "");
  if (!base) {
    return { status: "not_ready", detail: "Convex URL is not configured." };
  }
  const probed = await probeJson(`${base}/instance_name`, timeoutMs);
  const name =
    typeof probed.body === "string"
      ? probed.body.trim()
      : typeof (probed.body as { instanceName?: unknown } | null)?.instanceName ===
          "string"
        ? String((probed.body as { instanceName: string }).instanceName).trim()
        : "";
  if (probed.ok && name) {
    return { status: "ready", detail: name };
  }
  return {
    status: "not_ready",
    detail: probed.status
      ? `Convex answered HTTP ${probed.status}`
      : "Convex did not answer.",
  };
}

export async function probeGatewayDependency(
  gatewayUrl: string | undefined,
  timeoutMs = 1_200,
): Promise<ReadinessDependency> {
  const base = String(gatewayUrl ?? "").trim().replace(/\/$/, "");
  if (!base) {
    return {
      status: "not_ready",
      detail: "Collaboration gateway URL is not configured.",
    };
  }
  const probed = await probeJson(`${base}/_spectra/health`, timeoutMs);
  const body = probed.body as
    | { service?: unknown; status?: unknown }
    | null;
  if (
    probed.ok &&
    body?.service === "spectra-collaboration-gateway" &&
    (body.status === "ready" || body.status === "degraded")
  ) {
    return {
      status: body.status,
      detail: String(body.status),
    };
  }
  if (
    probed.ok &&
    body?.service === "spectra-collaboration-gateway" &&
    body.status === "not_ready"
  ) {
    return { status: "not_ready", detail: "Gateway dependencies are not ready." };
  }
  return {
    status: "not_ready",
    detail: probed.status
      ? `Gateway answered HTTP ${probed.status}`
      : "Gateway did not answer.",
  };
}

export function collaborationHealthUrlFromEnv(env: NodeJS.ProcessEnv) {
  const host = env.SPECTRA_COLLAB_HOST || "127.0.0.1";
  const port = env.SPECTRA_COLLAB_PORT || "1234";
  return `http://${host}:${port}`;
}
