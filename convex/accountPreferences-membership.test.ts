/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const args = { scope: "device" as const, scopeKey: "device-one", values: { appearance: { density: "compact" } } };

function fixture() {
  const t = convexTest(schema, modules);
  const account = t.withIdentity({ subject: "new-user", email: "new@example.test", emailVerified: true });
  return { t, account };
}

describe("account preferences before joining a school", () => {
  it("distinguishes registration pending from an account with no saved preferences", async () => {
    const { account } = fixture();
    expect(await account.query(api.accountPreferences.layers, { deviceId: "device-one" })).toBeNull();
    await account.mutation(api.identity.registerSelf, {});
    expect(await account.query(api.accountPreferences.layers, { deviceId: "device-one" })).toEqual([]);
  });

  it("persists device and account layers without school membership and keeps them private", async () => {
    const { t, account } = fixture();
    await account.mutation(api.identity.registerSelf, {});
    await account.mutation(api.accountPreferences.writeLayer, args);
    await account.mutation(api.accountPreferences.writeLayer, { scope: "account", scopeKey: "account", values: { writing: { smartCompletion: false } } });
    const layers = await account.query(api.accountPreferences.layers, { deviceId: "device-one" });
    expect(layers).toHaveLength(2);
    expect(layers?.find(layer => layer.scope === "device")?.values).toMatchObject(args.values);
    expect(layers?.find(layer => layer.scope === "account")?.values).toMatchObject({ writing: { smartCompletion: false } });
    const other = t.withIdentity({ subject: "other-user", email: "other@example.test", emailVerified: true });
    await other.mutation(api.identity.registerSelf, {});
    expect(await other.query(api.accountPreferences.layers, { deviceId: "device-one" })).toEqual([]);
  });

  it("still rejects unregistered and inactive accounts", async () => {
    const { t, account } = fixture();
    await expect(account.mutation(api.accountPreferences.writeLayer, args)).rejects.toThrow("AUTH_ACCOUNT_REQUIRED");
    const id = await account.mutation(api.identity.registerSelf, {});
    const unverified = t.withIdentity({ subject: "new-user", email: "new@example.test", emailVerified: false });
    await expect(unverified.mutation(api.accountPreferences.writeLayer, args)).rejects.toThrow("AUTH_EMAIL_UNVERIFIED");
    await t.run(ctx => ctx.db.patch(id, { status: "deactivated" }));
    await expect(account.mutation(api.accountPreferences.writeLayer, args)).rejects.toThrow("AUTH_ACCOUNT_REQUIRED");
    expect(await account.query(api.accountPreferences.layers, { deviceId: "device-one" })).toBeNull();
  });
});
