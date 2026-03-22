/**
 * Boot-time deployment consistency check.
 * Lightweight guardrail — logs warnings, never throws.
 */

type DiagnosticResult = {
  ok: boolean;
  message?: string;
};

/**
 * Inspects CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL to detect obvious
 * environment mismatches (e.g. one pointing to production while the other
 * points to a dev/preview deployment). Intended to be called at module load
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

  // Determine environment signal from each variable.
  function envSignal(value: string): "prod" | "dev" | "preview" | "unknown" {
    if (!value) return "unknown";
    const v = value.toLowerCase();
    if (v.includes("prod")) return "prod";
    if (v.includes("dev")) return "dev";
    if (v.includes("preview")) return "preview";
    return "unknown";
  }

  const deploymentSignal = envSignal(deployment);
  const urlSignal = envSignal(publicUrl);

  const bothKnown = deploymentSignal !== "unknown" && urlSignal !== "unknown";

  if (bothKnown && deploymentSignal !== urlSignal) {
    const message =
      `[boot-diagnostics] CONVEX_DEPLOYMENT signals "${deploymentSignal}" ` +
      `but NEXT_PUBLIC_CONVEX_URL signals "${urlSignal}". ` +
      `These may point to different environments. ` +
      `CONVEX_DEPLOYMENT="${deployment}" NEXT_PUBLIC_CONVEX_URL="${publicUrl}"`;

    console.warn(message);
    return { ok: false, message };
  }

  return { ok: true };
}
