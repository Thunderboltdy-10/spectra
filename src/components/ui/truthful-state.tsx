import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/badge";
import { readConvexError } from "../../../shared/convex-error";

/**
 * S8 — truthfulness of reported state.
 *
 * `/analytics` already states the rule the whole product must follow:
 *   "Zero is shown only when metering rows exist; missing instrumentation is
 *    partial, not zero."
 * `/superadmin` already implements it (`Collaboration` reads `Unknown`, as plain
 * grey text rather than a green badge). `/admin`, `/school` and `/calendar`
 * violate it. This module makes the honest rendering the easy one.
 *
 * The model is that a metric has a *value* and a *measurement state*, and the
 * state decides what may be drawn. A missing measurement is never a `0`, and a
 * measurement in flight never publishes a number at all.
 */
export type MetricReading =
  /** Metering rows exist. `value` is real, including a real "0". */
  | { state: "measured"; value: string; completeThrough?: string }
  /** Some sources reported and some did not. The value is a floor, not a total. */
  | { state: "partial"; value: string; missing: string }
  /** The last good value is shown while a refresh is due. */
  | { state: "stale"; value: string; measuredAt: string }
  /** Not instrumented, not permitted, or not connected. There is no number. */
  | { state: "unknown"; reason?: string }
  /** In flight. Publishes no number, not even a placeholder zero. */
  | { state: "loading" };

/**
 * The settled copy rules. One sentence per state, in the interface's voice, so
 * every surface says the same thing about the same condition.
 */
export function metricCaption(reading: MetricReading): string {
  switch (reading.state) {
    case "measured":
      return reading.completeThrough
        ? `Complete through ${reading.completeThrough}.`
        : "Measured from product records.";
    case "partial":
      return `Partial coverage. ${reading.missing} did not report, so this is a floor rather than a total.`;
    case "stale":
      return `Last measured ${reading.measuredAt}. Refresh to bring it current.`;
    case "unknown":
      return (
        reading.reason ??
        "This measure is not instrumented yet, so Spectra does not have a value for it."
      );
    case "loading":
      return "Measuring.";
  }
}

/** The word a reading shows in place of, or beside, its value. */
export function metricStateLabel(reading: MetricReading): string | null {
  switch (reading.state) {
    case "measured":
      return null;
    case "partial":
      return "Partial";
    case "stale":
      return "Needs refresh";
    case "unknown":
      return "Unknown";
    case "loading":
      return null;
  }
}

/**
 * Renders a metric's value under the rule above.
 *
 * unknown  grey "Unknown" text, no numeral and no chip
 * loading  a skeleton the size of a numeral, never a number
 * partial  the value plus an amber "Partial" badge
 * stale    the value plus an amber "Needs refresh" badge
 * measured the value alone
 */
export function MetricValue({
  reading,
  className,
  valueClassName,
}: {
  reading: MetricReading;
  className?: string;
  valueClassName?: string;
}) {
  if (reading.state === "loading") {
    return (
      <Skeleton
        className={cn("h-[var(--text-metric)] w-16", className)}
        // A number is not known yet, so none is drawn.
      />
    );
  }

  if (reading.state === "unknown") {
    return (
      <span className={className}>
        <StatusBadge tone="unknown">Unknown</StatusBadge>
      </span>
    );
  }

  const label = metricStateLabel(reading);

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <strong
        className={cn(
          "truncate font-sans text-metric font-normal tracking-[-.02em] text-[var(--text-primary)]",
          valueClassName,
        )}
      >
        {reading.value}
      </strong>
      {label ? <StatusBadge tone="attention">{label}</StatusBadge> : null}
    </span>
  );
}

/**
 * Bridges the existing `CapabilityState` union onto a reading, so a surface
 * that already knows a capability's state cannot print a number the capability
 * could not supply.
 *
 * The five "no value" kinds are the ones where `capabilityData` returns
 * undefined, which means any number on screen is a fallback rather than a
 * measurement. `available`, `refreshing` and `stale` all have a real value; the
 * freshness word beside them is the caller's job (`CapabilityTruthBadge`).
 */
