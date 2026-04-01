"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps, type Edge } from "@xyflow/react";
import {
  MessageSquare,
  CalendarClock,
  FileText,
  Plus,
  GitMerge,
  Workflow,
  Sparkles,
  Crosshair,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PanelType } from "@/stores/workspace-store";

/* ─── Data types ────────────────────────────────────────────── */

export type ThreadSummary = {
  id: string;
  title: string;
  messageCount: number;
  lastActivityAt: number;
};

export type NoteSummary = {
  id: string;
  title: string;
  updatedAt: number;
  editorMode: string;
};

export type PlannerItemSummary = {
  id: string;
  title: string;
  dueAt?: number;
  status: "pending" | "in_progress" | "done";
};

export type ArtifactSummary = {
  id: string;
  title: string;
  type: string;
  createdAt: number;
};

export type InternalContentData = {
  threads: ThreadSummary[];
  notes: NoteSummary[];
  plannerItems: PlannerItemSummary[];
  artifacts: ArtifactSummary[];
  loading: boolean;
  workstreamEmoji?: string;
  workstreamTitle?: string;
  onOpenPanel: (type: PanelType, id: string) => void;
};

/* ─── Helper ────────────────────────────────────────────────── */

function formatTimeAgo(timestamp: number) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  const days = Math.floor(delta / 86_400_000);
  return `${days}d`;
}

type BaseGroupData = {
  label: string;
  items: Array<{ id: string; title: string; meta?: string; statusColor?: string; panelType: PanelType }>;
  onOpenPanel: (type: PanelType, id: string) => void;
};

/* ============================================================================
   APPROACH A: SEMANTIC CONSTELLATIONS
   "Deep Space" Paradigm: Ethereal, physics-based, data-heavy, relationship-driven.
   Nodes: ConstellationClusterNode
============================================================================ */

export type ConstellationClusterData = BaseGroupData & {
  glow: string;
  align: "left" | "right";
  iconType: string;
};

export const ConstellationClusterNode = memo(function ConstellationClusterNode({
  data,
}: NodeProps<Node<ConstellationClusterData>>) {
  const align = data.align;
  const Icon = {
    thread: GitMerge,
    note: FileText,
    planner: Workflow,
    artifact: Sparkles,
  }[data.iconType] ?? FileText;

  return (
    <div className={cn("relative flex w-[340px] flex-col gap-5", align === "right" && "items-end text-right")}>
      <Handle type="target" position={align === "left" ? Position.Right : Position.Left} className="!opacity-0" />
      <Handle type="source" position={align === "left" ? Position.Right : Position.Left} className="!opacity-0" />
      
      <div
        className="pointer-events-none absolute -inset-16 -z-10 rounded-full blur-[50px] mix-blend-screen opacity-70"
        style={{ background: `radial-gradient(circle, ${data.glow} 0%, transparent 60%)` }}
      />
      <div className={cn("flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--text-tertiary)]", align === "right" && "flex-row-reverse")}>
        <Icon className="w-4 h-4" />
        <span>{data.label}</span>
      </div>
      <div className="space-y-2 w-full">
        {data.items.slice(0, 6).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => data.onOpenPanel(item.panelType, item.id)}
            className={cn(
              "group relative flex w-full items-start gap-4 text-left transition-all duration-300 py-2",
              align === "right" && "justify-end text-right flex-row-reverse",
            )}
          >
            <div className={cn("absolute top-1/2 -translate-y-1/2 h-[1px] w-6 bg-[var(--text-tertiary)]/20 group-hover:bg-[var(--accent-cyan)]/50 transition-colors", align === "left" ? "-left-8" : "-right-8")} />
            
            {item.statusColor ? (
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_12px_currentColor]"
                style={{ color: item.statusColor, backgroundColor: item.statusColor }}
              />
            ) : (
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--text-tertiary)] group-hover:bg-[var(--text-primary)] transition-colors shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
            )}
            <div className="relative">
              <div className="text-[13px] font-medium text-[var(--text-secondary)] transition-colors duration-300 group-hover:text-[var(--text-primary)] group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]">
                {item.title}
              </div>
              {item.meta && <div className="text-[10px] text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors mt-0.5">{item.meta}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
});

