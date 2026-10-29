"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAuthedArgs } from "../data/use-authed-args";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { AdminSectionHeader } from "./shared";

/** Walkthrough requests from the landing page, one per email address, newest first. */
export function LandingInbox() {
  const [view, setView] = useState<"open" | "done">("open");
  const items = useQuery(api.landingRequests.list, useAuthedArgs({ open: view === "open" }, "account"));
  const setStatus = useMutation(api.landingRequests.setStatus);

  async function move(requestId: Id<"landingRequests">, status: "new" | "answered" | "closed") {
    try {
      await setStatus({ requestId, status });
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "The status did not change. Try again." }).message);
    }
  }

  return (
    <section className="feedback-inbox" aria-labelledby="landing-inbox-title">
      <AdminSectionHeader
        title="From the website"
        count={items?.length}
        detail="Schools asking for a walkthrough on the landing page. Each address can send one."
        action={
          <Segmented
            label="Which requests"
            size="compact"
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: "New" },
              { value: "done", label: "Answered" },
            ]}
          />
        }
      />
      {items === undefined ? null : items.length === 0 ? (
        <p className="admin-ledger-empty">{view === "open" ? "No school is waiting for a walkthrough." : "Nothing answered yet."}</p>
      ) : (
        <ul className="feedback-inbox-list">
          {items.map((item) => (
            <li key={item.requestId} className="feedback-inbox-item">
              <div className="min-w-0">
                <p className="text-micro text-[var(--text-tertiary)]">
                  {item.role || "Walkthrough"}
                  {item.usesManageBac ? ", uses ManageBac" : ", no ManageBac"}
                </p>
                <p className="mt-1 text-ui font-medium text-[var(--text-primary)]">
                  {item.name}
                  {item.school ? `, ${item.school}` : ""}
                </p>
                {item.message ? <p className="mt-1 whitespace-pre-wrap text-ui text-[var(--text-secondary)]">{item.message}</p> : null}
                <p className="mt-1.5 text-micro text-[var(--text-secondary)]">
                  <a href={`mailto:${item.email}`} className="underline-offset-2 hover:underline">
                    {item.email}
                  </a>
                  , {new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {view === "open" ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => void move(item.requestId, "answered")}>
                        Answered
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void move(item.requestId, "closed")}>
                        Close
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void move(item.requestId, "new")}>
                      Reopen
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
