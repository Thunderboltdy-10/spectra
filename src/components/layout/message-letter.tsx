"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { SpectraSchoolMessage } from "@/features/spectra/data/api";

/*
 * A message from a person's school, or from Spectra itself, read as a
 * letter: who wrote it and when, then their words in full.
 */
export function MessageLetter({ message, onClose }: { message: SpectraSchoolMessage | null; onClose: () => void }) {
  const sent = message ? new Date(message.sentAt ?? message.createdAt) : null;
  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-[560px] gap-0 p-0">
        {message && sent ? (
          <article className="grid gap-0">
            <header className="border-b border-[var(--border-subtle)] px-6 pb-4 pt-6">
              <p className="text-micro text-[var(--text-tertiary)]">
                {message.origin === "platform" ? "From Spectra" : `From ${message.from}`}
                {message.author && message.origin !== "platform" ? `, written by ${message.author}` : ""}
                {message.personal ? ", to you" : ""}
              </p>
              <DialogTitle className="mt-1 font-display text-title font-semibold">{message.title}</DialogTitle>
              <DialogDescription className="mt-1 text-micro text-[var(--text-tertiary)]">
                {sent.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}
              </DialogDescription>
            </header>
            <div className="spectra-thin-scrollbar max-h-[60vh] overflow-y-auto whitespace-pre-wrap px-6 py-5 text-body leading-6 text-[var(--text-primary)]">
              {message.body}
            </div>
          </article>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
