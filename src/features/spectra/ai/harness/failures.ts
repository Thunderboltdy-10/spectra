/*
 * What a failed tool tells the model. The model's next step depends on three
 * things: what went wrong, whether anything changed, and what to do about it.
 * Internal codes answer none of those, so each known failure says them plainly
 * and anything unknown is at least stripped of transport noise.
 */

const NOTHING_SAVED = "Nothing was saved.";

const KNOWN: Array<{ match: RegExp; say: (detail: string) => string }> = [
  {
    match: /AI_ARTIFACT_RESULT_SCOPE_MISMATCH:?\s*([\s\S]*)/,
    say: (detail) =>
      `The file would have saved something different from your edit${detail ? ` (${detail})` : ""}. ${NOTHING_SAVED} Make the edit smaller, or leave out the formatting at that spot.`,
  },
  {
    match: /Word readback did not match the requested edit:\s*([\s\S]*)/,
    say: (detail) =>
      `Word could not keep this edit: ${detail}. ${NOTHING_SAVED} Rewrite that part more simply, with less formatting.`,
  },
  {
    match: /Equation contains unsupported commands:\s*([\s\S]*)/,
    say: (detail) =>
      `Word cannot store these equation commands: ${detail}. ${NOTHING_SAVED} Rewrite the equation without them.`,
  },
  {
    match: /(?:AI_NATIVE_CANONICAL_STALE|AI_NATIVE_SOURCE_STALE)/,
    say: () => `This work changed while you were editing it. ${NOTHING_SAVED} Read it again and repeat only your edit.`,
  },
  {
    match: /COLLABORATION_REGION_HELD/,
    say: () => `Someone is editing that part right now. ${NOTHING_SAVED} Try a different part, or try again shortly.`,
  },
  {
    match: /(?:OptimisticConcurrencyControlFailure|Documents read from or written to|changed while this mutation was being run)/,
    say: () => `Another save got in first. ${NOTHING_SAVED} Send the same call again.`,
  },
  {
    match: /NATIVE_PROMOTION_(?:CONFLICT|PROTECTED|REFUSED):\s*([\s\S]*)/,
    say: (detail) => `${detail} ${NOTHING_SAVED}`,
  },
  {
    match: /ArgumentValidationError|Value does not match validator/,
    say: () => `A value in this call is not valid. ${NOTHING_SAVED} Check the ids and fields you sent.`,
  },
  {
    match: /CALENDAR_ENDAT_INVALID/,
    say: () => `An event's end must come after its start. ${NOTHING_SAVED}`,
  },
  {
    match: /NATIVE_PAYLOAD_UNAVAILABLE/,
    say: () => `The original file is not available right now, so it cannot be changed. ${NOTHING_SAVED} Ask the user to open Spectra's bridge on the computer that holds it.`,
  },
  {
    match: /has not finished synchronizing|synchronized AI version is unavailable/,
    say: () => `The file is still syncing. ${NOTHING_SAVED} Send the same call again in a moment.`,
  },
  {
    match: /Found ID "?[^"\s]+"? from table|is not a valid ID|does not match the table name/,
    say: () => `An id in this call belongs to something else. ${NOTHING_SAVED} Use an id exactly as a tool or the environment gave it.`,
  },
];

function cleaned(message: string) {
  return message
    .replace(/\[Request ID: [^\]]+\]\s*/g, "")
    .replace(/^(?:\s*Error:\s*)+/g, "")
    .replace(/Server Error\s*/g, "")
    .replace(/Uncaught (?:Convex)?Error:\s*/g, "")
    .replace(/\s+at (?:async )?[^\s]+ \([^)]*\)/g, "")
    .replace(/\s+Called by client\s*/g, " ")
    .replace(/\b[A-Z][A-Z0-9_]{6,}:\s*/g, "")
    .trim();
}

/** The sentence a failed tool hands back to the model. */
export function describeToolFailure(tool: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  for (const known of KNOWN) {
    const found = known.match.exec(message);
    if (found) return `${tool} failed. ${known.say(cleaned(found[1] ?? ""))}`;
  }
  const text = cleaned(message);
  return `${tool} failed: ${text.length > 500 ? `${text.slice(0, 500)}…` : text || "the cause is unknown."}`;
}
