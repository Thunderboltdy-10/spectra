"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { AdminSectionHeader } from "./shared";

type Scope = "ai" | "background";

const SCOPES: { scope: Scope; name: string; running: string; stopped: string }[] = [
  {
    scope: "ai",
    name: "AI",
    running: "Spectra answers, creates and runs agents as usual.",
    stopped: "No new AI turns start, and running ones end at their next heartbeat.",
  },
  {
    scope: "background",
    name: "Background work",
    running: "Indexing, memory, daily briefs and sync sweeps run on schedule.",
    stopped: "Scheduled indexing, memory, briefs and sync sweeps are paused.",
  },
];

function since(at: number | null) {
  if (!at) return "";
  return ` Since ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`;
}

/**
 * The platform emergency stop. Sign-in, data and this console stay up while
 * a scope is stopped, and resuming restores it exactly as it was.
 */
export function EmergencyStop() {
  const status = useQuery(api.platformControls.status, useAuthedArgs({}, "account"));
  const setStopped = useMutation(api.platformControls.setStopped);
  const [confirming, setConfirming] = useState<Scope | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Scope | null>(null);

  async function apply(scope: Scope, stopped: boolean) {
    setBusy(scope);
    try {
      await setStopped({ scope, stopped, ...(stopped && reason.trim() ? { reason: reason.trim() } : {}) });
      toast.success(stopped ? `${scope === "ai" ? "AI" : "Background work"} stopped` : "Resumed");
      setConfirming(null);
      setReason("");
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "The switch did not change. Try again." }).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="emergency-stop" aria-labelledby="emergency-stop-title">
      <AdminSectionHeader
        title="Emergency stop"
        detail="Pause AI or background work across every school. Sign-in, data and this console stay up."
      />
      <ul className="emergency-stop-list">
        {SCOPES.map(({ scope, name, running, stopped }) => {
          const state = status?.[scope];
          const isStopped = state?.stopped === true;
          return (
            <li key={scope} className="emergency-stop-row" data-stopped={isStopped || undefined}>
              <div className="min-w-0">
                <p className="text-ui font-medium text-[var(--text-primary)]">
                  {name} {isStopped ? "is stopped" : "is running"}
                </p>
                <p className="text-caption text-[var(--text-secondary)]">
                  {isStopped ? stopped + since(state?.since ?? null) : running}
                  {isStopped && state && "reason" in state && state.reason ? ` Note: ${state.reason}` : ""}
                </p>
                {confirming === scope ? (
                  <div className="emergency-stop-confirm">
                    <input
                      className="emergency-stop-reason"
                      placeholder="Why, for the audit log (optional)"
                      value={reason}
                      maxLength={500}
                      onChange={(event) => setReason(event.target.value)}
                      autoFocus
                    />
                    <Button variant="destructive" size="sm" disabled={busy === scope} onClick={() => void apply(scope, true)}>
                      Stop {name === "AI" ? "AI" : "background work"} now
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </div>
              {status === undefined ? null : isStopped ? (
                <Button variant="primary" size="sm" disabled={busy === scope} onClick={() => void apply(scope, false)}>
                  Resume
                </Button>
              ) : confirming === scope ? null : (
                <Button variant="secondary" size="sm" onClick={() => setConfirming(scope)}>
                  Stop
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
