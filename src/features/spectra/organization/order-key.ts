/**
 * Fractional order keys for `orgNodes` siblings.
 *
 * A move must be a metadata transaction on one row (I4). Integer positions
 * force renumbering every sibling, so ordering is a base-62 string that can
 * always be split: `between(a, b)` returns a key that sorts strictly between
 * its neighbours, for any pair of distinct keys.
 *
 * Keys compare with plain lexicographic `<`. They never end in the lowest
 * digit, which keeps a key available immediately below every existing key.
 */

const DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const MIN_DIGIT = DIGITS[0]!;
const MAX_DIGIT = DIGITS[BASE - 1]!;

/** First key in an empty parent. Mid-range so both ends stay cheap to extend. */
export const FIRST_ORDER_KEY = "V";

export function isOrderKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 320 &&
    !value.endsWith(MIN_DIGIT) &&
    [...value].every((character) => DIGITS.includes(character))
  );
}

function digit(value: string, index: number) {
  const character = value[index];
  return character === undefined ? 0 : DIGITS.indexOf(character);
}

function trimTrailingMin(value: string) {
  let end = value.length;
  while (end > 1 && value[end - 1] === MIN_DIGIT) end -= 1;
  return value.slice(0, end);
}

/**
 * A key strictly between `before` and `after`. Pass `null` for an open end:
 * `between(null, first)` prepends, `between(last, null)` appends.
 */
export function between(before: string | null, after: string | null): string {
  const low = before ?? "";
  const high = after ?? "";
  if (before !== null && !isOrderKey(before))
    throw new Error(`Invalid order key: ${before}`);
  if (after !== null && !isOrderKey(after))
    throw new Error(`Invalid order key: ${after}`);
  if (low && high && low >= high)
    throw new Error(`Order keys out of sequence: ${low} >= ${high}`);

  let prefix = "";
  for (let index = 0; ; index += 1) {
    const lowDigit = digit(low, index);
    const highDigit = index < high.length ? digit(high, index) : BASE;
    if (lowDigit === highDigit) {
      prefix += DIGITS[lowDigit];
      continue;
    }
    const gap = highDigit - lowDigit;
    if (gap > 1)
      return prefix + DIGITS[lowDigit + Math.floor(gap / 2)];
    /* Adjacent digits: keep `low`'s digit and descend into its tail, where
       there is always room because keys never end in the lowest digit. */
    prefix += DIGITS[lowDigit];
    const tail = low.slice(index + 1);
    let carry = "";
    for (let tailIndex = 0; ; tailIndex += 1) {
      const tailDigit = digit(tail, tailIndex);
      if (tailDigit < BASE - 1)
        return prefix + carry + DIGITS[tailDigit + Math.floor((BASE - tailDigit) / 2)];
      carry += MAX_DIGIT;
    }
  }
}

/** Append after the last existing sibling. */
export function nextOrderKey(lastKey: string | null | undefined) {
  return lastKey ? between(lastKey, null) : FIRST_ORDER_KEY;
}

/**
 * Order keys for `count` new siblings dropped between two neighbours, in the
 * order given. Used by multi-select drag so one drop is one transaction.
 */
export function orderKeysBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`Invalid order key count: ${count}`);
  const keys: string[] = [];
  let low = before;
  for (let index = 0; index < count; index += 1) {
    const key = between(low, after);
    keys.push(key);
    low = key;
  }
  return keys;
}

/**
 * Rebuild evenly spaced keys for a sibling list. Only for repair/migration —
 * normal moves never renumber siblings.
 */
export function sequentialOrderKeys(count: number): string[] {
  if (count <= 0) return [];
  const keys: string[] = [];
  let previous: string | null = null;
  for (let index = 0; index < count; index += 1) {
    previous = nextOrderKey(previous);
    keys.push(previous);
  }
  return keys;
}

export function compareOrderKeys(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeOrderKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = trimTrailingMin(value.trim());
  return isOrderKey(trimmed) ? trimmed : null;
}
