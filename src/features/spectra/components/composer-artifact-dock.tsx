"use client";

import { useMemo, type CSSProperties } from "react";
import { ExternalLink, FileText, X } from "lucide-react";
import type { ResultCardStreamView } from "../ai/stream-events";
import type { SpectraArtifact } from "../data/api";
import { blueprintMeta } from "./artifact-card";

function collectMentionedIds(
  content: string | undefined,
  artifacts: SpectraArtifact[],
) {
  if (!content?.trim() || artifacts.length === 0) return [] as string[];
  const lower = content.toLowerCase();
  const ranked = artifacts
    .map((artifact) => {
      const title = artifact.title.trim();
      if (title.length < 3) return null;
      const index = lower.indexOf(title.toLowerCase());
      if (index === -1) return null;
      return { id: artifact._id, index, length: title.length };
    })
    .filter((row): row is { id: string; index: number; length: number } =>
      Boolean(row),
    )
    .sort((a, b) => b.length - a.length || a.index - b.index);
  const ids: string[] = [];
  for (const row of ranked) {
    if (!ids.includes(row.id)) ids.push(row.id);
    if (ids.length >= 8) break;
  }
  return ids;
}

export function ComposerArtifactDock({
  artifacts,
  cards,
  explicitIds,
  assistantContent,
  onOpen,
  onDismiss,
}: {
  artifacts: SpectraArtifact[];
  cards?: ResultCardStreamView[];
  /** Explicit IDs the model asked to surface. */
  explicitIds?: string[];
  assistantContent?: string;
  onOpen?: (artifactId: string) => void;
  onDismiss?: (artifactId: string) => void;
}) {
  const rows = useMemo(() => {
    const byId = new Map(artifacts.map((artifact) => [artifact._id, artifact]));
    const ordered: string[] = [];
    const push = (id?: string | null) => {
      if (!id || !byId.has(id) || ordered.includes(id)) return;
      ordered.push(id);
    };
    for (const id of explicitIds ?? []) push(id);
    for (const card of cards ?? []) {
      for (const id of card.provenance?.artifactIds ?? []) push(id);
      for (const action of card.actions ?? []) {
        if (action.targetType === "artifact") push(action.targetId);
      }
    }
    for (const id of collectMentionedIds(assistantContent, artifacts)) push(id);
    return ordered
      .slice(0, 6)
      .flatMap((id) => {
        const artifact = byId.get(id);
        return artifact ? [artifact] : [];
      });
  }, [artifacts, assistantContent, cards, explicitIds]);

  if (rows.length === 0) return null;

  return (
    <div
      className="mb-2 flex max-h-[148px] flex-col gap-1.5 overflow-y-auto [scrollbar-width:thin]"
      aria-label="Work from this conversation"
    >
      {rows.map((artifact) => {
        const meta = blueprintMeta[artifact.blueprintKey];
        const Icon = meta?.icon ?? FileText;
        return (
          <div
            key={artifact._id}
            data-spectra-card="result"
            data-card-state="normal"
            data-interactive={onOpen ? "true" : undefined}
            className="px-3 py-2 outline-none"
            style={{ "--card-accent": "var(--card-pinned)" } as CSSProperties}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)]"
                style={{ color: meta?.color ?? "#d88922" }}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(artifact._id)}
                    className="block max-w-full truncate rounded-[4px] text-left text-[12px] font-semibold text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
                  >
                    {artifact.title}
                  </button>
                ) : (
                  <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                    {artifact.title}
                  </div>
                )}
                <div className="truncate text-micro text-[var(--text-secondary)]">
                  {artifact.summary ??
                    meta?.label ??
                    artifact.blueprintKey.replaceAll("_", " ")}
                </div>
              </div>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(artifact._id)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  aria-label={`Open ${artifact.title}`}
                  title="Open"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {onDismiss ? (
                <button
                  type="button"
                  onClick={() => onDismiss(artifact._id)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  aria-label={`Hide ${artifact.title}`}
                  title="Hide"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
