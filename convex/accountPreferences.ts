import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import {
  PREFERENCE_SCHEMA_VERSION,
  preferenceLayerValuesSchema,
  preferenceScopeSchema,
} from "../src/features/spectra/settings/schema/preferences";

const scopeValidator = v.union(
  v.literal("account"),
  v.literal("workspace"),
  v.literal("work_type"),
  v.literal("device"),
);

function unknownKeys(input: unknown, output: unknown, prefix = ""): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const kept = output && typeof output === "object" && !Array.isArray(output)
    ? output as Record<string, unknown>
    : {};
  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in kept)) return [path];
    return unknownKeys(value, kept[key], path);
  });
}

function mergeValues(current: unknown, patch: Record<string, unknown>) {
  const base = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.entries({ ...base, ...patch }).map(([key, value]) => {
      const previous = base[key];
      return [
        key,
        previous && value && typeof previous === "object" && typeof value === "object" &&
          !Array.isArray(previous) && !Array.isArray(value)
          ? { ...previous as Record<string, unknown>, ...value as Record<string, unknown> }
          : value,
      ];
    }),
  );
}

export const layers = query({
  args: {
    workspaceId: v.optional(v.string()),
    workType: v.optional(v.string()),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const rows = await ctx.db
      .query("accountPreferences")
      .withIndex("by_account", (q) => q.eq("accountId", actor.accountId))
      .collect();
    return rows
      .filter((row) =>
        row.scope === "account" ||
        (row.scope === "workspace" && row.scopeKey === args.workspaceId) ||
        (row.scope === "work_type" && row.scopeKey === args.workType) ||
        (row.scope === "device" && row.scopeKey === args.deviceId))
      .map(({ scope, values, updatedAt }) => ({ scope, values, updatedAt }));
  },
});

export const writeLayer = mutation({
  args: { scope: scopeValidator, scopeKey: v.string(), values: v.any() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const scope = preferenceScopeSchema.parse(args.scope);
    if (!args.scopeKey.trim()) throw new Error("PREFERENCE_SCOPE_KEY_REQUIRED");
    const values = preferenceLayerValuesSchema.parse(args.values);
    const dropped = unknownKeys(args.values, values);
    const migrationNotes = dropped.length
      ? [`Dropped unknown preference keys: ${dropped.join(", ")}`]
      : undefined;
    if (migrationNotes) console.info("[spectra:preferences]", ...migrationNotes);
    const existing = await ctx.db
      .query("accountPreferences")
      .withIndex("by_account_scope_key", (q) =>
        q.eq("accountId", actor.accountId).eq("scope", scope).eq("scopeKey", args.scopeKey),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      const merged = preferenceLayerValuesSchema.parse(mergeValues(existing.values, values));
      await ctx.db.patch(existing._id, { values: merged, schemaVersion: PREFERENCE_SCHEMA_VERSION, migrationNotes, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("accountPreferences", {
      accountId: actor.accountId,
      scope,
      scopeKey: args.scopeKey,
      values,
      schemaVersion: PREFERENCE_SCHEMA_VERSION,
      migrationNotes,
      updatedAt: now,
    });
  },
});
