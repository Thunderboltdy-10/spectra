import { describe, expect, it } from "vitest";
import {
  convexEnvFrom,
  derivedInstanceEnv,
  localConvexProjectPackage,
  normalizeInstanceId,
  parseEnv,
  portsForInstance,
  upsertEnv,
  validateRequiredEnv,
} from "./stack-config.mjs";

describe("local stack instance configuration", () => {
  it("maps at least three instances to non-overlapping deterministic port blocks", () => {
    const instances = [1, 2, 3].map((id) => portsForInstance(id));

    expect(instances).toEqual([
      {
        blockStart: 3000,
        web: 3000,
        collaboration: 3001,
        convexCloud: 3002,
        convexSite: 3003,
      },
      {
        blockStart: 3020,
        web: 3020,
        collaboration: 3021,
        convexCloud: 3022,
        convexSite: 3023,
      },
      {
        blockStart: 3040,
        web: 3040,
        collaboration: 3041,
        convexCloud: 3042,
        convexSite: 3043,
      },
    ]);
    expect(
      new Set(instances.flatMap((ports) => Object.values(ports).slice(1))).size,
    ).toBe(12);
  });

  it("rejects ids and strides that cannot produce a safe port block", () => {
    expect(() => normalizeInstanceId("zero")).toThrow("positive integer");
    expect(() => portsForInstance(1, { stride: 3 })).toThrow("at least 4");
    expect(() => portsForInstance(1_000, { base: 65_000, stride: 20 })).toThrow(
      "port range",
    );
  });

  it("derives a private Convex CLI project package from the repository contract", () => {
    expect(
      localConvexProjectPackage(
        { dependencies: { convex: "^1.41.0", unrelated: "1.0.0" } },
        3,
      ),
    ).toEqual({
      name: "spectra-local-instance-3",
      private: true,
      dependencies: { convex: "^1.41.0" },
    });
    expect(() => localConvexProjectPackage({ dependencies: {} }, 1)).toThrow(
      "must declare the Convex runtime dependency",
    );
  });

  it("derives every local-facing URL from the instance block", () => {
    const env = derivedInstanceEnv(2, portsForInstance(2));

    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3020");
    expect(env.NEXT_PUBLIC_CONVEX_URL).toBe("http://127.0.0.1:3022");
    expect(env.NEXT_PUBLIC_CONVEX_SITE_URL).toBe("http://127.0.0.1:3023");
    expect(env.NEXT_PUBLIC_SPECTRA_COLLAB_URL).toBe(
      "ws://127.0.0.1:3020/_spectra/realtime",
    );
    expect(env.SPECTRA_CONVEX_URL).toBe(env.NEXT_PUBLIC_CONVEX_URL);
  });

  it("preserves an env template while replacing only managed values", () => {
    const updated = upsertEnv(
      "# local secrets\nCLERK_SECRET_KEY='keep me'\nSPECTRA_WEB_PORT=9999\n",
      { SPECTRA_WEB_PORT: "3000", SPECTRA_APP_URL: "http://127.0.0.1:3000" },
    );

    expect(updated).toContain("# local secrets");
    expect(parseEnv(updated)).toMatchObject({
      CLERK_SECRET_KEY: "keep me",
      SPECTRA_WEB_PORT: "3000",
      SPECTRA_APP_URL: "http://127.0.0.1:3000",
    });
  });

  it("reports incomplete secrets and mirrors only the Convex runtime allowlist", () => {
    const env = {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test",
      CLERK_SECRET_KEY: "sk_test",
      CLERK_JWT_ISSUER_DOMAIN: "https://issuer.example",
      OPENROUTER_API_KEY: "router-key",
      SPECTRA_MASTER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      SPECTRA_COLLAB_TOKEN_SECRET: "t".repeat(32),
      SPECTRA_COLLAB_BRIDGE_KEY: "c".repeat(32),
      SPECTRA_CONNECTOR_BRIDGE_KEY: "m".repeat(32),
      SPECTRA_SECRET_BRIDGE_KEY: "s".repeat(32),
      SPECTRA_APP_URL: "http://127.0.0.1:3000",
      CLERK_SECRET_NOT_FOR_CONVEX: "never",
    };

    expect(validateRequiredEnv(env)).toEqual([]);
    expect(convexEnvFrom(env)).toMatchObject({
      CLERK_JWT_ISSUER_DOMAIN: "https://issuer.example",
      OPENROUTER_API_KEY: "router-key",
      SPECTRA_APP_URL: "http://127.0.0.1:3000",
      SPECTRA_COLLAB_BRIDGE_KEY: "c".repeat(32),
      SPECTRA_CONNECTOR_BRIDGE_KEY: "m".repeat(32),
      SPECTRA_SECRET_BRIDGE_KEY: "s".repeat(32),
    });
    expect(convexEnvFrom(env)).not.toHaveProperty("CLERK_SECRET_KEY");
  });
});