export function buildConstellationNodes(
  data: InternalContentData,
  basePosition: { x: number; y: number },
): { nodes: Node[], edges: Edge[] } {
  if (data.loading) return { nodes: [], edges: [] };

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const addCluster = (id: string, label: string, items: BaseGroupData["items"], dx: number, dy: number, align: "left" | "right", glow: string, iconType: string) => {
    if (items.length === 0) return;
    nodes.push({
      id: `constellation-${id}`,
      type: "constellationCluster",
      position: { x: basePosition.x + dx, y: basePosition.y + dy },
      draggable: true,
      selectable: false,
      data: { label, items, align, glow, iconType, onOpenPanel: data.onOpenPanel } satisfies ConstellationClusterData,
    });
    // Add semantic links to center (the workstream box itself is roughly at basePosition)
    edges.push({
      id: `const-edge-${id}`,
      source: `ws-${data.workstreamTitle}`, // Pseudo-connection, won't strictly attach to handle if handle missing, but xyflow can center it.
      target: `constellation-${id}`,
      type: "straight",
      animated: true,
      style: { stroke: glow, strokeWidth: 1, opacity: 0.3, strokeDasharray: "4 4" },
    });
  };

  addCluster("threads", "Orbital Threads", data.threads.map(t => ({ id: t.id, title: t.title, meta: `${t.messageCount} msgs`, panelType: "chat" })), -400, 100, "right", "rgba(14,142,232,0.4)", "thread");
  addCluster("notes", "Fragmented Notes", data.notes.map(n => ({ id: n.id, title: n.title, meta: formatTimeAgo(n.updatedAt), panelType: "artifact" })), 400, -50, "left", "rgba(167,139,250,0.4)", "note");
  addCluster("planner", "Vectors & Paths", data.plannerItems.map(p => ({ id: p.id, title: p.title, meta: p.status, statusColor: p.status === "done" ? "var(--accent-mint)" : "var(--accent-cyan)", panelType: "planner" })), -350, 350, "right", "rgba(255,111,69,0.35)", "planner");
  addCluster("artifacts", "Constructed Artifacts", data.artifacts.map(a => ({ id: a.id, title: a.title, meta: a.type, panelType: "artifact" })), 450, 300, "left", "rgba(32,184,178,0.4)", "artifact");

  return { nodes, edges };
}

/* ============================================================================
   APPROACH B: MAGNETIC SURFACE (Recommended)
   "Tactile Glass" Paradigm: Fast, tactile, translucent, structured. macOS/Linear feel.
   Nodes: MagneticPanelNode
============================================================================ */

export type MagneticPanelData = BaseGroupData & {
  iconType: string;
  isMain?: boolean;
};

