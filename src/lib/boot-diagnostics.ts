/**
 * Boot-time deployment consistency check.
 * Lightweight guardrail — logs warnings, never throws.
 */

type DiagnosticResult = {
  ok: boolean;
  message?: string;
};

type DeploymentSignal = "prod" | "dev" | "preview" | "local" | "unknown";

type DeploymentDescriptor = {
  signal: DeploymentSignal;
  deploymentId?: string;
};

function safeParseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function extractDeploymentId(rawValue: string) {
  const value = rawValue.trim();
  if (!value) return undefined;

  const parsedUrl = safeParseUrl(value);
  if (parsedUrl) {
    const host = parsedUrl.hostname.toLowerCase();
    const convexSuffixes = [".convex.cloud", ".convex.site", ".convex.run"];
    for (const suffix of convexSuffixes) {
      if (host.endsWith(suffix)) {
        const slug = host.slice(0, -suffix.length).split(".")[0]?.trim();
        return slug || undefined;
      }
    }
    return undefined;
  }

  const tail = value.includes(":")
    ? (value.split(":").at(-1)?.trim() ?? "")
    : value;
  const normalized = tail.split(/[/?#]/)[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    normalized === "prod" ||
    normalized === "dev" ||
    normalized === "preview" ||
    normalized === "production"
  ) {
    return undefined;
  }
  return normalized;
}

function detectSignal(rawValue: string): DeploymentSignal {
  const value = rawValue.trim();
  if (!value) return "unknown";
  const lower = value.toLowerCase();

  const parsedUrl = safeParseUrl(value);
  if (parsedUrl) {
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    ) {
      return "local";
    }
  }

  if (/^(prod|production)\b/.test(lower)) return "prod";
  if (/^dev\b/.test(lower)) return "dev";
  if (/^preview\b/.test(lower)) return "preview";
  if (/^local\b/.test(lower)) return "local";

  if (lower.includes("production") || lower.includes("prod")) return "prod";
  if (lower.includes("preview")) return "preview";
  if (lower.includes("development") || lower.includes("dev")) return "dev";

  return "unknown";
}

function parseDeploymentDescriptor(value: string): DeploymentDescriptor {
  return {
    signal: detectSignal(value),
    deploymentId: extractDeploymentId(value),
  };
}

/**
 * Inspects CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL to detect obvious
 * environment mismatches (e.g. one pointing to production while the other
 * points to a dev/preview/local deployment). Intended to be called at module load
 * time on the server so mismatches surface in build/startup logs.
 */
export function checkDeploymentConsistency(): DiagnosticResult {
  // Only run server-side — these are node process.env values.
  if (typeof process === "undefined") {
    return { ok: true };
  }

  const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
  const publicUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

  if (!deployment && !publicUrl) {
    // No Convex env vars configured — nothing to check.
    return { ok: true };
  }

  const deploymentDescriptor = parseDeploymentDescriptor(deployment);
  const urlDescriptor = parseDeploymentDescriptor(publicUrl);

  const idsKnown = Boolean(
    deploymentDescriptor.deploymentId && urlDescriptor.deploymentId,
  );
  const signalsKnown =
    deploymentDescriptor.signal !== "unknown" &&
    urlDescriptor.signal !== "unknown";

  if (
    idsKnown &&
    deploymentDescriptor.deploymentId !== urlDescriptor.deploymentId
  ) {
    const message =
      `[boot-diagnostics] Deployment mismatch: CONVEX_DEPLOYMENT resolves to "${deploymentDescriptor.deploymentId}" ` +
      `but NEXT_PUBLIC_CONVEX_URL resolves to "${urlDescriptor.deploymentId}". ` +
      `CONVEX_DEPLOYMENT="${deployment}" NEXT_PUBLIC_CONVEX_URL="${publicUrl}"`;

    console.warn(message);
    return { ok: false, message };
  }

  if (signalsKnown && deploymentDescriptor.signal !== urlDescriptor.signal) {
    const message =
      `[boot-diagnostics] CONVEX_DEPLOYMENT signals "${deploymentDescriptor.signal}" ` +
      `but NEXT_PUBLIC_CONVEX_URL signals "${urlDescriptor.signal}". ` +
      `These may point to different environments. ` +
      `CONVEX_DEPLOYMENT="${deployment}" NEXT_PUBLIC_CONVEX_URL="${publicUrl}"`;

    console.warn(message);
    return { ok: false, message };
  }

  return { ok: true };
}
