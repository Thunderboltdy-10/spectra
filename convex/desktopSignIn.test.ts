/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { DESKTOP_SIGN_IN_TTL_MS } from "./desktopSignIn";

const modules = import.meta.glob("./**/*.ts");
const id = (fill: string) => fill.repeat(64);
const sealed = "A".repeat(60);

async function signedIn(t: ReturnType<typeof convexTest>) {
  const clerkId = `clerk_desktop_${crypto.randomUUID()}`;
  await t.run((ctx) => ctx.db.insert("accounts", {
    clerkId, email: "desktop@example.test", emailVerified: true, name: "Desktop", status: "active", createdAt: Date.now(), updatedAt: Date.now(),
  }));
  return t.withIdentity({ subject: clerkId, email: "desktop@example.test", emailVerified: true });
}

afterEach(() => vi.useRealTimers());

describe("desktop sign-in handoff", () => {
  it("hands a sealed sign-in to the window once, then it is gone", async () => {
    const t = convexTest(schema, modules);
    const me = await signedIn(t);
    expect(await t.query(api.desktopSignIn.waiting, { handoffId: id("a") })).toBe(false);
    await me.mutation(api.desktopSignIn.hand, { handoffId: id("a"), sealed });
    expect(await t.query(api.desktopSignIn.waiting, { handoffId: id("a") })).toBe(true);
    // The window needs no session: the id is its proof, and it takes the seal once.
    expect(await t.mutation(api.desktopSignIn.take, { handoffId: id("a") })).toBe(sealed);
    expect(await t.mutation(api.desktopSignIn.take, { handoffId: id("a") })).toBeNull();
    expect(await t.query(api.desktopSignIn.waiting, { handoffId: id("a") })).toBe(false);
  });

  it("refuses strangers, malformed links, reuse, and a pile of waiting sign-ins", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.desktopSignIn.hand, { handoffId: id("b"), sealed })).rejects.toThrow("AUTH_NOT_SIGNED_IN");
    const me = await signedIn(t);
    await expect(me.mutation(api.desktopSignIn.hand, { handoffId: "nope", sealed })).rejects.toThrow("DESKTOP_SIGN_IN_INVALID");
    await expect(me.mutation(api.desktopSignIn.hand, { handoffId: id("b"), sealed: "short" })).rejects.toThrow("DESKTOP_SIGN_IN_INVALID");
    await me.mutation(api.desktopSignIn.hand, { handoffId: id("b"), sealed });
    await expect(me.mutation(api.desktopSignIn.hand, { handoffId: id("b"), sealed })).rejects.toThrow("DESKTOP_SIGN_IN_USED");
    await me.mutation(api.desktopSignIn.hand, { handoffId: id("c"), sealed });
    await me.mutation(api.desktopSignIn.hand, { handoffId: id("d"), sealed });
    await expect(me.mutation(api.desktopSignIn.hand, { handoffId: id("e"), sealed })).rejects.toThrow("DESKTOP_SIGN_IN_BUSY");
  });

  it("expires a sign-in nobody took", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const me = await signedIn(t);
    await me.mutation(api.desktopSignIn.hand, { handoffId: id("f"), sealed });
    vi.advanceTimersByTime(DESKTOP_SIGN_IN_TTL_MS + 1);
    expect(await t.query(api.desktopSignIn.waiting, { handoffId: id("f") })).toBe(false);
    expect(await t.mutation(api.desktopSignIn.take, { handoffId: id("f") })).toBeNull();
    await me.mutation(api.desktopSignIn.hand, { handoffId: id("0"), sealed });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("desktopSignIns").collect())).toHaveLength(0);
  });
});
