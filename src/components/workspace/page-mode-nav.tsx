"use client";

/* ===================================================================
   PageModeNav — touchpad-friendly paginated navigation over the SAME
   store content. Three levels:

     atlas:     grid of all workspaces (keyboard-navigable)
     workspace: regions inside a workspace (groups per current lens)
     region:    items inside the selected region (editable cards)
   =================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, ChevronLeft } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { territoryInk, coordinateBadge } from "@/lib/workspace/atlas-theme";
import type { ViewMode, WorkspaceData, WorkspaceItemData } from "@/lib/workspace/contracts";
import { TYPE_GROUP_LABELS } from "@/lib/workspace/contracts";
import {
  CANONICAL_WORKSPACE_TYPE_META,
  type CanonicalWorkspaceType,
} from "@/lib/artifact-types";

export function PageModeNav() {
  const navigationMode = useWorkspaceStore((s) => s.navigationMode);
  const pageLevel = useWorkspaceStore((s) => s.pageLevel);
  const setPageLevel = useWorkspaceStore((s) => s.setPageLevel);
  const pageRegionKey = useWorkspaceStore((s) => s.pageRegionKey);
  const setPageRegionKey = useWorkspaceStore((s) => s.setPageRegionKey);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const committedWorkspaceId = useWorkspaceStore((s) => s.committedWorkspaceId);
  const commitToWorkspace = useWorkspaceStore((s) => s.commitToWorkspace);
  const flyToWorkspace = useWorkspaceStore((s) => s.flyToWorkspace);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);
  const viewMode = useWorkspaceStore((s) => s.viewMode);

  // Focus index for atlas grid
  const [atlasIdx, setAtlasIdx] = useState(0);
  const [regionIdx, setRegionIdx] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === committedWorkspaceId) ?? null,
    [workspaces, committedWorkspaceId],
  );

  const regions = useMemo(() => {
    if (!selectedWorkspace) return [];
    return lensRegions(selectedWorkspace.items, viewMode);
  }, [selectedWorkspace, viewMode]);

  const selectedRegion = useMemo(() => {
    if (!regions.length) return null;
    if (pageRegionKey) {
      const match = regions.find((r) => r.key === pageRegionKey);
      if (match) return match;
    }
    return regions[regionIdx] ?? regions[0];
  }, [regions, pageRegionKey, regionIdx]);

  const enterWorkspace = useCallback(
    (id: string) => {
      commitToWorkspace(id);
      flyToWorkspace(id);
      setPageLevel("workspace");
      setRegionIdx(0);
      setPageRegionKey(null);
    },
    [commitToWorkspace, flyToWorkspace, setPageLevel, setPageRegionKey],
  );

  const enterRegion = useCallback(
    (key: string) => {
      setPageRegionKey(key);
      setPageLevel("region");
      setItemIdx(0);
    },
    [setPageLevel, setPageRegionKey],
  );

  // Keyboard navigation
  useEffect(() => {
    if (navigationMode !== "pages") return;
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;

      if (e.key === "Backspace") {
        e.preventDefault();
        if (pageLevel === "region") setPageLevel("workspace");
        else if (pageLevel === "workspace") {
          setPageLevel("atlas");
          commitToWorkspace(null);
        }
        return;
      }

      if (pageLevel === "atlas") {
        if (e.key === "ArrowRight" || e.key === "l" || e.key === "L") {
          e.preventDefault();
          setAtlasIdx((i) => Math.min(workspaces.length - 1, i + 1));
        } else if (e.key === "ArrowLeft" || e.key === "h" || e.key === "H") {
          e.preventDefault();
          setAtlasIdx((i) => Math.max(0, i - 1));
        } else if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          setAtlasIdx((i) => Math.min(workspaces.length - 1, i + 3));
        } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          setAtlasIdx((i) => Math.max(0, i - 3));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const ws = workspaces[atlasIdx];
          if (ws) enterWorkspace(ws.id);
        }
      } else if (pageLevel === "workspace") {
        if (e.key === "ArrowRight" || e.key === "l" || e.key === "L" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          setRegionIdx((i) => Math.min(regions.length - 1, i + 1));
        } else if (e.key === "ArrowLeft" || e.key === "h" || e.key === "H" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          setRegionIdx((i) => Math.max(0, i - 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const r = regions[regionIdx];
          if (r) enterRegion(r.key);
        }
      } else if (pageLevel === "region") {
        const itemCount = selectedRegion?.items.length ?? 0;
        if (e.key === "ArrowRight" || e.key === "l" || e.key === "L" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          setItemIdx((i) => Math.min(itemCount - 1, i + 1));
        } else if (e.key === "ArrowLeft" || e.key === "h" || e.key === "H" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          setItemIdx((i) => Math.max(0, i - 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const item = selectedRegion?.items[itemIdx];
          if (item) setFocusedItem(item.id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    navigationMode, pageLevel, workspaces, atlasIdx, regions, regionIdx,
    selectedRegion, itemIdx, enterWorkspace, enterRegion, setPageLevel,
    commitToWorkspace, setFocusedItem,
  ]);

  if (navigationMode !== "pages") return null;

  return (
    <div
      className="absolute inset-0 z-[30] overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Breadcrumb */}
      <div className="pointer-events-auto absolute left-1/2 top-14 z-20 -translate-x-1/2">
        <Breadcrumb
          pageLevel={pageLevel}
          workspace={selectedWorkspace}
          region={selectedRegion}
          onClickAtlas={() => {
            setPageLevel("atlas");
            commitToWorkspace(null);
          }}
          onClickWorkspace={() => setPageLevel("workspace")}
        />
      </div>

      <AnimatePresence mode="wait">
        {pageLevel === "atlas" && (
          <motion.div
            key="atlas"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <AtlasView
              workspaces={workspaces}
              focusedIdx={atlasIdx}
              onSelect={(id, idx) => {
                setAtlasIdx(idx);
                enterWorkspace(id);
              }}
            />
          </motion.div>
        )}

        {pageLevel === "workspace" && selectedWorkspace && (
          <motion.div
            key="workspace"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -32 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <WorkspaceView
              workspace={selectedWorkspace}
              regions={regions}
              focusedIdx={regionIdx}
              onPrev={() => setRegionIdx((i) => Math.max(0, i - 1))}
              onNext={() => setRegionIdx((i) => Math.min(regions.length - 1, i + 1))}
              onOpenRegion={(key, idx) => {
                setRegionIdx(idx);
                enterRegion(key);
              }}
            />
          </motion.div>
        )}

        {pageLevel === "region" && selectedWorkspace && selectedRegion && (
          <motion.div
            key="region"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -32 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <RegionView
              workspace={selectedWorkspace}
              region={selectedRegion}
              focusedIdx={itemIdx}
              onFocusItem={(idx, item) => {
                setItemIdx(idx);
                setFocusedItem(item.id);
              }}
              onPrev={() => setItemIdx((i) => Math.max(0, i - 1))}
              onNext={() =>
                setItemIdx((i) => Math.min(selectedRegion.items.length - 1, i + 1))
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Breadcrumb ──────────────────────────────────────── */

function Breadcrumb({
  pageLevel,
  workspace,
  region,
  onClickAtlas,
  onClickWorkspace,
}: {
  pageLevel: "atlas" | "workspace" | "region";
  workspace: WorkspaceData | null;
  region: { label: string; key: string } | null;
  onClickAtlas: () => void;
  onClickWorkspace: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/90 px-2.5 py-1.5 shadow-[0_6px_18px_-10px_rgba(10,14,20,0.18)] backdrop-blur-xl">
      <button
        type="button"
        onClick={onClickAtlas}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        Atlas
      </button>
      {workspace && (
        <>
          <span className="text-[10px] text-[var(--text-tertiary)]">/</span>
          <button
            type="button"
            onClick={onClickWorkspace}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-display font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <span>{workspace.emoji}</span>
            <span>{workspace.name}</span>
          </button>
        </>
      )}
      {pageLevel === "region" && region && (
        <>
          <span className="text-[10px] text-[var(--text-tertiary)]">/</span>
          <span className="rounded-full bg-[var(--bg-secondary)]/60 px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            {region.label}
          </span>
        </>
      )}
    </div>
  );
}

/* ─── Atlas view ──────────────────────────────────────── */

function AtlasView({
  workspaces,
  focusedIdx,
  onSelect,
}: {
  workspaces: WorkspaceData[];
  focusedIdx: number;
  onSelect: (id: string, idx: number) => void;
}) {
  return (
    <div className="flex h-full w-full items-start justify-center overflow-auto pt-32 pb-24">
      <div className="grid w-[min(1100px,92vw)] grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
        {workspaces.map((ws, idx) => {
          const ink = territoryInk(ws.id, ws.name);
          const focused = idx === focusedIdx;
          return (
            <button
              key={ws.id}
              type="button"
              onClick={() => onSelect(ws.id, idx)}
              className="group relative flex min-h-[240px] flex-col justify-between rounded-3xl border p-6 text-left transition-all duration-200"
              style={{
                background: "var(--bg-elevated)",
                borderColor: focused ? ink.accent : "var(--border-default)",
                boxShadow: focused
                  ? `0 18px 44px -18px ${ink.contour}`
                  : "0 6px 20px -14px rgba(10,14,20,0.10)",
                transform: focused ? "translateY(-2px)" : "translateY(0)",
              }}
            >
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl opacity-40">
                <div
                  style={{
                    position: "absolute",
                    inset: -4,
                    background: ink.fill,
                    mixBlendMode: "multiply",
                  }}
                />
              </div>
              <div className="relative flex items-start justify-between">
                <div className="text-5xl leading-none">{ws.emoji}</div>
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: ink.accent }}
                >
                  {coordinateBadge(ws.id)}
                </span>
              </div>
              <div className="relative mt-6">
                <div
                  className="font-display text-[26px] font-semibold leading-tight tracking-[-0.015em]"
                  style={{ color: ink.ink }}
                >
                  {ws.name}
                </div>
                <div className="mt-2 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  <span>{ws.itemCount} items</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--text-tertiary)]/60" />
                  <span>{ws.status}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Workspace view ──────────────────────────────────── */

function WorkspaceView({
  workspace,
  regions,
  focusedIdx,
  onPrev,
  onNext,
  onOpenRegion,
}: {
  workspace: WorkspaceData;
  regions: { label: string; key: string; items: WorkspaceItemData[] }[];
  focusedIdx: number;
  onPrev: () => void;
  onNext: () => void;
  onOpenRegion: (key: string, idx: number) => void;
}) {
  const ink = territoryInk(workspace.id, workspace.name);
  return (
    <div className="flex h-full w-full items-center justify-center pt-28 pb-24">
      <div className="relative w-[min(1100px,92vw)]">
        <div className="mb-10 text-center">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: ink.accent }}>
            {coordinateBadge(workspace.id)}
          </div>
          <div className="text-6xl">{workspace.emoji}</div>
          <h1
            className="font-display mt-4 text-[42px] font-semibold leading-[1.08] tracking-[-0.02em]"
            style={{ color: ink.ink }}
          >
            {workspace.name}
          </h1>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {regions.map((r, idx) => {
            const focused = idx === focusedIdx;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => onOpenRegion(r.key, idx)}
                className="flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-colors"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: focused ? ink.accent : "var(--border-default)",
                  boxShadow: focused
                    ? `0 12px 30px -18px ${ink.contour}`
                    : "0 4px 14px -10px rgba(10,14,20,0.08)",
                }}
              >
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.16em]"
                  style={{ color: ink.accent }}
                >
                  Region
                </div>
                <div className="font-display text-[22px] font-semibold leading-tight tracking-[-0.01em]" style={{ color: ink.ink }}>
                  {r.label}
                </div>
                <div className="mt-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  <span>{r.items.length} items</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Prev/next pills */}
        <div className="pointer-events-auto absolute -left-2 top-1/2 -translate-y-1/2">
          <PrevButton onClick={onPrev} disabled={focusedIdx === 0} />
        </div>
        <div className="pointer-events-auto absolute -right-2 top-1/2 -translate-y-1/2">
          <NextButton onClick={onNext} disabled={focusedIdx >= regions.length - 1} />
        </div>
      </div>
    </div>
  );
}

/* ─── Region view ─────────────────────────────────────── */

function RegionView({
  workspace,
  region,
  focusedIdx,
  onFocusItem,
  onPrev,
  onNext,
}: {
  workspace: WorkspaceData;
  region: { label: string; key: string; items: WorkspaceItemData[] };
  focusedIdx: number;
  onFocusItem: (idx: number, item: WorkspaceItemData) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const ink = territoryInk(workspace.id, workspace.name);

  return (
    <div className="flex h-full w-full items-start justify-center overflow-auto pt-28 pb-24">
      <div className="relative w-[min(1100px,92vw)]">
        <div className="mb-6 flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: ink.accent }}>
            {region.label}
          </span>
          <span className="h-px flex-1 bg-[var(--border-default)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            {region.items.length} items
          </span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {region.items.map((it, idx) => {
            const meta = CANONICAL_WORKSPACE_TYPE_META[it.itemType as CanonicalWorkspaceType];
            const Icon = meta?.icon;
            const focused = idx === focusedIdx;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onFocusItem(idx, it)}
                className="flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: focused ? ink.accent : "var(--border-default)",
                  boxShadow: focused
                    ? `0 10px 22px -14px ${ink.contour}`
                    : "0 3px 10px -8px rgba(10,14,20,0.08)",
                }}
              >
                <div className="flex items-center gap-2">
                  {Icon ? (
                    <Icon className="h-4 w-4" style={{ color: meta?.color }} />
                  ) : null}
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.14em]"
                    style={{ color: meta?.color ?? "var(--text-tertiary)" }}
                  >
                    {meta?.label ?? it.itemType}
                  </span>
                </div>
                <span className="font-display text-[16px] font-semibold leading-snug tracking-[-0.005em] text-[var(--text-primary)]">
                  {it.title}
                </span>
                {it.preview ? (
                  <span className="line-clamp-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    {it.preview}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="pointer-events-auto absolute -left-2 top-24">
          <PrevButton onClick={onPrev} disabled={focusedIdx === 0} />
        </div>
        <div className="pointer-events-auto absolute -right-2 top-24">
          <NextButton onClick={onNext} disabled={focusedIdx >= region.items.length - 1} />
        </div>
      </div>
    </div>
  );
}

/* ─── Prev/Next buttons ───────────────────────────────── */

function PrevButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[0_4px_14px_-8px_rgba(10,14,20,0.12)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-30"
      title="Previous (←)"
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );
}

function NextButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[0_4px_14px_-8px_rgba(10,14,20,0.12)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-30"
      title="Next (→)"
    >
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}

/* ─── Region computation (matches canvas lenses) ──────── */

type Region = { label: string; key: string; items: WorkspaceItemData[] };

function lensRegions(items: WorkspaceItemData[], mode: ViewMode): Region[] {
  if (mode === "timeline") {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const t0 = today.getTime();
    const buckets: Record<string, WorkspaceItemData[]> = {
      Today: [], Yesterday: [], "This week": [], Earlier: [],
    };
    for (const it of items) {
      const ts = it.updatedAt ?? 0;
      if (ts >= t0) buckets.Today.push(it);
      else if (ts >= t0 - 86400000) buckets.Yesterday.push(it);
      else if (ts >= now - 7 * 86400000) buckets["This week"].push(it);
      else buckets.Earlier.push(it);
    }
    return Object.entries(buckets)
      .filter(([, arr]) => arr.length)
      .map(([label, list]) => ({ label, key: label, items: list }));
  }

  if (mode === "byTopic") {
    const groups: Record<string, WorkspaceItemData[]> = {};
    const rest: WorkspaceItemData[] = [];
    for (const it of items) {
      if (it.topicCluster) {
        groups[it.topicCluster] = groups[it.topicCluster] ?? [];
        groups[it.topicCluster].push(it);
      } else {
        rest.push(it);
      }
    }
    const out: Region[] = Object.entries(groups).map(([label, list]) => ({
      label, key: label, items: list,
    }));
    if (rest.length) out.push({ label: "Misc", key: "__misc", items: rest });
    return out.length ? out : [{ label: "All", key: "__all", items }];
  }

  // byType
  const byType: Record<string, WorkspaceItemData[]> = {};
  for (const it of items) {
    byType[it.itemType] = byType[it.itemType] ?? [];
    byType[it.itemType].push(it);
  }
  const out: Region[] = [];
  for (const [key, group] of Object.entries(TYPE_GROUP_LABELS)) {
    const list = group.types.flatMap((t) => byType[t] ?? []);
    if (list.length) out.push({ label: group.label, key, items: list });
  }
  return out;
}
