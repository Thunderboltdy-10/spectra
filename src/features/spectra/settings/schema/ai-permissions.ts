/*
 * Spectra AI permission preferences. Reads and ordinary writes always run and
 * can be undone. Irreversible and settings effects ask by default; per
 * category the user chooses Ask, Always allow or Never, and "Give Spectra full
 * control" allows every category at once.
 *
 * Only the user changes these, in Settings or with "Always allow" on an
 * approval. The AI's settings command rejects any patch that touches them.
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

/** What each category covers, for the Settings rows. */
export const PERMISSION_CATEGORY_DESCRIPTIONS: Record<PermissionCategory, string> = {
  permanent_delete: "Deleting artifact or files for good, and emptying the trash.",
  external_send: "Sending or publishing anything outside Spectra.",
  managebac: "Writing to ManageBac, such as submissions and class changes.",
  bridge_files: "Moving, overwriting or deleting files on your computer through Bridge.",
  settings: "Changing your Spectra settings. Spectra can never change these permissions.",
  sharing: "Sharing artifact or workspaces, and changing who has access.",
  connections: "Connecting, disconnecting or changing accounts and services.",
};

/** Keys inside the `ai` preference section that hold permission choices. */
export const AI_PERMISSION_PREFERENCE_KEYS = [
  "permissionFullControl",
  "permissionAllow",
  "permissionDeny",
] as const;

export type PermissionChoice = "ask" | "allow" | "never";

export const PERMISSION_CHOICE_OPTIONS: ReadonlyArray<{ value: PermissionChoice; label: string }> = [
  { value: "ask", label: "Ask" },
  { value: "allow", label: "Always allow" },
  { value: "never", label: "Never" },
];

/** The stored shape, as the `ai` preference section holds it. */
export type StoredPermissionPreferences = {
  permissionFullControl: boolean;
  permissionAllow: PermissionCategory[];
  permissionDeny: PermissionCategory[];
};

export function isPermissionCategory(value: unknown): value is PermissionCategory {
  return (
    typeof value === "string" &&
    (PERMISSION_CATEGORIES as readonly string[]).includes(value)
  );
}

/** The choice a Settings row shows. Never wins over Always allow and full control. */
export function permissionChoice(prefs: StoredPermissionPreferences, category: PermissionCategory): PermissionChoice {
  if (prefs.permissionDeny.includes(category)) return "never";
  if (prefs.permissionFullControl || prefs.permissionAllow.includes(category)) return "allow";
  return "ask";
}

/**
 * The patch for one row's change. Choosing anything but Always allow for a
 * category turns full control off, because full control means every category
 * is allowed.
 */
export function permissionChoicePatch(
  prefs: StoredPermissionPreferences,
  category: PermissionCategory,
  choice: PermissionChoice,
): StoredPermissionPreferences {
  const allowed = prefs.permissionFullControl ? [...PERMISSION_CATEGORIES] : [...prefs.permissionAllow];
  const allow = PERMISSION_CATEGORIES.filter((entry) =>
    entry === category ? choice === "allow" : allowed.includes(entry) && !prefs.permissionDeny.includes(entry),
  );
  const deny = PERMISSION_CATEGORIES.filter((entry) =>
    entry === category ? choice === "never" : prefs.permissionDeny.includes(entry),
  );
  return {
    permissionFullControl: allow.length === PERMISSION_CATEGORIES.length,
    permissionAllow: allow,
    permissionDeny: deny,
  };
}

/** Full control allows every category; turning it off returns every category to Ask. */
export function fullControlPatch(on: boolean): StoredPermissionPreferences {
  return on
    ? { permissionFullControl: true, permissionAllow: [...PERMISSION_CATEGORIES], permissionDeny: [] }
    : { permissionFullControl: false, permissionAllow: [], permissionDeny: [] };
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
