"use client";

import { useMemo } from "react";
import { getArtifactMeta } from "@/lib/artifact-types";
import type { ArtifactItem } from "./artifact-card";

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  if (isToday) return "Today";
  if (isYesterday) return "Yesterday";

  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type GroupedDay = {
  date: string;
  items: ArtifactItem[];
};

export function TimelineView({
  artifacts,
  onOpen,
}: {
  artifacts: ArtifactItem[];
  onOpen: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const sorted = [...artifacts].sort((a, b) => b.updatedAt - a.updatedAt);
    const groups: GroupedDay[] = [];
    let currentDate = "";
    let currentGroup: ArtifactItem[] = [];

    for (const a of sorted) {
      const date = formatDate(a.updatedAt);
      if (date !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, items: currentGroup });
        }
        currentDate = date;
        currentGroup = [a];
      } else {
        currentGroup.push(a);
      }
    }
    if (currentGroup.length > 0) {
      groups.push({ date: currentDate, items: currentGroup });
    }
    return groups;
  }, [artifacts]);

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-[var(--text-secondary)]">No artifacts to show on the timeline.</p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-3xl">
      {/* Timeline spine */}
      <div className="absolute bottom-0 left-[23px] top-0 w-px bg-[var(--border-default)]" />

      {grouped.map((group) => (
        <div key={group.date} className="relative mb-8">
          {/* Date marker */}
          <div className="relative mb-4 flex items-center gap-3 pl-0">
            <div className="relative z-10 flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border-2 border-[var(--border-default)] bg-[var(--bg-elevated)]">
              <span className="text-[11px] font-bold text-[var(--text-secondary)]">
                {group.date === "Today"
                  ? "Now"
                  : group.date === "Yesterday"
                    ? "Yest"
                    : group.date.slice(0, 3)}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{group.date}</h3>
            <span className="text-xs text-[var(--text-tertiary)]">
              {group.items.length} artifact{group.items.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Items */}
          <div className="space-y-2 pl-[56px]">
            {group.items.map((artifact) => {
              const meta = getArtifactMeta(artifact.type);
              const Icon = meta.icon;

              return (
                <button
                  key={artifact._id}
                  type="button"
                  className="group flex w-full items-center gap-3 rounded-[14px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-left transition-all duration-150 hover:border-[color-mix(in_oklab,var(--brand-primary)_30%,var(--border-default))] hover:shadow-[var(--shadow-card)]"
                  onClick={() => onOpen(artifact._id)}
                >
                  {/* Connector dot */}
                  <div
                    className="absolute left-[19px] h-[9px] w-[9px] rounded-full border-2 border-[var(--bg-elevated)]"
                    style={{ backgroundColor: meta.color }}
                  />

                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: `color-mix(in oklab, ${meta.color} 12%, var(--bg-primary))`,
                      color: meta.color,
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {artifact.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                        {meta.label}
                      </span>
                    </div>
                    {artifact.tags && artifact.tags.length > 0 ? (
                      <div className="mt-1 flex gap-1">
                        {artifact.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                    {formatTime(artifact.updatedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
