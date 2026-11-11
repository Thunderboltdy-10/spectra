/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "session-student", email: "session@example.test", emailVerified: true };

async function seed(t: ReturnType<typeof convexTest>, withSchool: boolean) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Student", status: "active", createdAt: now, updatedAt: now });
    if (!withSchool) return { accountId };
    const schoolId = await ctx.db.insert("schools", { name: "School", slug: "school", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const membershipId = await ctx.db.insert("schoolMemberships", { schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    await ctx.db.insert("bridgeDevices", { accountId, state: "active" } as never).catch(() => undefined);
    return { accountId, schoolId, membershipId };
  });
}

it("answers the four session questions in one query, as the separate queries do (E4)", async () => {
  const t = convexTest(schema, modules);
  await seed(t, true);
  const user = t.withIdentity(identity);
  const session = await user.query(api.identity.session, {});
  expect(session).not.toBeNull();
  expect(session!.account).toEqual(await user.query(api.identity.account, {}));
  expect(session!.memberships).toEqual(await user.query(api.memberships.listMine, {}));
  expect(session!.catalog).toEqual(await user.query(api.catalogGraph.identity, {}));
  expect(session!.hasDevice).toBe(await user.query(api.bridge.hasDevice, {}));
});

it("still answers for someone with no school yet", async () => {
  const t = convexTest(schema, modules);
  await seed(t, false);
  const session = await t.withIdentity(identity).query(api.identity.session, {});
  expect(session).toMatchObject({ catalog: null, memberships: [], hasDevice: false });
  expect(session!.account).toMatchObject({ email: identity.email });
});

it("refuses when signed out, as identity:account does", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.identity.session, {})).rejects.toThrow("AUTH_NOT_SIGNED_IN");
});