export function readingFromCapability(
  state:
    | { kind: string; details?: string; message?: string }
    | null
    | undefined,
  value: string,
): MetricReading {
  if (!state) return { state: "measured", value };
  switch (state.kind) {
    case "not_connected":
      return { state: "unknown", reason: "This source is not connected yet." };
    case "permission_denied":
      return {
        state: "unknown",
        reason: "Your role cannot read this measure.",
      };
    case "unsupported":
      return {
        state: "unknown",
        reason: "This source does not report this measure.",
      };
    case "schema_incompatible":
      return {
        state: "unknown",
        reason: "The source changed shape, so this measure is not readable.",
      };
    case "unavailable":
      return {
        state: "unknown",
        reason: "This measure could not be read just now.",
      };
    case "partial":
      return {
        state: "partial",
        value,
        missing: state.details ?? "Some sources",
      };
    default:
      return { state: "measured", value };
  }
}

/* ---------------------------------------------------------------------------
   Never leak a raw error.

   Two leaks are on record: a Zod chain printed across the editor
   ("Invalid input: expected number, received undefined; …") and
   "INTEGRATION_IDENTITY_INVALID: Exact match needs an id. at handler
   (../convex/managebac.ts:1491:21)" in red in the admin UI.

   The rule is an allowlist, not a denylist: a thrown value is never shown to a
   user. The caller supplies the human sentence, `describeFailure` supplies a
   stable reference so support can correlate it with the real log line, and the
   raw text is available only in development (CANON D13).
   --------------------------------------------------------------------------- */

function rawText(error: unknown): string {
  if (typeof error === "string") return error;
  // A redacted Convex failure keeps its words only in ConvexError data.
  if (error instanceof Error)
    return `${error.name}: ${readConvexError(error).message || error.message}`;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** FNV-1a, so the same failure always yields the same reference. */
function referenceFor(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(7, "0").slice(0, 7);
}

export type DescribedFailure = {
  /** Safe to render. Always the caller's sentence. */
  message: string;
  /** Short opaque code a user can quote to support. Contains no internals. */
  reference: string;
  /** The raw text, populated outside production only. */
  devDetail?: string;
};

/**
 * Turns any thrown value into something a student or teacher can read.
 *
 * `fallback` must say what failed and what to do next, in the interface's
 * voice. It is the only text that reaches the user.
 */
/**
 * AUTH_* codes are identity/account problems, never connectivity. Callers often
 * pass "Check your connection…" as a load fallback; map those codes to plain
 * verify/account copy so shells do not mislabel an unverified email as offline.
 */
export function identityFailureMessage(raw: string): string | null {
  if (/AUTH_EMAIL_UNVERIFIED/i.test(raw))
    return "Verify your school email before using Spectra.";
  if (/AUTH_NOT_SIGNED_IN/i.test(raw)) return "Sign in to continue.";
  if (/AUTH_NO_SCHOOL/i.test(raw))
    return "This account does not have an active school membership.";
  if (/AUTH_NO_ACCESS/i.test(raw))
    return "You do not have access to this school.";
  if (/AUTH_SCHOOL_ADMIN_REQUIRED/i.test(raw))
    return "School administrator access is required for this.";
  if (/AUTH_OPERATOR_MANAGE_REQUIRED/i.test(raw))
    return "This operator session is read-only. Enter again with manage access to make changes.";
  if (/AUTH_OPERATOR_SESSION_INVALID/i.test(raw))
    return "This operator session is no longer valid. Sign in again.";
  if (/AUTH_OPERATOR_REQUIRED/i.test(raw))
    return "Operator access is required for this.";
  if (/AUTH_ORG_INACTIVE/i.test(raw))
    return "This school is inactive, so Spectra cannot continue.";
  if (/AUTH_MISCONFIGURED|AUTH_PROFILE_UNAVAILABLE|AUTH_BOOTSTRAP_FAILED/i.test(raw))
    return "Spectra could not confirm your account just now. Try again, or contact your school admin.";
  if (/\bAUTH_[A-Z0-9_]+\b/.test(raw))
    return "Check your account, then try again.";
  return null;
}

export function describeFailure(
  error: unknown,
  { fallback }: { fallback: string },
): DescribedFailure {
  const raw = rawText(error);
  return {
    message: identityFailureMessage(raw) ?? fallback,
    reference: referenceFor(raw),
    devDetail: process.env.NODE_ENV === "production" ? undefined : raw,
  };
}
