export const SPECTRA_MIGRATION_FLAG_KEYS = [
  "cloudflareRealtime",
  "nativeYjsDocument",
  "nativeYjsCode",
  "nativeYjsStructuredWork",
  "actionProtocolV2",
  "toolRegistryV2",
  "workbenchV2",
  "referencesV2",
  "richContentV2",
  "agentFoundryV2",
  "schoolSourceV2",
] as const;

export type SpectraMigrationFlagKey =
  (typeof SPECTRA_MIGRATION_FLAG_KEYS)[number];

export type SpectraMigrationFlags = Record<SpectraMigrationFlagKey, boolean>;

export type MigrationFlagScope = {
  accountId?: string;
  workspaceId?: string;
};

export const DEFAULT_SPECTRA_MIGRATION_FLAGS: Readonly<SpectraMigrationFlags> =
  Object.freeze(
    Object.fromEntries(SPECTRA_MIGRATION_FLAG_KEYS.map((key) => [key, false])) as
      SpectraMigrationFlags,
  );

function parseBoolean(value: string | undefined) {
  if (!value) return undefined;
  if (/^(1|true|on|yes)$/i.test(value)) return true;
  if (/^(0|false|off|no)$/i.test(value)) return false;
  return undefined;
}

export function resolveSpectraMigrationFlags(
  overrides: Partial<SpectraMigrationFlags> = {},
): SpectraMigrationFlags {
  return Object.fromEntries(
    SPECTRA_MIGRATION_FLAG_KEYS.map((key) => {
      const environmentName = `SPECTRA_MIGRATION_${key
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toUpperCase()}`;
      return [
        key,
        overrides[key] ??
          parseBoolean(process.env[environmentName]) ??
          DEFAULT_SPECTRA_MIGRATION_FLAGS[key],
      ];
    }),
  ) as SpectraMigrationFlags;
}
