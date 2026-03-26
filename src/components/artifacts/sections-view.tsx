"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pin } from "lucide-react";
import { ARTIFACT_SECTIONS, getArtifactMeta } from "@/lib/artifact-types";
import { ArtifactCard, type ArtifactItem } from "./artifact-card";
import { cn } from "@/lib/utils";

export function SectionsView({
  artifacts,
  onOpen,
  onPin,
  onArchive,
  onDelete,
}: {
  artifacts: ArtifactItem[];
  onOpen: (id: string) => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const pinned = useMemo(() => artifacts.filter((a) => a.pinnedAt), [artifacts]);

  const sections = useMemo(() => {
    const map: Record<string, ArtifactItem[]> = {};
    for (const section of ARTIFACT_SECTIONS) {
      map[section] = [];
    }
    for (const a of artifacts) {
      const meta = getArtifactMeta(a.type);
      const section = meta.section;
      if (!map[section]) map[section] = [];
      map[section].push(a);
    }
    return Object.entries(map).filter(([, items]) => items.length > 0);
  }, [artifacts]);

  return (
    <div className="space-y-6">
      {/* Pinned section */}
      {pinned.length > 0 ? (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Pin className="h-3.5 w-3.5 fill-[var(--brand-primary)] text-[var(--brand-primary)]" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Pinned
            </h2>
            <span className="rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--text-tertiary)]">{pinned.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pinned.map((a) => (
              <ArtifactCard
                key={a._id}
                artifact={a}
                onClick={() => onOpen(a._id)}
                onPin={() => onPin(a._id)}
                onArchive={() => onArchive(a._id)}
                onDelete={() => onDelete(a._id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Type sections */}
      {sections.map(([sectionName, items]) => {
        const isCollapsed = collapsed[sectionName];
        return (
          <section key={sectionName}>
            <button
              type="button"
              className="mb-4 flex w-full items-center gap-2 text-left"
              onClick={() =>
                setCollapsed((prev) => ({ ...prev, [sectionName]: !prev[sectionName] }))
              }
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              )}
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {sectionName}
              </h2>
              <span className="rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--text-tertiary)]">{items.length}</span>
              <div className="ml-2 h-px flex-1 bg-[var(--border-default)]" />
            </button>
            {!isCollapsed ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((a) => (
                  <ArtifactCard
                    key={a._id}
                    artifact={a}
                    onClick={() => onOpen(a._id)}
                    onPin={() => onPin(a._id)}
                    onArchive={() => onArchive(a._id)}
                    onDelete={() => onDelete(a._id)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}

      {artifacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 rounded-2xl bg-[var(--bg-secondary)] p-6">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-[var(--text-tertiary)]">
              <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" fill="none" />
              <path d="M6 18h36" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="14" r="1.5" fill="currentColor" />
              <circle cx="17" cy="14" r="1.5" fill="currentColor" />
              <circle cx="22" cy="14" r="1.5" fill="currentColor" />
              <rect x="14" y="24" width="20" height="2" rx="1" fill="currentColor" opacity="0.4" />
              <rect x="14" y="30" width="14" height="2" rx="1" fill="currentColor" opacity="0.3" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            Your workspace is empty
          </h3>
          <p className="mt-1.5 max-w-sm text-sm text-[var(--text-secondary)]">
            Artifacts appear here as you create study plans, save flashcard decks, generate documents, and bookmark messages from chat.
          </p>
        </div>
      ) : null}
    </div>
  );
}
