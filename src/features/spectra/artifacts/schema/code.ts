import { normalizeCodeContent, type CodeContent } from "../../code/model";

export const CODE_CONTENT_SCHEMA_VERSION = 2;

/**
 * Code v2 adds approved Python packages, source-cell settings, and bounded run
 * reports. Normalization supplies those fields without changing v1 source.
 */
export function migrateCodeContentV1ToV2(value: unknown): CodeContent {
  return normalizeCodeContent(value);
}

export function migrateCodeContent(
  value: unknown,
  fromVersion: number,
): CodeContent {
  if (!Number.isInteger(fromVersion) || fromVersion < 1)
    throw new Error("Code content needs a positive schema version.");
  if (fromVersion > CODE_CONTENT_SCHEMA_VERSION)
    throw new Error(
      "This Code artifact was created by a newer Spectra schema.",
    );
  return fromVersion === 1
    ? migrateCodeContentV1ToV2(value)
    : normalizeCodeContent(value);
}
