"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

function observedLabel(claimType: string) {
  if (claimType === "correction") return "Correction Spectra noticed";
  if (claimType === "mistake_avoidance") return "Mistake to avoid next time";
  return "Recurring way of working";
}

export function ModelMemorySettings() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const result = useQuery(
    api.memory.listMine,
    isAuthenticated
      ? { status: "active", createdBy: "model", limit: 200 }
      : "skip",
  );
  const forget = useMutation(api.memory.forget);
  const [forgetting, setForgetting] = useState<Id<"memoryClaims"> | null>(null);
  const [forgotten, setForgotten] = useState(() => new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const observed = (result?.claims ?? []).filter(
    (claim) => claim.createdBy === "model" && !forgotten.has(claim._id),
  );

  async function forgetOne(claimId: Id<"memoryClaims">) {
    setForgetting(claimId);
    setError(null);
    try {
      await forget({ claimId });
      setForgotten((current) => new Set(current).add(claimId));
    } catch {
      setError(
        "This could not be forgotten. It is still available to Spectra.",
      );
    } finally {
      setForgetting(null);
    }
  }

  const loading = authLoading || (isAuthenticated && result === undefined);
  return (
    <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <header className="pt-2">
        <h2 className="font-display text-heading font-semibold text-[var(--text-primary)]">
          Things Spectra noticed
        </h2>
        <p className="mt-1 max-w-2xl text-caption leading-5 text-[var(--text-secondary)]">
          Durable corrections and ways of working Spectra picked up while
          helping. You can remove any item immediately.
        </p>
      </header>
      <div className="rounded-card bg-[var(--bg-secondary)] px-4 py-4 sm:px-5">
        {loading ? (
          <div
            aria-label="Loading things Spectra noticed"
            className="grid gap-2"
            role="status"
          >
            {[0, 1].map((item) => (
              <div
                className="h-[76px] animate-pulse rounded-control bg-[var(--bg-tertiary)] motion-reduce:animate-none"
                key={item}
              />
            ))}
          </div>
        ) : !isAuthenticated ? (
          <p className="text-caption leading-5 text-[var(--text-secondary)]">
            Sign in to review what Spectra noticed while helping you.
          </p>
        ) : observed.length === 0 ? (
          <p className="text-caption leading-5 text-[var(--text-secondary)]">
            Spectra has not added anything here.
          </p>
        ) : (
          <div className="grid gap-2">
            {observed.map((claim) => (
              <div
                className="flex items-start gap-4 rounded-control bg-[var(--bg-primary)] px-3.5 py-3 sm:px-4"
                key={claim._id}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-micro font-medium text-[var(--text-secondary)]">
                    {observedLabel(claim.claimType)}
                  </p>
                  <p className="mt-1 break-words text-ui leading-5 text-[var(--text-primary)]">
                    {claim.proposition}
                  </p>
                </div>
                <Button
                  aria-label={`Forget: ${claim.proposition}`}
                  className="shrink-0"
                  disabled={forgetting !== null}
                  onClick={() => void forgetOne(claim._id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {forgetting === claim._id ? "Forgetting..." : "Forget"}
                </Button>
              </div>
            ))}
          </div>
        )}
        {error ? (
          <p
            className="mt-3 text-micro leading-[18px] text-[var(--danger)]"
            role="status"
          >
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
