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
import { FeedbackFilePreview } from "@/components/layout/feedback-file-preview";
import { AdminSectionHeader } from "./shared";

const KIND_WORDS: Record<string, string> = {
  issue: "Something's wrong",
  improvement: "Could be better",
  feature_request: "An idea",
  content_accuracy: "Content accuracy",
  performance: "Performance",
  integration: "Integration",
  other: "Other",
};

const STATUS_WORDS: Record<string, string> = {
  new: "New",
  triaged: "Seen",
  in_progress: "Being fixed",
  resolved: "Resolved",
  closed: "Closed",
};

/** Everything sent from the feedback button, newest first, with its picture. */
export function FeedbackInbox() {
  const [view, setView] = useState<"open" | "done">("open");
  const items = useQuery(api.feedbackInbox.list, useAuthedArgs({ open: view === "open" }, "account"));
  const setStatus = useMutation(api.feedbackInbox.setStatus);
  const [enlarged, setEnlarged] = useState<string | null>(null);

  async function move(feedbackId: Id<"feedbackReports">, status: "triaged" | "in_progress" | "resolved" | "new") {
    try {
      await setStatus({ feedbackId, status });
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "The status did not change. Try again." }).message);
    }
  }

  return (
    <section className="feedback-inbox" aria-labelledby="feedback-inbox-title">
      <AdminSectionHeader
        title="Feedback"
        detail="Sent from the feedback button, with a picture of the page."
        action={
          <Segmented
            label="Which feedback"
            size="compact"
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: "Open" },
              { value: "done", label: "Resolved" },
            ]}
          />
        }
      />
      {items === undefined ? null : items.length === 0 ? (
        <p className="px-4 pb-4 text-caption text-[var(--text-secondary)]">
          {view === "open" ? "Nothing waiting. New feedback lands here." : "Nothing resolved yet."}
        </p>
      ) : (
        <ul className="feedback-inbox-list">
          {items.map((item) => (
            <li key={item.feedbackId} className="feedback-inbox-item">
              {item.screenshotUrl ? (
                <button
                  type="button"
                  className="feedback-inbox-shot"
                  aria-label="Enlarge the picture"
                  aria-expanded={enlarged === item.feedbackId}
                  onClick={() => setEnlarged(enlarged === item.feedbackId ? null : item.feedbackId)}
                  data-enlarged={enlarged === item.feedbackId || undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.screenshotUrl} alt={`What ${item.reporter?.name ?? "the reporter"} saw`} />
                </button>
              ) : null}
              <div className="min-w-0">
                <p className="text-micro text-[var(--text-tertiary)]">
                  {KIND_WORDS[item.category] ?? "Feedback"}, {STATUS_WORDS[item.status]?.toLowerCase()}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-ui text-[var(--text-primary)]">{item.message}</p>
                {item.attachments.length ? (
                  <div className="feedback-inbox-files">
                    {item.attachments.map((file) => (
                      <a key={file.url} href={file.url} target="_blank" rel="noreferrer" title={file.name}>
                        <FeedbackFilePreview name={file.name} mediaType={file.mediaType} url={file.url} />
                        <span className="truncate">{file.name}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
                <p className="mt-1.5 text-micro text-[var(--text-secondary)]">
                  {item.reporter?.name ?? "Someone"}
                  {item.school ? ` at ${item.school}` : ""}, {new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  {item.pagePath ? ` on ${item.pagePath}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.status === "new" ? (
                    <Button size="sm" variant="ghost" onClick={() => void move(item.feedbackId, "triaged")}>
                      Mark seen
                    </Button>
                  ) : null}
                  {item.status !== "in_progress" && view === "open" ? (
                    <Button size="sm" variant="ghost" onClick={() => void move(item.feedbackId, "in_progress")}>
                      Fixing it
                    </Button>
                  ) : null}
                  {view === "open" ? (
                    <Button size="sm" variant="secondary" onClick={() => void move(item.feedbackId, "resolved")}>
                      Resolve
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void move(item.feedbackId, "new")}>
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