export const MagneticPanelNode = memo(function MagneticPanelNode({
  data,
}: NodeProps<Node<MagneticPanelData>>) {
  const Icon = {
    thread: MessageSquare,
    note: FileText,
    planner: CalendarClock,
    artifact: Sparkles,
  }[data.iconType] ?? FileText;

  return (
    <div className={cn(
      "rounded-[24px] border border-[var(--border-default)] p-5 backdrop-blur-3xl relative overflow-hidden transition-shadow duration-300",
      data.isMain ? "bg-[var(--bg-elevated)]/90 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.15)]" : "bg-[var(--bg-elevated)]/60 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.1)]",
      "hover:shadow-[0_30px_70px_-20px_rgba(0,0,0,0.2)]"
    )} style={{ width: data.isMain ? 480 : 340 }}>
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-elevated)]/40 to-transparent pointer-events-none" />
      
      <div className="flex items-center gap-2.5 mb-5 relative z-10">
        <div className="p-1.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)]/50">
          <Icon className="w-4 h-4" />
        </div>
        <div className="text-[12px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
          {data.label}
        </div>
      </div>
      
      <div className={cn("relative z-10", !data.isMain && "flex flex-col gap-1", data.isMain && "grid gap-3")}>
        {data.items.slice(0, 6).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => data.onOpenPanel(item.panelType, item.id)}
            className={cn(
              "group flex w-full items-center gap-3 rounded-[12px] text-left transition-all",
              data.isMain 
                ? "flex-col border border-[var(--border-default)]/60 bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)] px-5 py-4 shadow-sm hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.15)] hover:-translate-y-0.5" 
                : "px-3 py-2.5 hover:bg-[var(--bg-hover)]"
            )}
          >
            {data.isMain ? (
              <>
                <div className="flex items-start justify-between gap-4 w-full">
                  <span className="text-[15px] font-medium text-[var(--text-primary)] leading-tight">{item.title}</span>
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--accent-cyan)] transition-colors" />
                </div>
                {item.meta && <span className="mt-2 text-[11px] text-[var(--text-tertiary)] font-medium">{item.meta}</span>}
              </>
            ) : (
              <>
                {item.statusColor ? (
                  <span className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_8px_currentColor]" style={{ color: item.statusColor, backgroundColor: item.statusColor }} />
                ) : (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-tertiary)]" />
                )}
                <div className="min-w-0 flex-1 flex justify-between items-center gap-4">
                  <div className="truncate text-[13px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">{item.title}</div>
                  {item.meta && <div className="shrink-0 text-[10px] text-[var(--text-tertiary)]">{item.meta}</div>}
                </div>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
});

export function buildMagneticNodes(
  data: InternalContentData,
  basePosition: { x: number; y: number },
): { nodes: Node[], edges: Edge[] } {
  if (data.loading) return { nodes: [], edges: [] };
  const nodes: Node[] = [];
  
  const addPanel = (id: string, label: string, items: BaseGroupData["items"], dx: number, dy: number, isMain: boolean, iconType: string) => {
    if (items.length === 0) return;
    nodes.push({
      id: `magnetic-${id}`,
      type: "magneticPanel",
      position: { x: basePosition.x + dx, y: basePosition.y + dy },
      draggable: true,
      selectable: false,
      data: { label, items, iconType, isMain, onOpenPanel: data.onOpenPanel } satisfies MagneticPanelData,
    });
  };

  addPanel("threads", "Threads", data.threads.map(t => ({ id: t.id, title: t.title, meta: `${t.messageCount} msgs`, panelType: "chat" })), -100, 200, true, "thread");
  addPanel("planner", "Planner", data.plannerItems.map(p => ({ id: p.id, title: p.title, meta: p.status, statusColor: p.status === "done" ? "var(--accent-mint)" : "var(--accent-cyan)", panelType: "planner" })), -480, 200, false, "planner");
  addPanel("notes", "Documents", data.notes.map(n => ({ id: n.id, title: n.title, meta: formatTimeAgo(n.updatedAt), panelType: "artifact" })), -480, 520, false, "note");
  addPanel("artifacts", "Artifacts", data.artifacts.map(a => ({ id: a.id, title: a.title, meta: a.type, panelType: "artifact" })), 420, 200, false, "artifact");

  return { nodes, edges: [] };
}

/* ============================================================================
   APPROACH C: FOCAL LENSES
   "Guided Focus" Paradigm: Immersive, cinematic, high contrast within a boundary.
   Nodes: LensesLensNode
============================================================================ */

export type LensesLensData = BaseGroupData & {
  iconType: string;
  isSpotlight?: boolean;
};

