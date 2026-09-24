import { createEvidenceManifest, evidenceStep } from "../reformation-evidence.mjs";

/** Health probes cannot attest to authenticated journeys, native writes, or a release. */
export function createPreflightEvidence({ unit, commit, environment, hashes, probes, out }) {
  const { web, convex, gateway, bridge } = probes;
  const dependenciesReady = [web, convex, gateway].every((probe) => probe.status === "ready");
  return createEvidenceManifest({
    unit,
    commit,
    environment: { ...environment, evidenceScope: "service-health-only" },
    hashes,
    actors: [],
    steps: [
      evidenceStep({
        id: "readiness",
        attempted: "Probe web, Convex, and collaboration gateway health",
        observed: `web=${web.status}; convex=${convex.status}; gateway=${gateway.status}`,
        believed: "Dependency health does not verify authenticated data access or the served source revision.",
        evidence: [out],
        status: dependenciesReady ? "pass" : "fail",
      }),
      evidenceStep({
        id: "bridge-readiness",
        attempted: "Probe the local Bridge health endpoint",
        observed: `bridge=${bridge.status}; ${bridge.detail}`,
        believed: "A listening or paired Bridge does not verify grants, a native write, or its receipt.",
        evidence: [out],
        status: bridge.status === "ready" ? "pass" : "fail",
      }),
    ],
    observations: [
      ...Object.values(probes).map((probe) => `${probe.service}: ${probe.detail}`),
      "No browser, authenticated actor, mount inventory, Office application, AI operation, restart, migration, or rollback was exercised by this command.",
      "The local BUILD_ID and its SHA-256 identify a build-id file only; they do not prove which source or process serves these endpoints.",
      "Release acceptance remains open even when every health probe passes. Bridge failures block native acceptance separately from web dependency readiness.",
    ],
    verdict: dependenciesReady ? "open" : "blocked",
  });
}
