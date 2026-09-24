import { describe, expect, it } from "vitest";
import { createPreflightEvidence } from "./preflight-evidence.mjs";
import { validateEvidenceManifest } from "../reformation-evidence.mjs";

function manifest(overrides = {}, unit = "P8.P1") {
  const probes = Object.fromEntries(["web", "convex", "gateway", "bridge"].map((service) => [
    service, { service, status: "ready", detail: "fixture", ...overrides[service] },
  ]));
  return createPreflightEvidence({
    unit, commit: "fixture-revision", environment: {}, hashes: {}, probes, out: "preflight.json",
  });
}

describe("preflight evidence boundary", () => {
  it.each(["P8.P1", "RC.V1", "P8.V1"])("never invents browser or native evidence for %s", (unit) => {
    const evidence = validateEvidenceManifest(manifest({}, unit));
    expect(evidence.verdict).toBe("open");
    expect(evidence.steps.map((step) => step.id)).toEqual(["readiness", "bridge-readiness"]);
    expect(evidence.actors).toEqual([]);
    expect(evidence.repairs).toEqual([]);
    expect(evidence.budgets).toEqual({});
    expect(evidence.hashes).toEqual({});
    expect(evidence.environment.evidenceScope).toBe("service-health-only");
  });

  it.each(["web", "convex", "gateway"])("blocks unhealthy %s dependencies", (service) => {
    const evidence = manifest({ [service]: { status: "not_ready" } });
    expect(evidence.verdict).toBe("blocked");
    expect(evidence.steps[0].status).toBe("fail");
  });

  it("records Bridge failure separately without claiming native readiness", () => {
    const evidence = manifest({ bridge: { status: "not_ready", detail: "HTTP 503" } });
    expect(evidence.verdict).toBe("open");
    expect(evidence.steps[0].status).toBe("pass");
    expect(evidence.steps[1]).toMatchObject({ status: "fail", observed: "bridge=not_ready; HTTP 503" });
  });
});
