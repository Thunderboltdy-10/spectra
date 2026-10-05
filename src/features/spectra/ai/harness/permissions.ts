import {
  PERMISSION_CATEGORY_LABELS,
  isPermissionCategory,
  type PermissionCategory,
} from "@/features/spectra/settings/schema/ai-permissions";
import type { AnyHarnessTool, ToolEffect } from "./types";

/*
 * The permission policy reads only a tool's effect and the user's stored
 * choices. Reads and writes run (writes are undoable as one group per run);
 * irreversible and settings effects ask unless the user allowed them, and
 * never run in a category the user set to Never.
 */

export type PermissionPrefs = {
  fullControl: boolean;
  allow: PermissionCategory[];
  deny: PermissionCategory[];
};

export const DEFAULT_PERMISSION_PREFS: PermissionPrefs = { fullControl: false, allow: [], deny: [] };

const categories = (value: unknown) =>
  Array.isArray(value) ? [...new Set(value.filter(isPermissionCategory))] : [];

/** Reads the `ai` preference section (any shape) into permission choices. */
export function readPermissionPrefs(ai: unknown): PermissionPrefs {
  if (!ai || typeof ai !== "object" || Array.isArray(ai)) return DEFAULT_PERMISSION_PREFS;
  const record = ai as Record<string, unknown>;
  const deny = categories(record.permissionDeny);
  const allow = categories(record.permissionAllow).filter((category) => !deny.includes(category));
  return { fullControl: record.permissionFullControl === true, allow, deny };
}

export function permissionDecision(
  effect: ToolEffect,
  category: PermissionCategory | undefined,
  prefs: PermissionPrefs,
): "allow" | "ask" | "deny" {
  if (effect === "read" || effect === "write") return "allow";
  // Never wins over full control: the user named this category explicitly.
  if (category && prefs.deny.includes(category)) return "deny";
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
  const never = prefs.deny.length
    ? ` Never allowed (do not try; tell the user they can do it themselves): ${prefs.deny.map((category) => PERMISSION_CATEGORY_LABELS[category]).join(", ")}.`
    : "";
  if (prefs.fullControl)
    return prefs.deny.length
      ? `The user gave Spectra full control: nothing else needs approval.${never}`
      : "The user gave Spectra full control: nothing needs approval.";
  const allowed = prefs.allow.map((category) => PERMISSION_CATEGORY_LABELS[category]);
  return (
    (allowed.length
      ? `Changes that cannot be undone and settings changes ask first, except: ${allowed.join(", ")}.`
      : "Changes that cannot be undone and settings changes ask the user first.") + never
  );
}

/** The tool result when the user set a category to Never. */
export function deniedResult(category: PermissionCategory | undefined) {
  const what = category ? PERMISSION_CATEGORY_LABELS[category] : "this change";
  return `Not done: the user set ${what} to Never in Settings, Spectra AI permissions. Do not try another way. Tell the user plainly that you did not do it, and that they can do it themselves or change that setting.`;
}

/** The "Always allow" label for an approval. */
export function alwaysAllowLabel(category: PermissionCategory | undefined) {
  return category ? `Always allow ${PERMISSION_CATEGORY_LABELS[category]}` : undefined;
}
