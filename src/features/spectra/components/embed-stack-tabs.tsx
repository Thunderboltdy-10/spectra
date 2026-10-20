"use client";

import { useQuery } from "convex/react";
import type { CSSProperties } from "react";
import { FileQuestion } from "@/components/icons/glyph-icons";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SpectraArtifactEmbed } from "../data/api";
import { workTypeMeta } from "./artifact-card";
import { workCardStyle } from "./work-card";

/*
 * The tabs across a stacked reference (EDITORS.md, "Embeds"): one per work,
 * spaced like the tabs above a page, scrolling sideways when there are many.
 * A press turns the card to that work; the card shows only the one.
 */
export function EmbedStackTabs({
  embedIds,
  active,
  onChoose,
}: {
  embedIds: string[];
  active: string;
  onChoose: (embedId: string) => void;
}) {
  return (
    <div role="tablist" aria-label={`${embedIds.length} works on this card`} className="work-embed-stack-tabs">
      {embedIds.map((embedId) => (
        <StackTab key={embedId} embedId={embedId} selected={embedId === active} onChoose={() => onChoose(embedId)} />
      ))}
    </div>
  );
}

function StackTab({ embedId, selected, onChoose }: { embedId: string; selected: boolean; onChoose: () => void }) {
  // The same read the card makes for its work, so turning to it shows at once.
  const embed = useQuery(api.artifactEmbeds.getProjection, { embedId: embedId as Id<"artifactEmbeds"> }) as
    | SpectraArtifactEmbed
    | null
    | undefined;
  const source = embed?.source;
  const meta = source ? workTypeMeta[source.blueprintKey] : null;
  const Icon = meta?.icon ?? FileQuestion;
  const title = source?.title ?? (embed === undefined ? "…" : "Unavailable");
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={title}
      onClick={onChoose}
      className="work-card-tab work-embed-tab work-embed-stack-tab"
      style={(source ? workCardStyle(source.blueprintKey) : undefined) as CSSProperties | undefined}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="work-embed-stack-tab-name">{title}</span>
    </button>
  );
}