export const LensesLensNode = memo(function LensesLensNode({
  data,
}: NodeProps<Node<LensesLensData>>) {
  const Icon = {
    thread: Crosshair,
    note: FileText,
    planner: CalendarClock,
    artifact: Sparkles,
  }[data.iconType] ?? FileText;

  if (data.isSpotlight) {
    return (
      <div className="rounded-[40px] border border-[var(--border-default)]/60 bg-[var(--bg-elevated)]/80 p-10 shadow-[0_0_100px_rgba(255,255,255,0.05),inset_0_0_40px_rgba(255,255,255,0.05)] backdrop-blur-3xl z-10 relative" style={{ width: 560 }}>
        <div className="absolute -top-px left-1/2 -translate-x-1/2 w-40 h-px bg-gradient-to-r from-transparent via-[var(--text-tertiary)]/40 to-transparent" />
        
        <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.3em] text-[var(--text-tertiary)] mb-6">
          <Icon className="w-4 h-4" /> {data.label}
        </div>

        <div className="space-y-3">
          {data.items.slice(0, 7).map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => data.onOpenPanel(item.panelType, item.id)}
              className={cn(
                "flex w-full items-center justify-between gap-4 rounded-[20px] border border-[var(--border-default)]/50 bg-[var(--bg-primary)] px-6 py-5 text-left transition-all duration-300 hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)] hover:scale-[1.02] hover:shadow-[0_20px_40px_-20px_rgba(0,0,0,0.15)]",
                idx === 0 && "bg-[var(--bg-secondary)] border-[var(--border-default)]" 
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-medium text-[var(--text-primary)]">{item.title}</div>
                {item.meta && <div className="mt-1.5 text-[11px] text-[var(--text-tertiary)] font-mono tracking-wide">{item.meta}</div>}
              </div>
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[var(--text-tertiary)] group-hover:bg-[var(--accent-cyan)] group-hover:text-white transition-colors group-hover:border-transparent">
                <MessageSquare className="w-4 h-4" />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="opacity-80 hover:opacity-100 transition-opacity duration-500" style={{ width: 300 }}>
      <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.3em] text-[var(--text-tertiary)] mb-6 px-2">
        <Icon className="w-4 h-4" /> {data.label}
      </div>
      <div className="space-y-3">
        {data.items.slice(0, 5).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => data.onOpenPanel(item.panelType, item.id)}
            className="flex w-full flex-col gap-2 rounded-[16px] border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/40 px-5 py-4 text-left transition-all hover:bg-[var(--bg-elevated)]/80 hover:border-[var(--border-default)] backdrop-blur-md"
          >
            <div className="flex items-start gap-3 w-full">
              {item.statusColor && (
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full shadow-[0_0_10px_currentColor]" style={{ color: item.statusColor, backgroundColor: item.statusColor }} />
              )}
              <div className="text-[14px] font-medium text-[var(--text-secondary)] leading-snug group-hover:text-[var(--text-primary)] transition-colors">{item.title}</div>
            </div>
            {item.meta && <div className="text-[10px] text-[var(--text-tertiary)] font-mono pl-5">{item.meta}</div>}
          </button>
        ))}
      </div>
    </div>
  );
});

export function buildLensesNodes(
  data: InternalContentData,
  basePosition: { x: number; y: number },
): { nodes: Node[], edges: Edge[] } {
  if (data.loading) return { nodes: [], edges: [] };
  const nodes: Node[] = [];
  
  const addLens = (id: string, label: string, items: BaseGroupData["items"], dx: number, dy: number, isSpotlight: boolean, iconType: string) => {
    if (items.length === 0) return;
    nodes.push({
      id: `lenses-${id}`,
      type: "lensesLens",
      position: { x: basePosition.x + dx, y: basePosition.y + dy },
      draggable: true,
      selectable: false,
      data: { label, items, iconType, isSpotlight, onOpenPanel: data.onOpenPanel } satisfies LensesLensData,
    });
  };

  addLens("threads", "Primary Focus", data.threads.map(t => ({ id: t.id, title: t.title, meta: `${t.messageCount} msgs`, panelType: "chat" })), -140, 200, true, "thread");
  addLens("planner", "Directives", data.plannerItems.map(p => ({ id: p.id, title: p.title, meta: p.status, statusColor: p.status === "done" ? "var(--accent-mint)" : "var(--accent-cyan)", panelType: "planner" })), -480, 240, false, "planner");
  addLens("notes", "References", data.notes.map(n => ({ id: n.id, title: n.title, meta: formatTimeAgo(n.updatedAt), panelType: "artifact" })), -480, 640, false, "note");
  addLens("artifacts", "Synthesized Outputs", data.artifacts.map(a => ({ id: a.id, title: a.title, meta: a.type, panelType: "artifact" })), 480, 240, false, "artifact");

  return { nodes, edges: [] };
}

