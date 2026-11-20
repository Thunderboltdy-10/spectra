import { v } from "convex/values";
import { internalMutation, mutation, query } from "./functions";
import { internal } from "./_generated/api";
import { getAuthenticatedAccount } from "./identityShared";

/*
 * Signing in to Spectra for desktop from the person's own browser.
 *
 * The desktop window makes a secret and opens the browser with it. Signed in
 * there, the person confirms; the browser gets a short-lived Clerk sign-in
 * ticket, seals it with a key derived from the secret, and hands it here under
 * an id also derived from the secret. The window, watching that id, takes it
 * once and opens the seal. This server never sees the ticket itself, and a row
 * lives for two minutes at most.
 */

/** How long a handed sign-in waits for the window that asked for it. */
export const DESKTOP_SIGN_IN_TTL_MS = 2 * 60_000;
const HANDOFF_ID = /^[a-f0-9]{64}$/;
const SEALED = /^[A-Za-z0-9_-]{40,4096}$/;
const LIVE_PER_ACCOUNT = 3;

export const hand = mutation({
  args: { handoffId: v.string(), sealed: v.string() },
  handler: async (ctx, args) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED: Sign in to Spectra in this browser first.");
    if (!HANDOFF_ID.test(args.handoffId) || !SEALED.test(args.sealed)) {
      throw new Error("DESKTOP_SIGN_IN_INVALID: This sign-in link is not complete. Start again from Spectra for desktop.");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("desktopSignIns")
      .withIndex("by_handoff", (q) => q.eq("handoffId", args.handoffId))
      .unique();
    if (existing) throw new Error("DESKTOP_SIGN_IN_USED: This sign-in link was already used. Start again from Spectra for desktop.");
    const live = await ctx.db
      .query("desktopSignIns")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .take(LIVE_PER_ACCOUNT + 1);
    let waiting = 0;
    for (const row of live) {
      if (row.expiresAt <= now) await ctx.db.delete(row._id);
      else waiting += 1;
    }
    if (waiting >= LIVE_PER_ACCOUNT) {
      throw new Error("DESKTOP_SIGN_IN_BUSY: A few sign-ins are already waiting. Wait two minutes, then try again.");
    }
    const id = await ctx.db.insert("desktopSignIns", {
      handoffId: args.handoffId,
      accountId: account._id,
      sealed: args.sealed,
      expiresAt: now + DESKTOP_SIGN_IN_TTL_MS,
    });
    await ctx.scheduler.runAfter(DESKTOP_SIGN_IN_TTL_MS + 5_000, internal.desktopSignIn.expire, { id });
    return { expiresAt: now + DESKTOP_SIGN_IN_TTL_MS };
  },
});

/** Whether a sign-in is waiting for this window. One tiny indexed read. */
export const waiting = query({
  args: { handoffId: v.string() },
  handler: async (ctx, args) => {
    if (!HANDOFF_ID.test(args.handoffId)) return false;
    const row = await ctx.db
      .query("desktopSignIns")
      .withIndex("by_handoff", (q) => q.eq("handoffId", args.handoffId))
      .unique();
    return Boolean(row && row.expiresAt > Date.now());
  },
});

/** The sealed sign-in, once. */
export const take = mutation({
  args: { handoffId: v.string() },
  handler: async (ctx, args) => {
    if (!HANDOFF_ID.test(args.handoffId)) return null;
    const row = await ctx.db
      .query("desktopSignIns")
      .withIndex("by_handoff", (q) => q.eq("handoffId", args.handoffId))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row.expiresAt > Date.now() ? row.sealed : null;
  },
});

export const expire = internalMutation({
  args: { id: v.id("desktopSignIns") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.id)) await ctx.db.delete(args.id);
  },
});
