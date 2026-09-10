const GENERIC_NATIVE_FONTS: Record<string, string> = {
  cursive: "Comic Sans MS",
  fantasy: "Impact",
  monospace: "Courier New",
  "sans-serif": "Arial",
  serif: "Times New Roman",
  system: "Arial",
  "system-ui": "Arial",
  "ui-monospace": "Courier New",
  "ui-rounded": "Arial",
  "ui-sans-serif": "Arial",
  "ui-serif": "Times New Roman",
};
const CSS_CONTROL_VALUES = new Set([
  "inherit",
  "initial",
  "normal",
  "none",
  "revert",
  "revert-layer",
  "unset",
]);

function unquote(candidate: string) {
  const trimmed = candidate.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1).trim();
  return trimmed;
}

function isNativeFamilyName(value: string) {
  return /^[\p{L}\p{M}\p{N}\p{Pc}\p{Zs}.+&'-]{1,64}$/u.test(value);
}

/** Return the first safe concrete family from a CSS family list. */
export function firstNativeFontFamily(value: unknown) {
  if (typeof value !== "string") return null;
  for (const raw of value.split(",")) {
    const candidate = unquote(raw);
    if (!candidate) continue;
    if (CSS_CONTROL_VALUES.has(candidate.toLowerCase())) continue;
    const generic = GENERIC_NATIVE_FONTS[candidate.toLowerCase()];
    if (generic) return generic;
    if (isNativeFamilyName(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve a CSS fallback list for a native Office family slot. Browser-facing
 * CSS keeps the original list; this helper is only for OOXML's single-family
 * `typeface`/`w:rFonts` fields.
 */
export function normalizeNativeFontFamily(value: unknown, fallback: string) {
  return (
    firstNativeFontFamily(value) ?? firstNativeFontFamily(fallback) ?? "Arial"
  );
}
