import * as React from "react";
import { CircleDashed, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Spectra's one status vocabulary.
 *
 *   healthy    green   the thing works, is current, is connected
 *   attention  amber   the thing needs a person to act (stale, partial, quarantined)
 *   failure    rose    the thing failed
 *   neutral    grey    a true terminal state that is not a failure (cancelled, ended)
 *   unknown    grey    the product does not know — rendered as plain text, not a chip
 *
 * Two rules make this vocabulary honest, and both fix observed defects:
 *
 * 1. `unknown` is deliberately not a badge. A chip asserts a measured state, so
 *    an unknown value must not wear one. `/superadmin` already does this right
 *    (`Collaboration — Unknown` as plain grey text); `/admin` renders the same
 *    metric as a confident `0 B`.
 * 2. `neutral` is visually quieter than `failure`. `CANCELLED` rendered heavier
 *    than `FAILED` inverted severity on `/analytics`; cancelled is a neutral
 *    terminal state, not a worse-than-failure one.
 *
 * Colour follows the Designer charter: success green passes quietly rather than
 * shouting, failure rose stays a local discontinuity rather than a red wash, and
 * the actor identity colours (Spectra violet, human teal, collab cyan) never
 * appear here — they belong only where an actor acts.
 */
export type StatusTone =
  | "healthy"
  | "attention"
  | "failure"
  | "neutral"
  | "unknown";

const toneClass: Record<Exclude<StatusTone, "unknown">, string> = {
  healthy:
    "border-[color-mix(in_oklab,var(--success)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-secondary))] [color:color-mix(in_oklab,var(--success)_80%,var(--text-primary))]",
  attention:
    "border-[color-mix(in_oklab,var(--warning)_34%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_13%,var(--bg-secondary))] [color:color-mix(in_oklab,var(--warning)_80%,var(--text-primary))]",
  failure:
    "border-[color-mix(in_oklab,var(--danger)_32%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-secondary))] [color:color-mix(in_oklab,var(--danger)_80%,var(--text-primary))]",
  neutral:
    "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
};

/**
 * Normalises the status words that actually appear in the product to a tone, so
 * no call site has to decide what colour a state is.
 *
 * This exists because hand-written ternaries guess at the data's vocabulary and
 * get it wrong. `school-admin-shell` tested `status === "active"` while the
 * integration vocabulary is `draft | validating | connected | degraded | blocked
 * | revoked` (`data/api.ts`), so every state fell through to amber and a healthy
 * `connected` integration was reported as needing attention.
 *
 * One rule protects the S8 policy: `unknown` is returned only when there is no
 * value. A word this function does not recognise is still a value the product
 * holds, so it gets a quiet `neutral` chip. Classifying an unrecognised word as
 * `unknown` would claim the product has no answer when it does.
 */
export function statusToneFor(value: string | null | undefined): StatusTone {
  if (value === null || value === undefined) return "unknown";
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!key) return "unknown";
  if (
    /^(unknown|unmeasured|not measured|not instrumented|awaiting meter|no data|indeterminate)$/.test(
      key,
    )
  ) {
    return "unknown";
  }
  if (
    /^(healthy|current|connected|active|operational|complete|completed|succeeded|success|resolved|live|published|verified|synced|available|ready|sent|delivered|approved|allowed|granted|enabled|on)$/.test(
      key,
    )
  ) {
    return "healthy";
  }
  if (
    /^(attention|stale|needs refresh|partial|partial coverage|refreshing|validating|pending|queued|running|scheduled|degraded|major|minor|suspended|quarantined|schema changed|awaiting approval|awaiting response|due|not connected|expiring|new|retrying|throttled)$/.test(
      key,
    )
  ) {
    return "attention";
  }
  if (
    /^(failed|failure|error|errored|critical|blocked|revoked|broken|denied|access denied|rejected|invalid|expired)$/.test(
      key,
    )
  ) {
    return "failure";
  }
  // Everything else is a real value the product holds but does not grade:
  // cancelled, ended, archived, draft, disabled, recorded, a target type.
  return "neutral";
}

export function StatusBadge({
  children,
  tone = "neutral",
  icon: Icon,
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  icon?: LucideIcon;
  className?: string;
}) {
  // Unknown is not a chip. A chip claims a measurement that does not exist.
  if (tone === "unknown") {
    return (
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 text-caption text-[var(--text-secondary)]",
          className,
        )}
      >
        <CircleDashed aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate first-letter:uppercase">{children}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex min-h-5 min-w-0 items-center gap-1.5 rounded-chip border px-2 text-micro font-semibold",
        toneClass[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" /> : null}
      {/* Raw status values reach this component ("connected", "awaiting
          approval"), so it presents them in sentence case. */}
      <span className="truncate first-letter:uppercase">{children}</span>
    </span>
  );
}