/* ============================================================================
   SHARED NODES (Empty State, Focus Timer)
============================================================================ */

export type EmptyStateNodeData = {
  emoji: string;
  title: string;
  description: string;
  onNew?: () => void;
};

export const EmptyStateNode = memo(function EmptyStateNode({
  data,
}: NodeProps<Node<EmptyStateNodeData>>) {
  return (
    <div className="text-center py-8 px-6">
      <span className="text-4xl block mb-3">{data.emoji}</span>
      <h3 className="font-display text-lg text-[var(--text-primary)] mb-1.5">{data.title}</h3>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto mb-4">{data.description}</p>
      {data.onNew && (
        <button
          type="button"
          onClick={data.onNew}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all"
        >
          <Plus className="w-4 h-4" />
          Get started
        </button>
      )}
    </div>
  );
});

export type FocusTimerNodeData = {
  active: boolean;
  sessionMinutes: number;
  elapsed: number;
  sessionsCompleted: number;
  workstreamTitle?: string;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
};

export const FocusTimerNode = memo(function FocusTimerNode({
  data,
}: NodeProps<Node<FocusTimerNodeData>>) {
  const totalSeconds = data.sessionMinutes * 60;
  const remaining = Math.max(0, totalSeconds - data.elapsed);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const progress = totalSeconds > 0 ? data.elapsed / totalSeconds : 0;
  const circumference = 2 * Math.PI * 38;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div
      className="rounded-2xl border px-5 py-4 text-center backdrop-blur-xl"
      style={{
        width: 200,
        background: "color-mix(in oklab, var(--bg-elevated) 72%, transparent)",
        borderColor: data.active
          ? "color-mix(in oklab, var(--accent-cyan) 40%, var(--border-default))"
          : "var(--border-default)",
        boxShadow: data.active ? "0 0 20px -8px var(--accent-cyan)" : "0 10px 24px -10px rgba(0,0,0,0.1)",
        transition: "border-color 300ms, box-shadow 300ms",
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">
        Focus Timer
      </div>

      <div className="relative mx-auto mb-3" style={{ width: 84, height: 84 }}>
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r="38" fill="none" stroke="var(--border-default)" strokeWidth="3" opacity={0.4} />
          <circle cx="42" cy="42" r="38" fill="none" stroke="var(--accent-cyan)" strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} transform="rotate(-90 42 42)" style={{ transition: "stroke-dashoffset 1s linear" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-lg font-bold text-[var(--text-primary)] tabular-nums">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        {data.active ? (
          <button type="button" onClick={data.onPause} className="rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">Pause</button>
        ) : (
          <button type="button" onClick={data.onStart} className="rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--accent-cyan)] text-white hover:brightness-110 transition-all">{data.elapsed > 0 ? "Resume" : "Start"}</button>
        )}
        {data.elapsed > 0 && (
          <button type="button" onClick={data.onReset} className="rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">Reset</button>
        )}
      </div>

      {data.sessionsCompleted > 0 && (
        <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
          {data.sessionsCompleted} session{data.sessionsCompleted !== 1 ? "s" : ""} today
        </div>
      )}
    </div>
  );
});
