/*
 * Whether a short written answer says the same thing as the expected one.
 * The expected answer is often a sentence ("36 cm; adjacent nodes are half a
 * wavelength apart") and the learner writes its heart ("36cm"), so it compares
 * the leading clause as well as the whole, ignores case, spacing and end
 * punctuation, and takes numbers by value. It only ever widens what counts as
 * right for what the expected answer itself leads with.
 */

function plain(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
}

function compact(value: string) {
  return plain(value).replace(/\s+/g, "");
}

/** The number a short answer gives, and the unit after it, when that is all it says. */
function quantity(value: string) {
  const match = /^([-+]?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?)\s*(.*)$/i.exec(plain(value));
  if (!match) return null;
  const amount = Number(match[1]!.replace(",", "."));
  return Number.isFinite(amount) ? { amount, unit: match[2]!.replace(/\s+/g, "") } : null;
}

function sameQuantity(response: string, expected: string) {
  const given = quantity(response);
  const wanted = quantity(expected);
  if (!given || !wanted || given.amount !== wanted.amount) return false;
  // A bare number is fine when the unit is the expected one left off, not a different unit.
  return !given.unit || given.unit === wanted.unit;
}

function leadingClause(expected: string) {
  return expected.split(/[;:\u2014]|\s[-\u2013]\s|,\s|\.\s|\sbecause\s|\ssince\s/i)[0]!;
}

export function shortAnswerMatches(response: unknown, expected: unknown) {
  const given = String(response ?? "");
  const wanted = String(expected ?? "");
  if (!plain(given) || !plain(wanted)) return false;
  if (plain(given) === plain(wanted) || compact(given) === compact(wanted)) return true;
  const lead = leadingClause(wanted);
  if (lead.trim() && lead !== wanted && (plain(given) === plain(lead) || compact(given) === compact(lead))) return true;
  return sameQuantity(given, wanted) || sameQuantity(given, lead);
}
