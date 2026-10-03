/*
 * Spectra AI permission preferences. Reads and ordinary writes always run and
 * can be undone. Irreversible and settings effects ask, unless the user chose
 * "Always allow" for that category or "Give Spectra full control".
 *
 * Only the user changes these. The AI's own settings command rejects them.
 */

export const PERMISSION_CATEGORIES = [
  "permanent_delete",
  "external_send",
  "managebac",
  "bridge_files",
  "settings",
  "sharing",
  "connections",
] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/** Plain names for the approval's "Always allow" choice and the Settings page. */
export const PERMISSION_CATEGORY_LABELS: Record<PermissionCategory, string> = {
  permanent_delete: "permanent deletion",
  external_send: "sending outside Spectra",
  managebac: "ManageBac changes",
  bridge_files: "desktop file changes through Bridge",
  settings: "settings changes",
  sharing: "sharing changes",
  connections: "connection changes",
};

/** Keys inside the `ai` preference section that hold permission choices. */
export const AI_PERMISSION_PREFERENCE_KEYS = [
  "permissionFullControl",
  "permissionAllow",
] as const;

export function isPermissionCategory(value: unknown): value is PermissionCategory {
  return (
    typeof value === "string" &&
    (PERMISSION_CATEGORIES as readonly string[]).includes(value)
  );
}

/** True when a settings patch would change the AI's own permissions. */
export function patchTouchesAiPermissions(patch: unknown): boolean {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  const record = patch as Record<string, unknown>;
  const ai = record.ai;
  const inAi =
    Boolean(ai) &&
    typeof ai === "object" &&
    !Array.isArray(ai) &&
    AI_PERMISSION_PREFERENCE_KEYS.some((key) => key in (ai as Record<string, unknown>));
  const topLevel = AI_PERMISSION_PREFERENCE_KEYS.some((key) => key in record);
  return inAi || topLevel;
}
