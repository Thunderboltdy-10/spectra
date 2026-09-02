import { describe, expect, it } from "vitest";
import {
  createEvidenceManifest,
  evidenceStep,
  validateEvidenceManifest,
} from "./reformation-evidence.mjs";

describe("reformation evidence manifest", () => {
  it("accepts the shared RC.V1 / P8.V1 shape", () => {
    const manifest = createEvidenceManifest({
      unit: "P8.P1",
      commit: "abc123",
      environment: {
        node: "v24.11.1",
        mode: "production",
        convexUrl: "http://127.0.0.1:3002",
      },
      hashes: { fixture: { sha256: "a".repeat(64), path: "fixture.docx" } },
      actors: [{ id: "A", role: "school_admin" }],
      steps: [
        evidenceStep({
          id: "sign-in",
          attempted: "Open workspace signed in as A",
          observed: "Library loaded",
          believed: "Session is usable",
        }),
      ],
      observations: ["Gateway ready"],
      budgets: { firstPaintRequests: 14 },
      repairs: [],
      verdict: "open",
    });
    expect(validateEvidenceManifest(manifest).unit).toBe("P8.P1");
  });

  it("refuses secret-shaped environment fields", () => {
    expect(() =>
      validateEvidenceManifest(
        createEvidenceManifest({
          unit: "P8.P1",
          commit: "abc123",
          environment: { CLERK_SECRET_KEY: "sk-test" },
        }),
      ),
    ).toThrow(/secret field/i);
  });
});
