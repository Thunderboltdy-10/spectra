import { describe, expect, it } from "vitest";
import {
  assertLocalSeedTarget,
  bootstrapJoinUrl,
  identityForAccount,
  resolveOperatorEmail,
  schoolCreateArgs,
  seedMaterial,
  verifyBootstrapProjection,
} from "./seed-config.mjs";

const env = {
  SUPER_ADMIN_EMAILS: "operator@example.test",
  SPECTRA_MASTER_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
};

describe("local bootstrap seed", () => {
  it("refuses cloud or mismatched targets before any mutation", () => {
    expect(() =>
      assertLocalSeedTarget({
        appEnv: { NEXT_PUBLIC_CONVEX_URL: "https://proper-orca.convex.cloud" },
        projectEnv: { CONVEX_DEPLOYMENT: "dev:proper-orca" },
        ports: { convexCloud: 3002 },
      }),
    ).toThrow("not this local instance");
    expect(() =>
      assertLocalSeedTarget({
        appEnv: { NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3002" },
        projectEnv: { CONVEX_DEPLOYMENT: "dev:proper-orca" },
        ports: { convexCloud: 3002 },
      }),
    ).toThrow("not local");
    expect(() =>
      assertLocalSeedTarget({
        appEnv: { NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3002" },
        projectEnv: { CONVEX_DEPLOYMENT: "local:instance-1" },
        ports: { convexCloud: 3002 },
      }),
    ).not.toThrow();
  });

  it("requires the selected operator to be registered in SUPER_ADMIN_EMAILS", () => {
    expect(resolveOperatorEmail(env)).toBe("operator@example.test");
    expect(() =>
      resolveOperatorEmail(env, "someone@example.test"),
    ).toThrow("not registered");
  });

  it("derives an idempotent private invitation and real saga arguments", () => {
    const first = seedMaterial({
      instanceId: 1,
      env,
      operatorEmail: "operator@example.test",
      adminEmail: "admin@example.test",
    });
    const second = seedMaterial({
      instanceId: 1,
      env,
      operatorEmail: "operator@example.test",
      adminEmail: "admin@example.test",
    });
    const otherInstance = seedMaterial({
      instanceId: 2,
      env,
      operatorEmail: "operator@example.test",
      adminEmail: "admin@example.test",
    });
    expect(second).toEqual(first);
    expect(otherInstance.invitationToken).not.toBe(first.invitationToken);
    expect(schoolCreateArgs(first)).toMatchObject({
      name: "The Global College",
      slug: "the-global-college",
      initialAdminEmail: "admin@example.test",
      tokenHash: first.tokenHash,
      idempotencyKey: first.seedKey,
    });
  });

  it("writes the private join URL on the Clerk-compatible localhost origin", () => {
    expect(
      bootstrapJoinUrl("http://127.0.0.1:3000", "private-token"),
    ).toBe("http://localhost:3000/join?token=private-token");
    expect(() =>
      bootstrapJoinUrl("https://spectra.example", "private-token"),
    ).toThrow("not a local app URL");
  });

  it("uses the signed-in operator identity and grades the whole saga projection", () => {
    expect(
      identityForAccount({
        clerkId: "user_operator",
        email: "operator@example.test",
        name: "Operator",
      }),
    ).toMatchObject({ subject: "user_operator", emailVerified: true });
    const material = seedMaterial({
      instanceId: 1,
      env,
      operatorEmail: "operator@example.test",
      adminEmail: "admin@example.test",
    });
    expect(
      verifyBootstrapProjection(
        {
          school: { name: "The Global College", slug: "the-global-college" },
          saga: { idempotencyKey: material.seedKey, status: "ready" },
          invitation: {
            email: "admin@example.test",
            role: "school_admin",
            status: "accepted",
          },
          membership: { role: "school_admin", status: "active" },
        },
        material,
      ),
    ).toMatchObject({ adminEstablished: true, sagaStatus: "ready" });
  });
});
