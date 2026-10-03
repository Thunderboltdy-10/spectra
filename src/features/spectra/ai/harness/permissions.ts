import {
  PERMISSION_CATEGORY_LABELS,
  isPermissionCategory,
  type PermissionCategory,
} from "@/features/spectra/settings/schema/ai-permissions";
import type { AnyHarnessTool, ToolEffect } from "./types";

/*
 * The permission policy reads only a tool's effect and the user's stored
 * choices. Reads and writes run (writes are undoable as one group per run);
 * irreversible and settings effects ask unless the user allowed them.
 */

export type PermissionPrefs = {
  fullControl: boolean;
  allow: PermissionCategory[];
};

export const DEFAULT_PERMISSION_PREFS: PermissionPrefs = { fullControl: false, allow: [] };

/** Reads the `ai` preference section (any shape) into permission choices. */
export function readPermissionPrefs(ai: unknown): PermissionPrefs {
  if (!ai || typeof ai !== "object" || Array.isArray(ai)) return DEFAULT_PERMISSION_PREFS;
  const record = ai as Record<string, unknown>;
  const allow = Array.isArray(record.permissionAllow)
    ? [...new Set(record.permissionAllow.filter(isPermissionCategory))]
    : [];
  return { fullControl: record.permissionFullControl === true, allow };
}

export function permissionDecision(
  effect: ToolEffect,
  category: PermissionCategory | undefined,
  prefs: PermissionPrefs,
): "allow" | "ask" {
  if (effect === "read" || effect === "write") return "allow";
  if (prefs.fullControl) return "allow";
  if (category && prefs.allow.includes(category)) return "allow";
  return "ask";
}

/** The loop's policy function, bound to the user's current choices. */
export function permissionPolicy(prefs: PermissionPrefs) {
  return (tool: AnyHarnessTool, args: Record<string, unknown>, effect: ToolEffect) => {
    let category: PermissionCategory | undefined;
    try {
      category = tool.category?.(args);
    } catch {
      category = undefined;
    }
    return permissionDecision(effect, category, prefs);
  };
}

/** One line for the environment block. */
export function permissionSummary(prefs: PermissionPrefs) {
  if (prefs.fullControl)
    return "The user gave Spectra full control: nothing needs approval.";
  const allowed = prefs.allow.map((category) => PERMISSION_CATEGORY_LABELS[category]);
  return allowed.length
    ? `Changes that cannot be undone and settings changes ask first, except: ${allowed.join(", ")}.`
    : "Changes that cannot be undone and settings changes ask the user first.";
}

/** The "Always allow" label for an approval. */
export function alwaysAllowLabel(category: PermissionCategory | undefined) {
  return category ? `Always allow ${PERMISSION_CATEGORY_LABELS[category]}` : undefined;
}
