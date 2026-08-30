export const SOUL_TOKEN_CAP = 350;
export const SOUL_CHARACTER_CAP = SOUL_TOKEN_CAP * 4;

export function estimateSoulTokens(value: string) {
  return value.length === 0 ? 0 : Math.ceil(value.length / 4);
}

export function normalizeSoulText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Injection is a second hard boundary. Persisted rows should already satisfy
 * the cap, but an older or manually repaired row must never expand a packet.
 */
export function boundSoulText(value: unknown) {
  return normalizeSoulText(value).slice(0, SOUL_CHARACTER_CAP).trim();
}

export function soulTextIsWithinCap(value: unknown) {
  const text = normalizeSoulText(value);
  return (
    text.length <= SOUL_CHARACTER_CAP &&
    estimateSoulTokens(text) <= SOUL_TOKEN_CAP
  );
}
