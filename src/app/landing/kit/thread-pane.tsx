"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { ThreadConversation } from "@/features/spectra/components/conversation-surface";
import type { SpectraRunEngine } from "@/features/spectra/island/engine";

/*
 * A thread, shown the way Spectra shows one beside the work: its title, what
 * the run is doing while it works, and the conversation itself (the steps,
 * the places it read, the answer with its citations). It sits in the layout
 * rather than over it, and its body scrolls on its own: the wheel over it
 * moves the conversation, never the page.
 */

export type ShownThread = { runId: string; threadId: string; title: string };

export function ThreadPane({
  thread,
  engine,
  onOpenWork,
  onClose,
  className,
}: {
  thread: ShownThread;
  engine: SpectraRunEngine;
  onOpenWork: (workId: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const live =
    engine.liveExchange?.runId === thread.runId ? engine.liveExchange : null;
  const working = Boolean(live && engine.submitting);
  const caption =
    live?.steps.at(-1)?.title ??
    (live?.content?.trim() ? "Writing the answer" : "Starting");
  return (
    <section
      className={className ? `sp-thread ${className}` : "sp-thread"}
      aria-label={`Thread: ${thread.title}`}
      data-working={working || undefined}
    >
      <header className="sp-thread-head">
        <div className="sp-thread-name">
          <p className="sp-thread-title">{thread.title}</p>
          <p className="sp-thread-caption">
            {working ? caption : "In Henry's threads"}
          </p>
        </div>
        <Link href="/sign-in" className="sp-thread-action" title="Open as page">
          <Icon name="openFull" size={15} />
        </Link>
        <button
          type="button"
          className="sp-thread-action"
          onClick={onClose}
          title="Close"
        >
          <Icon name="close" size={15} />
        </button>
      </header>
      <div className="sp-thread-body">
        <ThreadConversation
          key={thread.threadId}
          threadId={thread.threadId}
          compact
          liveExchange={live}
          onOpenArtifact={onOpenWork}
        />
      </div>
    </section>
  );
}
