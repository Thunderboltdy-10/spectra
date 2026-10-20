"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { formatRelativeTime } from "../components/spectra-view-model";
import { getSpectraResultCards, type SpectraResultCard } from "../data/api";

/*
 * Every run's result, hidden ones included, so nothing Spectra did is out of
 * reach. Threads have their own column; this panel is only about runs.
 */

export function ChatRunsPanel({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<SpectraResultCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void getSpectraResultCards({ includeHidden: true, limit: 50 })
      .then((result) => live && setCards(result.resultCards))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside aria-label="Runs" className="chat-runs absolute inset-y-0 right-0 z-panel flex w-[min(380px,92vw)] flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
        <h2 className="min-w-0 flex-1 font-display text-heading font-medium leading-none">Runs</h2>
        <IconButton icon="close" label="Close runs" onClick={onClose} />
      </div>
      <p className="px-5 pb-3 text-caption text-[var(--text-tertiary)]">What each run produced, including results you hid.</p>
      <ol className="spectra-thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-6">
        {failed ? <li className="px-2 text-caption text-[var(--text-secondary)]">Runs could not load. Close and open this panel to try again.</li> : null}
        {!cards && !failed
          ? [0, 1, 2].map((index) => <li key={index} data-life-ghost className="h-[68px] animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-secondary)]" />)
          : null}
        {cards && !cards.length ? <li className="px-2 text-caption text-[var(--text-secondary)]">No runs yet. Results appear here once Spectra finishes something.</li> : null}
        {cards?.map((card) => (
          <li key={card._id} className="chat-run">
            <span className="flex items-center gap-2 text-ui font-medium text-[var(--text-primary)]">
              <Icon name="activity" size={13} />
              <span className="min-w-0 flex-1 truncate">{card.title}</span>
              {card.createdAt ? <span className="shrink-0 text-micro font-normal text-[var(--text-tertiary)]">{formatRelativeTime(card.createdAt)}</span> : null}
            </span>
            {card.summary ? <span className="mt-1 line-clamp-2 block text-caption leading-[1.45] text-[var(--text-secondary)]">{card.summary}</span> : null}
          </li>
        ))}
      </ol>
    </aside>
  );
}
