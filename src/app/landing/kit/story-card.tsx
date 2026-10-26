"use client";

import { useWorkPreviews } from "@/features/spectra/artifacts/use-work-previews";
import { meaningfulSummary } from "@/features/spectra/artifacts/work-preview";
import { openWorkInSide } from "@/features/spectra/components/side-open";
import { WorkCard } from "@/features/spectra/components/work-card";
import { useClassBook } from "@/features/spectra/school/use-class-book";
import { cn } from "@/lib/utils";
import type { StoryWork } from "../world/works";

/*
 * Henry's works as the cards Spectra draws on Home and in the Library: the
 * real card, its real preview (read from the story through the app's own
 * route) and the class ink. Clicking one opens it beside the page.
 */

const placeOf = (work: StoryWork) => work.placements?.[0]?.workspaceTitle ?? "Inbox";

export function StoryCards({ works, lit, className, live }: { works: readonly StoryWork[]; lit?: string | null; className?: string; live?: ReadonlySet<string> }) {
  const previewOf = useWorkPreviews(works);
  const book = useClassBook();
  return (
    <div className={cn("landing-cards work-desk", className)}>
      {works.map((work) => (
        <div key={work._id} className="landing-card" data-lit={lit === work._id || undefined}>
          <WorkCard
            type={work.blueprintKey}
            title={work.title}
            preview={previewOf(work)}
            summary={meaningfulSummary(work.blueprintKey, work.summary)}
            place={placeOf(work)}
            ink={book.named(placeOf(work))?.ink}
            href="#"
            onOpen={() => openWorkInSide(work._id)}
            live={live?.has(work._id)}
          />
        </div>
      ))}
    </div>
  );
}
