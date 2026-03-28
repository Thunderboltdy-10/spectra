"use client";

import { useCallback, useMemo, useState } from "react";
import { ArtifactCard, type ArtifactItem } from "./artifact-card";
import { cn } from "@/lib/utils";

const ZONES = [
  { id: "active", label: "Active Projects", color: "var(--brand-primary)", hint: "Pinned items" },
  { id: "study", label: "Study Tools", color: "#158f72", hint: "Study-related artifacts" },
  { id: "recent", label: "Recent", color: "#f59f0a", hint: "Recently modified" },
  { id: "archived", label: "Archived", color: "var(--text-tertiary)", hint: "Archived items" },
] as const;

function assignZone(artifact: ArtifactItem): string {
  if (artifact.status === "archived") return "archived";
  if (artifact.pinnedAt) return "active";

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (artifact.updatedAt > weekAgo) return "recent";

  const studyTypes = new Set(["flashcard_deck", "study_plan", "timetable", "note"]);
  if (studyTypes.has(artifact.type)) return "study";

  return "recent";
}

export function CanvasView({
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
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const zoneMap = useMemo(() => {
    const map: Record<string, ArtifactItem[]> = {};
    for (const z of ZONES) map[z.id] = [];
    for (const a of artifacts) {
      const zone = assignZone(a);
      if (!map[zone]) map[zone] = [];
      map[zone].push(a);
    }
    return map;
  }, [artifacts]);

  const handleDragStart = useCallback((e: React.DragEvent, artifactId: string) => {
    e.dataTransfer.setData("text/plain", artifactId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(artifactId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverZone(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetZone: string) => {
    e.preventDefault();
    setDragOverZone(null);
    setDraggingId(null);
    const artifactId = e.dataTransfer.getData("text/plain");
    if (!artifactId) return;

    const artifact = artifacts.find((a) => a._id === artifactId);
    if (!artifact) return;
    const currentZone = assignZone(artifact);
    if (currentZone === targetZone) return;

    // Dropping into "active" → pin it
    if (targetZone === "active" && !artifact.pinnedAt) {
      onPin(artifactId);
    }
    // Dropping out of "active" → unpin it
    else if (currentZone === "active" && targetZone !== "active" && artifact.pinnedAt) {
      onPin(artifactId); // toggle
    }
    // Dropping into "archived" → archive it
    if (targetZone === "archived" && artifact.status !== "archived") {
      onArchive(artifactId);
    }
    // Dropping out of "archived" → restore it
    else if (currentZone === "archived" && targetZone !== "archived" && artifact.status === "archived") {
      onArchive(artifactId); // toggle
    }
  }, [artifacts, onPin, onArchive]);

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-[var(--text-secondary)]">No artifacts to display on canvas.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {ZONES.map((zone) => {
        const items = zoneMap[zone.id] ?? [];
        if (items.length === 0 && zone.id === "archived" && !dragOverZone) return null;
        const isDropTarget = dragOverZone === zone.id;

        return (
          <div
            key={zone.id}
            className={cn(
              "rounded-[var(--radius-container)] border-2 border-dashed p-4 transition-colors duration-150",
              zone.id === "active" && "lg:col-span-2",
              isDropTarget
                ? "border-[var(--brand-primary)] bg-[color-mix(in_oklab,var(--brand-primary)_6%,var(--bg-primary))]"
                : "border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-secondary)_30%,var(--bg-primary))]",
              isDropTarget && "border-solid",
              !isDropTarget && "border-solid",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverZone(zone.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverZone(null);
              }
            }}
            onDrop={(e) => handleDrop(e, zone.id)}
          >
            {/* Zone header */}
            <div className="mb-3 flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: zone.color }}
              />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {zone.label}
              </h3>
              <span className="rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--text-tertiary)]">{items.length}</span>
              {isDropTarget ? (
                <span className="ml-auto text-[10px] font-medium text-[var(--brand-primary)]">
                  Drop here
                </span>
              ) : null}
            </div>

            {items.length > 0 ? (
              <div
                className={cn(
                  "grid gap-3",
                  zone.id === "active"
                    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    : "grid-cols-1 sm:grid-cols-2",
                )}
              >
                {items.map((a) => (
                  <div
                    key={a._id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, a._id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "cursor-grab active:cursor-grabbing",
                      draggingId === a._id && "opacity-40",
                    )}
                  >
                    <ArtifactCard
                      artifact={a}
                      compact
                      onClick={() => onOpen(a._id)}
                      onPin={() => onPin(a._id)}
                      onArchive={() => onArchive(a._id)}
                      onDelete={() => onDelete(a._id)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-[var(--border-default)] py-8">
                <p className="text-xs text-[var(--text-tertiary)]">
                  {zone.id === "active"
                    ? "Pin artifacts or drag here"
                    : isDropTarget ? "Release to move here" : "No items in this zone"}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
