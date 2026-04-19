"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./spectra-v2.css";
import {
  TopRail,
  Minimap,
  CommandBar,
  Spotlight,
  Tray,
  ZoomControl,
  InfoPanel,
  type ViewMode,
  type ResultIsland,
} from "./chrome";
import { ItemCard } from "./items";
import {
  ArtifactWidget,
  FloatingWidget,
  ThreadWidget,
  WidgetBloom,
  WidgetChipRail,
  useTimerTick,
  type FloatingWidgetData,
  type WidgetKind,
} from "./widgets";
import { Icon } from "./icons";
import {
  buildV2Graph,
  KIND_META,
  QUICK_STARTS,
  TIERS,
  ZOOM_MAX,
  ZOOM_MIN,
  type V2Item,
  type V2Kind,
  type V2Territory,
} from "./data";
import {
  createCommandResult,
  createWorkspaceWidget,
  removeWorkspaceWidget,
  updateCommandResult,
  useWorkspaceData,
  useWorkspacePageData,
  updateWorkspaceWidget,
} from "@/hooks/use-workspace-data";
import {
  notifyWorkspaceContentMutated,
} from "@/lib/workspace/events";
import type {
  WorkspaceData,
  WorkspaceItemData,
} from "@/lib/workspace/contracts";

/* ─── FocusPaneContent — renders item body inside focused view pane ─── */
function FocusPaneContent({ item, onEdit }: { item: V2Item; onEdit?: (patch: { title?: string; body?: string }) => void }) {
  const [body, setBody] = useState(item.body ?? item.preview ?? "");
  useEffect(() => { setBody(item.body ?? item.preview ?? ""); }, [item.id, item.body, item.preview]);

  useEffect(() => {
    if (!item.sourceArtifactId) return;
    let cancelled = false;
    fetch(`/api/artifacts?artifactId=${item.sourceArtifactId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.artifact?.contentPlaintext || data.artifact?.content) setBody(data.artifact.contentPlaintext || data.artifact.content);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.sourceArtifactId]);

  if (item.kind === "thread") {
    const msgs = item.messages ?? [];
    return (
      <div className="space-y-2">
        {msgs.length === 0 && <div className="text-[12px] italic" style={{ color: "var(--ink-400)" }}>No messages yet.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] text-[12.5px] leading-[1.58] rounded-xl px-3 py-2 whitespace-pre-wrap ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
                 style={{ background: m.role === "user" ? "var(--accent)" : "var(--bg2)", color: m.role === "user" ? "#fff" : "var(--ink-200)", border: `1px solid ${m.role === "user" ? "transparent" : "var(--line)"}` }}>
              {m.text}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <textarea
      value={body}
      onChange={(e) => setBody(e.target.value)}
      onBlur={() => onEdit?.({ body })}
      placeholder="Start writing…"
      className="w-full bg-transparent outline-none resize-none text-[13.5px] leading-[1.72] font-display placeholder:text-[var(--ink-400)]"
      style={{ color: "var(--ink-200)", minHeight: "100%", height: "100%" }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/* ─── Demo data (fallback when backend returns no workspaces) ───────── */

const DEMO_WORKSPACES: WorkspaceData[] = [
  {
    id: "demo-bio",
    name: "Biology",
    emoji: "🧬",
    status: "active",
    itemCount: 5,
    lastActivity: Date.now() - 3_600_000,
    items: [
      { id: "b1", workspaceId: "demo-bio", title: "Glycolysis pathway", preview: "10 steps from glucose to pyruvate — ATP yields and regulation.", itemType: "note", status: "active", meta: "2h ago", updatedAt: Date.now() - 7_200_000 },
      { id: "b2", workspaceId: "demo-bio", title: "Midterm review flashcards", preview: "45 cards across cell bio, genetics, metabolism.", itemType: "flashcard_deck", status: "active", meta: "yesterday", updatedAt: Date.now() - 86_400_000 },
      { id: "b3", workspaceId: "demo-bio", title: "Krebs cycle diagram", preview: "Mermaid-style diagram of citric acid cycle intermediates.", itemType: "visual", status: "active", meta: "3d ago", updatedAt: Date.now() - 3 * 86_400_000 },
      { id: "b4", workspaceId: "demo-bio", title: "Practice problem set 3", preview: "Stoichiometry & enzyme kinetics — 12 problems.", itemType: "export", status: "active", meta: "1d ago", updatedAt: Date.now() - 86_400_000 },
      { id: "b5", workspaceId: "demo-bio", title: "Midterm · Thu 9am", preview: "Chapters 4-9. Proctored, closed notes.", itemType: "planner", status: "active", meta: "due Thu", updatedAt: Date.now() - 1_800_000 },
    ],
  },
  {
    id: "demo-eng",
    name: "English",
    emoji: "📖",
    status: "active",
    itemCount: 4,
    lastActivity: Date.now() - 2 * 3_600_000,
    items: [
      { id: "e1", workspaceId: "demo-eng", title: "Gatsby essay draft", preview: "Distance as unavailability — thesis strong, §3 transition weak.", itemType: "note", status: "active", meta: "1h ago", updatedAt: Date.now() - 3_600_000 },
      { id: "e2", workspaceId: "demo-eng", title: "Chapter 5 passage analysis", preview: "Reunion scene — close reading on restoration and artifice.", itemType: "export", status: "active", meta: "2d ago", updatedAt: Date.now() - 2 * 86_400_000 },
      { id: "e3", workspaceId: "demo-eng", title: "Counter-argument thread", preview: "Q: Is Nick a reliable narrator?", itemType: "thread", status: "active", meta: "4h ago", updatedAt: Date.now() - 4 * 3_600_000 },
      { id: "e4", workspaceId: "demo-eng", title: "Essay due · Fri", preview: "1500 words, MLA, one outside source.", itemType: "planner", status: "active", meta: "due Fri", updatedAt: Date.now() - 7_200_000 },
    ],
  },
  {
    id: "demo-calc",
    name: "Calculus",
    emoji: "∫",
    status: "active",
    itemCount: 4,
    lastActivity: Date.now() - 5 * 3_600_000,
    items: [
      { id: "c1", workspaceId: "demo-calc", title: "Pset 7 — IBP & trig sub", preview: "Problems 1–8. Stuck on Q4 (∫ arctan x dx).", itemType: "export", status: "active", meta: "5h ago", updatedAt: Date.now() - 5 * 3_600_000 },
      { id: "c2", workspaceId: "demo-calc", title: "Integration techniques notes", preview: "Substitution, IBP, partial fractions, trig subs.", itemType: "note", status: "active", meta: "today", updatedAt: Date.now() - 1_800_000 },
      { id: "c3", workspaceId: "demo-calc", title: "Weekly review flashcards", preview: "Limit laws, derivative rules, integration shortcuts.", itemType: "flashcard_deck", status: "active", meta: "2d ago", updatedAt: Date.now() - 2 * 86_400_000 },
      { id: "c4", workspaceId: "demo-calc", title: "Spanish subjunctive deck", preview: "20 cards — dudo que, es posible que, ojalá…", itemType: "flashcard_deck", status: "active", meta: "3d ago", updatedAt: Date.now() - 3 * 86_400_000 },
    ],
  },
];

const WORLD_SIZE = { w: 6000, h: 4400 };

export default function WorkspaceV2() {
  /* ─── Theme ─── */
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("spectra-v2:theme") : null;
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("spectra-v2:theme", theme);
  }, [theme]);

  /* ─── Viewport/camera ─── */
  const [zoom, setZoom] = useState<number>(TIERS.WORKSPACE);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  /* ─── Selection & focus ─── */
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<string[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);

  /* ─── Inspector (single-click opens artifact/thread) ─── */
  const [openInspectorId, setOpenInspectorId] = useState<string | null>(null);
  const [inspectorPos, setInspectorPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  /* ─── Focus set (double-click builds set; Space opens focused view) ─── */
  const [buildingFocusSet, setBuildingFocusSet] = useState(false);
  const [focusSetIds, setFocusSetIds] = useState<string[]>([]);
  const [primaryFocusId, setPrimaryFocusId] = useState<string | null>(null);
  const [focusedViewOpen, setFocusedViewOpen] = useState(false);
  const [focusViewPrimaryId, setFocusViewPrimaryId] = useState<string | null>(null);
  const [focusViewFocusIdx, setFocusViewFocusIdx] = useState(0);

  /* ─── Chrome panels ─── */
  const [spotOpen, setSpotOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "topic";
    const saved = localStorage.getItem("spectra-v2:viewMode");
    if (saved === "type" || saved === "topic" || saved === "timeline") return saved;
    return "topic";
  });
  const setViewMode = useCallback((m: ViewMode) => {
    setViewModeRaw(m);
    if (typeof window !== "undefined") localStorage.setItem("spectra-v2:viewMode", m);
  }, []);
  const [resultIsland, setResultIsland] = useState<ResultIsland>(null);

  /* ─── Widgets — positions from localStorage (loaded after mount to avoid SSR mismatch) ─── */
  const WIDGET_LS_KEY = "spectra-v2:widget-positions";
  const loadWidgetPositions = (): Record<string, { x: number; y: number; collapsed: boolean }> => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(WIDGET_LS_KEY);
      if (!raw) return {};
      const parsed: Record<string, { x?: number; y?: number; collapsed?: boolean }> = JSON.parse(raw);
      const result: Record<string, { x: number; y: number; collapsed: boolean }> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v?.x === "number" && typeof v?.y === "number") {
          result[k] = { x: v.x, y: v.y, collapsed: v.collapsed ?? false };
        }
      }
      return result;
    } catch { return {}; }
  };
  const saveWidgetPositions = (ws: FloatingWidgetData[]) => {
    if (typeof window === "undefined") return;
    try {
      const positions: Record<string, { x: number; y: number; collapsed: boolean }> = {};
      ws.forEach((w) => { positions[w.id] = { x: w.x, y: w.y, collapsed: w.collapsed ?? false }; });
      localStorage.setItem(WIDGET_LS_KEY, JSON.stringify(positions));
    } catch { /* ignore */ }
  };
  // Default positions: spread down the left edge, expanded
  const WIDGET_DEFAULTS: FloatingWidgetData[] = [
    { id: "w-timer",   kind: "timer",   x: 16, y: 72,  w: 288, h: 132, collapsed: false, state: { secs: 25 * 60, running: false, totalSecs: 25 * 60 } },
    { id: "w-planner", kind: "planner", x: 16, y: 224, w: 300, h: 278, collapsed: false, state: {} },
    { id: "w-today",   kind: "today",   x: 16, y: 522, w: 296, h: 230, collapsed: false, state: {} },
  ];
  // Init with plain defaults (no localStorage read here → avoids SSR hydration mismatch)
  const [widgets, setWidgets] = useState<FloatingWidgetData[]>(WIDGET_DEFAULTS);

  // After mount, load saved positions from localStorage
  useEffect(() => {
    const saved = loadWidgetPositions();
    if (Object.keys(saved).length > 0) {
      setWidgets((prev) => prev.map((w) => {
        const p = saved[w.id];
        return p ? { ...w, x: p.x, y: p.y, collapsed: p.collapsed } : w;
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [widgetsHidden, setWidgetsHidden] = useState(false);
  const [widgetStateRevision, setWidgetStateRevision] = useState(0);
  useTimerTick(widgets, (updater) => {
    setWidgets((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (current !== next) setWidgetStateRevision((revision) => revision + 1);
      return next;
    });
  });

  /* ─── AI glow ─── */
  const [aiTouched, setAiTouched] = useState<Record<string, { until: number; reason: string }>>({});
  const clearTouchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /* ─── Interaction state ─── */
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);

  /* ─── Widget deep-edit ─── */
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  /* ─── Bloomed items (legacy compat) ─── */
  const [, setBloomedIds] = useState<string[]>([]);

  /* ─── AI connector trails (spatial view only) ─── */
  const [trails, setTrails] = useState<Array<{ id: string; x1: number; y1: number; x2: number; y2: number; until: number }>>([]);
  const spawnTrail = useCallback((fromX: number, fromY: number, toWorldX: number, toWorldY: number) => {
    const id = `trail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setTrails((ts) => [...ts, { id, x1: fromX, y1: fromY, x2: toWorldX, y2: toWorldY, until: Date.now() + 900 }]);
    setTimeout(() => setTrails((ts) => ts.filter((t) => t.id !== id)), 950);
  }, []);

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<
    | { type: "pan"; sx: number; sy: number; px: number; py: number }
    | { type: "lasso"; wx0: number; wy0: number }
    | null
  >(null);

  /* ─── Viewport size tracking ─── */
  const [vpSize, setVpSize] = useState<{ w: number; h: number }>({
    w: typeof window !== "undefined" ? window.innerWidth : 1400,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  });
  useEffect(() => {
    const onR = () => setVpSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  /* ─── Preferences (best-effort) ─── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/preferences");
        if (!res.ok || cancelled) return;
        const j = await res.json();
        if (j?.viewMode && ["type", "topic", "timeline"].includes(j.viewMode)) {
          setViewMode(j.viewMode as ViewMode);
        }
        if (j?.theme === "dark" || j?.theme === "light") setTheme(j.theme);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ─── Committed workspace from camera center ─── */
  const [committedWorkspaceId, setCommittedWorkspaceId] = useState<string | null>(null);
  const { workspaces: live, isLive, refresh } = useWorkspaceData(committedWorkspaceId);
  const { widgets: liveWidgets } = useWorkspacePageData(committedWorkspaceId);

  useEffect(() => {
    if (!isLive || !committedWorkspaceId) return;
    if (liveWidgets.length === 0) return;
    setWidgets(liveWidgets.map((widget) => ({
      id: widget._id,
      kind: widget.kind as WidgetKind,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
      collapsed: widget.collapsed,
      state: widget.state ?? {},
    })));
  }, [isLive, committedWorkspaceId, liveWidgets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = committedWorkspaceId ? `spectra-v2:${committedWorkspaceId}:widgets-hidden` : "spectra-v2:widgets-hidden";
    const saved = window.localStorage.getItem(key);
    if (saved === "true" || saved === "false") {
      setWidgetsHidden(saved === "true");
    }
  }, [committedWorkspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = committedWorkspaceId ? `spectra-v2:${committedWorkspaceId}:widgets-hidden` : "spectra-v2:widgets-hidden";
    window.localStorage.setItem(key, String(widgetsHidden));
  }, [committedWorkspaceId, widgetsHidden]);

  const effectiveWorkspaces: WorkspaceData[] = useMemo(() => {
    return isLive && live.length > 0 ? live : DEMO_WORKSPACES;
  }, [isLive, live]);

  const graph = useMemo(() => buildV2Graph(effectiveWorkspaces), [effectiveWorkspaces]);
  const territories = graph.territories;
  const baseItems = graph.items;

  /* ─── Derive current territory from pan ─── */
  const currentTerritory = useMemo<V2Territory | null>(() => {
    const cx = -pan.x, cy = -pan.y;
    const hit = territories.find(
      (t) => cx >= t.cx - t.w / 2 && cx <= t.cx + t.w / 2 && cy >= t.cy - t.h / 2 && cy <= t.cy + t.h / 2,
    );
    return hit ?? null;
  }, [pan, territories]);

  useEffect(() => {
    const nextCommit = currentTerritory && zoom > 0.34 ? currentTerritory.sourceId : null;
    if (nextCommit !== committedWorkspaceId) setCommittedWorkspaceId(nextCommit);
  }, [currentTerritory, zoom, committedWorkspaceId]);

  /* ─── Topic grouping — keyword-based (no embeddings required) ─── */
  const computeTopicGroups = useCallback((items: V2Item[]): Record<string, V2Item[]> => {
    const STOP = new Set(["this","that","with","from","have","will","been","what","when","where","which","your","more","also","some","they","their","about","these","would","could","should","there","other","after","before","during","study","notes","review","flashcard","cards","deck","items","item"]);
    const wordItems: Record<string, string[]> = {};
    items.forEach((it) => {
      const text = (it.title + " " + (it.preview ?? "")).toLowerCase();
      const words = text.split(/\W+/).filter((w) => w.length > 4 && !STOP.has(w) && isNaN(Number(w)));
      const seen = new Set<string>();
      words.forEach((w) => {
        if (!seen.has(w)) { seen.add(w); (wordItems[w] = wordItems[w] ?? []).push(it.id); }
      });
    });
    const sorted = Object.entries(wordItems).filter(([, ids]) => ids.length >= 2).sort((a, b) => b[1].length - a[1].length);
    const assigned = new Set<string>();
    const groups: Record<string, V2Item[]> = {};
    for (const [word, itemIds] of sorted) {
      const unassigned = itemIds.filter((id) => !assigned.has(id));
      if (unassigned.length >= 2) {
        const label = word.charAt(0).toUpperCase() + word.slice(1);
        groups[label] = unassigned.map((id) => items.find((it) => it.id === id)).filter(Boolean) as V2Item[];
        unassigned.forEach((id) => assigned.add(id));
      }
    }
    // Remaining fall back to kind label
    items.forEach((it) => {
      if (!assigned.has(it.id)) {
        const label = KIND_META[it.kind]?.label ?? it.kind;
        (groups[label] = groups[label] ?? []).push(it);
      }
    });
    return groups;
  }, []);

  /* ─── View-mode reflow: produce positions keyed by item id ─── */
  const arranged = useMemo<Record<string, { x: number; y: number }> | null>(() => {
    const coords: Record<string, { x: number; y: number }> = {};
    for (const w of territories) {
      const wsItems = baseItems.filter((i) => i.workspaceId === w.id);
      const padLeft = w.cx - w.w / 2 + 80;
      const padTop = w.cy - w.h / 2 + 160;

      if (viewMode === "type") {
        const byKey: Record<string, V2Item[]> = {};
        wsItems.forEach((it) => { (byKey[it.kind] = byKey[it.kind] ?? []).push(it); });
        let y = padTop;
        Object.keys(byKey).forEach((k) => {
          const row = byKey[k];
          row.forEach((it, idx) => { coords[it.id] = { x: padLeft + (idx % 3) * 360, y: y + Math.floor(idx / 3) * 270 }; });
          y += Math.ceil(row.length / 3) * 270 + 60;
        });
      } else if (viewMode === "topic") {
        const groups = computeTopicGroups(wsItems);
        let y = padTop;
        Object.keys(groups).forEach((k) => {
          const row = groups[k];
          row.forEach((it, idx) => { coords[it.id] = { x: padLeft + (idx % 3) * 360, y: y + Math.floor(idx / 3) * 270 }; });
          y += Math.ceil(row.length / 3) * 270 + 60;
        });
      } else if (viewMode === "timeline") {
        const buckets: { label: string; until: number; items: V2Item[] }[] = [
          { label: "Today",      until: Date.now() - 86_400_000,     items: [] },
          { label: "Yesterday",  until: Date.now() - 2 * 86_400_000, items: [] },
          { label: "Last week",  until: Date.now() - 7 * 86_400_000, items: [] },
          { label: "Older",      until: 0,                            items: [] },
        ];
        wsItems.forEach((it) => {
          const ts = (it.meta?.updatedAt as number) ?? (0);
          const bucket = buckets.find((b) => ts > b.until) ?? buckets[buckets.length - 1];
          bucket.items.push(it);
        });
        // Sort within each bucket by date desc
        buckets.forEach((b) => b.items.sort((a, z) => ((z.meta?.updatedAt as number) ?? 0) - ((a.meta?.updatedAt as number) ?? 0)));
        let y = padTop;
        buckets.forEach((b) => {
          if (b.items.length === 0) return;
          b.items.forEach((it, idx) => { coords[it.id] = { x: padLeft + 80 + (idx % 3) * 360, y: y + Math.floor(idx / 3) * 270 }; });
          y += Math.ceil(b.items.length / 3) * 270 + 70;
        });
      }
    }
    return Object.keys(coords).length > 0 ? coords : null;
  }, [viewMode, territories, baseItems, computeTopicGroups]);

  const posOf = useCallback(
    (it: V2Item): { x: number; y: number } => {
      if (arranged && arranged[it.id]) return arranged[it.id];
      return { x: it.x, y: it.y };
    },
    [arranged],
  );

  /* ─── Mode per item (glance/touch) ─── */
  const modeFor = useCallback(
    (item: V2Item): "glance" | "touch" => {
      void item;
      if (zoom < 0.42) return "glance";
      return "touch";
    },
    [zoom],
  );

  /* ─── Smooth flyTo via rAF, cubic-ease (1 - (1-t)^3) over 520ms ─── */
  const flyTo = useCallback(
    (targetPan: { x: number; y: number }, targetZoom?: number) => {
      const start = { x: pan.x, y: pan.y, z: zoom };
      const end = { x: targetPan.x, y: targetPan.y, z: targetZoom ?? zoom };
      const dur = 520;
      const t0 = performance.now();
      const step = (t: number) => {
        const tt = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - tt, 3);
        setPan({ x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased });
        if (targetZoom != null) setZoom(start.z + (end.z - start.z) * eased);
        if (tt < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [pan, zoom],
  );

  /* ─── zoomAt: keep world point under cursor stable ─── */
  const zoomAt = useCallback(
    (mx: number, my: number, factor: number) => {
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.width / 2, cy = rect.height / 2;
      // World point currently under cursor must remain under cursor after zoom.
      const wx = (mx - cx) / zoom - pan.x;
      const wy = (my - cy) / zoom - pan.y;
      const newPanX = (mx - cx) / newZoom - wx;
      const newPanY = (my - cy) / newZoom - wy;
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    },
    [zoom, pan],
  );

  /* ─── Wheel: trackpad pan vs cmd/ctrl/shift zoom ─── */
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      let factor = Math.exp(-e.deltaY * 0.0055);
      // Alt-held zoom → snap the resulting zoom to tier boundaries.
      if (e.altKey) {
        const candidate = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
        const snapPoints = [TIERS.OUT, 0.42, TIERS.WORKSPACE, 0.70, TIERS.ITEM, TIERS.BLOOM];
        let nearest = snapPoints[0];
        let bestDelta = Math.abs(candidate - nearest);
        for (const s of snapPoints) {
          const d = Math.abs(candidate - s);
          if (d < bestDelta) { bestDelta = d; nearest = s; }
        }
        factor = nearest / zoom;
      }
      zoomAt(mx, my, factor);
    } else {
      setPan((p) => ({ x: p.x - e.deltaX / zoom, y: p.y - e.deltaY / zoom }));
    }
  };

  /* ─── Mouse drag: pan OR lasso ─── */
  const onMouseDown = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("[data-widget]")) return;
    if (el.closest("[data-bloom-editor]")) return;
    if (ctx) setCtx(null);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || spaceHeld))) {
      e.preventDefault();
      dragRef.current = { type: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      setPanning(true);
    } else if (e.button === 0 && (el === canvasRef.current || el.closest("[data-canvas-bg]"))) {
      // Close inspector on empty canvas click
      if (openInspectorId) {
        setOpenInspectorId(null);
        return;
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wx = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
      const wy = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;
      dragRef.current = { type: "lasso", wx0: wx, wy0: wy };
      setLasso({ x0: wx, y0: wy, x1: wx, y1: wy });
      if (!e.shiftKey) setSelection(new Set());
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.type === "pan") {
      setPan({ x: d.px + (e.clientX - d.sx) / zoom, y: d.py + (e.clientY - d.sy) / zoom });
    } else {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wx = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
      const wy = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;
      setLasso({ x0: d.wx0, y0: d.wy0, x1: wx, y1: wy });
    }
  };
  const onMouseUp = () => {
    const d = dragRef.current;
    if (d?.type === "lasso" && lasso) {
      const x0 = Math.min(lasso.x0, lasso.x1), x1 = Math.max(lasso.x0, lasso.x1);
      const y0 = Math.min(lasso.y0, lasso.y1), y1 = Math.max(lasso.y0, lasso.y1);
      const hits = baseItems.filter((it) => {
        const p = posOf(it);
        return p.x < x1 && p.x + it.w > x0 && p.y < y1 && p.y + it.h > y0;
      });
      if (hits.length > 0) {
        const s = new Set(selection);
        hits.forEach((h) => s.add(h.id));
        setSelection(s);
        if (hits.length > 1) setTrayOpen(true);
      }
    }
    dragRef.current = null;
    setLasso(null);
    setPanning(false);
  };

  /* ─── Navigation helpers ─── */
  const goToWorkspace = (terrId: string) => {
    // Do NOT force viewMode — keep the previous arrangement so items don't jump around
    const t = territories.find((x) => x.id === terrId);
    if (!t) return;
    setBloomedIds([]);
    flyTo({ x: -t.cx, y: -t.cy }, TIERS.WORKSPACE);
  };
  const goToAtlas = () => {
    setBloomedIds([]);
    flyTo({ x: 0, y: 0 }, TIERS.OUT);
  };
  const goToItem = useCallback((itemId: string, bloom = true) => {
    const it = baseItems.find((x) => x.id === itemId);
    if (!it) return;
    const p = posOf(it);
    flyTo({ x: -(p.x + it.w / 2), y: -(p.y + it.h / 2) }, TIERS.ITEM);
    if (bloom) setTimeout(() => setBloomedIds((bs) => (bs.includes(it.id) ? bs : [...bs, it.id].slice(-3))), 440);
  }, [baseItems, posOf, flyTo]);

  /* ─── Focused item (nearest to camera center) ─── */
  const focusedItem = useMemo<V2Item | null>(() => {
    if (zoom < 0.48) return null;
    if (focusedViewOpen) return null;
    const cx = -pan.x, cy = -pan.y;
    // Search ALL items, not just current territory
    let best: V2Item | null = null;
    let bd = Infinity;
    const maxDist = 300 / zoom;
    baseItems.forEach((it) => {
      const p = posOf(it);
      const ix = p.x + it.w / 2, iy = p.y + it.h / 2;
      const d = Math.hypot(ix - cx, iy - cy);
      if (d < bd && d < maxDist) { best = it; bd = d; }
    });
    return best;
  }, [pan, zoom, posOf, baseItems, focusedViewOpen]);

  const cycleFocus = (dir: 1 | -1) => {
    // Cycle through ALL items
    if (baseItems.length === 0) return;
    let idx = focusedItem ? baseItems.findIndex((i) => i.id === focusedItem.id) : -1;
    idx = (idx + dir + baseItems.length) % baseItems.length;
    const it = baseItems[idx];
    const p = posOf(it);
    flyTo({ x: -(p.x + it.w / 2), y: -(p.y + it.h / 2) }, Math.max(zoom, TIERS.ITEM));
  };

  /* ─── AI glow ─── */
  const touchAI = useCallback((ids: string[], reason: string, ms = 4200) => {
    if (ids.length === 0) return;
    setAiTouched((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = { reason, until: Date.now() + ms }; });
      return next;
    });
    ids.forEach((id) => {
      const prior = clearTouchTimers.current[id];
      if (prior) clearTimeout(prior);
      clearTouchTimers.current[id] = setTimeout(() => {
        setAiTouched((prev) => { const n = { ...prev }; delete n[id]; return n; });
      }, ms);
    });
  }, []);

  /* ─── Item interactions ─── */
  const onItemClick = (item: V2Item, e: React.MouseEvent) => {
    e.stopPropagation();
    // Shift-click: immediate multi-select (Tray)
    if (e.shiftKey) {
      if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      const s = new Set(selection);
      if (s.has(item.id)) s.delete(item.id); else s.add(item.id);
      setSelection(s);
      if (s.size > 1) setTrayOpen(true);
      return;
    }
    // If building focus set: toggle item in/out of set (no delay needed)
    if (buildingFocusSet) {
      if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      setFocusSetIds((prev) => {
        if (prev.includes(item.id)) return prev.filter((id) => id !== item.id);
        return [...prev, item.id];
      });
      return;
    }
    // Normal single click: open inspector + fly camera
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      // Set inspector position near item but on right side of screen
      const vpW = typeof window !== "undefined" ? window.innerWidth : 1400;
      setInspectorPos({ x: Math.min(vpW - 420, vpW - 440), y: 90 });
      setOpenInspectorId(item.id);
      const p = posOf(item);
      flyTo({ x: -(p.x + item.w / 2), y: -(p.y + item.h / 2) }, Math.max(zoom, TIERS.ITEM));
    }, 220);
  };

  /* Double click → start building focus set with this item as primary */
  const onItemDoubleClick = (item: V2Item) => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    setBuildingFocusSet(true);
    setPrimaryFocusId(item.id);
    setFocusSetIds([item.id]);
    setOpenInspectorId(null); // close inspector if open
  };

  const onPinItem = (item: V2Item) => {
    if (!pinned.includes(item.id)) setPinned((p) => [...p, item.id]);
    setTrayOpen(true);
  };

  /* ─── Backend item creation ─── */
  const createItemAction = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!isLive) return { ok: false as const };
      try {
        const res = await fetch("/api/workspace-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return { ok: false as const };
        const j = await res.json();
        notifyWorkspaceContentMutated({
          workstreamId: (payload.workstreamId as string) ?? undefined,
          refreshHub: true,
        });
        refresh();
        return { ok: true as const, data: j };
      } catch {
        return { ok: false as const };
      }
    },
    [isLive, refresh],
  );

  /* ─── Backend item update ─── */
  const handleItemEdit = useCallback(async (item: V2Item, patch: Partial<V2Item>) => {
    if (!isLive) return;
    
    if (patch.messages && item.sourceChatId) {
      const userMsg = patch.messages[patch.messages.length - 1];
      if (userMsg?.role === "user") {
        try {
          const quick = await fetch("/api/workspace-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "executeQuickAction",
              workstreamId: committedWorkspaceId,
              targetChatId: item.sourceChatId,
              prompt: userMsg.text,
              quickAction: "create_thread",
              title: item.title,
              metadata: { source: "focused-thread-surface", sourceWorkspaceItemId: item.sourceId },
            }),
          });
          if (quick.ok) refresh();
        } catch {}
      }
      return;
    }

    if (patch.body !== undefined) {
      if (item.sourceArtifactId) {
        try {
          await fetch("/api/artifacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", artifactId: item.sourceArtifactId, content: patch.body, contentPlaintext: patch.body, title: patch.title ?? item.title }),
          });
          refresh();
        } catch {}
      } else if (item.sourcePlannerItemId) {
        try {
          await fetch("/api/planner-items", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plannerItemId: item.sourcePlannerItemId, description: patch.body, title: patch.title ?? item.title }),
          });
          refresh();
        } catch {}
      }
    }
  }, [isLive, refresh]);

  /* ─── Result island auto-dismiss ─── */
  const scheduleIslandDismiss = useCallback((island: ResultIsland, ms = 8000) => {
    setResultIsland(island);
    if (!island) return;
    setTimeout(() => {
      // Only dismiss if no longer in a "working" state
      setResultIsland((r) => {
        if (!r) return null;
        if (r.status === "streaming" || r.status === "running" || r.status === "pending") return r;
        return null;
      });
    }, ms);
  }, []);

  /* ─── Create item at world-coords (for right-click + trails) ─── */
  const createHereByKind = useCallback(
    async (kind: "note" | "task" | "thread" | "visual" | "code", worldX: number, worldY: number) => {
      const wsId = committedWorkspaceId;
      if (!wsId) {
        scheduleIslandDismiss({ status: "error", text: "Zoom into a workspace first.", chips: ["No workspace"] });
        return;
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = rect.width / 2 + (worldX + pan.x) * zoom;
        const screenY = rect.height / 2 + (worldY + pan.y) * zoom;
        const startX = rect.width / 2;
        const startY = rect.height - 56;
        spawnTrail(startX, startY, screenX, screenY);
      }
      if (isLive) {
        const base = { workstreamId: wsId, canvasX: worldX, canvasY: worldY };
        const actions: Record<string, Record<string, unknown>> = {
          note: { action: "createNote", title: "Untitled note", content: "", ...base },
          task: { action: "createPlannerItem", title: "New task", type: "deadline", priority: "medium", ...base },
          thread: { action: "createThread", title: "New thread", ...base },
          visual: { action: "createArtifact", type: "visualization", title: "Untitled visual", content: "<svg></svg>", ...base },
          code: { action: "createArtifact", type: "code_project", title: "Untitled code", content: "// Start\n", ...base },
        };
        const r = await createItemAction(actions[kind]);
        let action;
        if (r.ok) {
           const id = r.data?.artifactId || r.data?.plannerItemId || r.data?.chatId;
           if (id) {
             action = { label: `Open ${kind}`, onClick: () => setPendingOpenSourceId(id) };
           }
        }
        scheduleIslandDismiss({
          status: r.ok ? "done" : "error",
          text: r.ok ? `Created ${kind} here.` : `Could not create ${kind}.`,
          chips: action ? undefined : [kind],
          action
        });
      } else {
        scheduleIslandDismiss({ status: "done", text: `(demo) Created ${kind} here.`, chips: [kind] });
      }
    },
    [committedWorkspaceId, isLive, createItemAction, scheduleIslandDismiss, pan, zoom, spawnTrail],
  );

  /* ─── Reveal animation state (singleton enforcement pulse) ─── */
  const [revealingWidgetId, setRevealingWidgetId] = useState<string | null>(null);

  /* ─── Widgets ─── */
  const addWidget = useCallback((kind: string, position?: { x: number; y: number }) => {
    // Singleton enforcement: if a widget of this kind already exists, reveal it instead.
    setWidgets((ws) => {
      const existing = ws.find((w) => w.kind === kind);
      if (existing) {
        // Ensure it's expanded and pulse-highlight it.
        setRevealingWidgetId(existing.id);
        setTimeout(() => setRevealingWidgetId(null), 1100);
        if (isLive) void updateWorkspaceWidget({ widgetId: existing.id, collapsed: false });
        return ws.map((w) => w.id === existing.id ? { ...w, collapsed: false } : w);
      }

      const id = `w-${Date.now()}`;
      const sizes: Record<string, { w: number; h: number }> = {
        timer: { w: 288, h: 132 }, planner: { w: 300, h: 278 }, today: { w: 296, h: 230 },
        scratch: { w: 304, h: 232 }, calendar: { w: 312, h: 270 }, library: { w: 308, h: 276 },
        thread: { w: 340, h: 320 }, artifact: { w: 380, h: 300 }
      };
      const size = sizes[kind] ?? { w: 288, h: 200 };
      const widget: FloatingWidgetData = {
        id,
        kind: (kind as WidgetKind),
        x: position?.x ?? 96,
        y: position?.y ?? 96,
        ...size,
        collapsed: true, // new widgets start as chips
        state: kind === "timer" ? { secs: 25 * 60, running: false } : {},
      };
      if (isLive) {
        void createWorkspaceWidget({
          workstreamId: committedWorkspaceId ?? undefined,
          kind,
          title: kind,
          x: widget.x,
          y: widget.y,
          w: widget.w,
          h: widget.h,
          state: widget.state,
        }).then((result) => {
          if (result) refresh();
        });
      }
      return [...ws, widget];
    });
    if (widgetsHidden) setWidgetsHidden(false);
  }, [isLive, committedWorkspaceId, refresh, widgetsHidden]);

  /* ─── Quick-start scaffold (multi-widget + seeded tasks) ─── */
  const runQuickStartScaffold = useCallback(
    (title: string) => {
      const lc = title.toLowerCase();
      const chips: string[] = [];
      const actions: string[] = [];

      const seed = (kinds: WidgetKind[]) => {
        kinds.forEach((k, i) => {
          addWidget(k, { x: 96 + i * 20, y: 96 + i * 24 });
          actions.push(k);
        });
        if (widgetsHidden) setWidgetsHidden(false);
      };

      if (lc.includes("exam") || lc.includes("plan")) {
        seed(["planner", "today", "timer"]);
        chips.push("exam plan");
      } else if (lc.includes("cram")) {
        seed(["timer", "today", "scratch"]);
        chips.push("cram");
      } else if (lc.includes("essay")) {
        seed(["scratch", "timer"]);
        chips.push("essay");
      } else if (lc.includes("holiday") || lc.includes("break")) {
        seed(["calendar", "planner"]);
        chips.push("break");
      } else if (lc.includes("research")) {
        seed(["library", "scratch", "planner"]);
        chips.push("research");
      } else {
        seed(["today", "timer"]);
      }

      if (isLive && committedWorkspaceId) {
        void createItemAction({
          action: "createPlannerItem",
          workstreamId: committedWorkspaceId,
          title: `${title} — step 1`,
          type: "deadline",
          priority: "medium",
        });
        void createItemAction({
          action: "createPlannerItem",
          workstreamId: committedWorkspaceId,
          title: `${title} — step 2`,
          type: "deadline",
          priority: "medium",
        });
      }

      scheduleIslandDismiss({
        status: "done",
        text: `Scaffold ready: ${actions.join(" · ")}. Edit the widgets to fit your week.`,
        chips: ["Scaffold", ...chips],
      });
    },
    [widgetsHidden, isLive, committedWorkspaceId, createItemAction, scheduleIslandDismiss, addWidget],
  );

  /* ─── Command bar routing ─── */
  const handleSendMessage = useCallback(
    async (text: string) => {
      const raw = text.trim();
      if (!raw) return;
      // If the text matches a known quick-start title, run the scaffold instead of chat.
      const qsMatch = QUICK_STARTS.find((q) => q.title === raw);
      if (qsMatch) {
        runQuickStartScaffold(qsMatch.title);
        return;
      }
      const lc = raw.toLowerCase();
      const wsId = committedWorkspaceId;

      const requiresWorkspace = () => {
        if (!wsId) {
          scheduleIslandDismiss({
            status: "error",
            text: "Open a workspace first — zoom into one of the territories, then try again.",
            chips: ["No workspace"],
          });
          return false;
        }
        return true;
      };

      // Helper — spawn a trail from command bar center to viewport center (approximate landing).
      const spawnCenterTrail = () => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        spawnTrail(rect.width / 2, rect.height - 56, rect.width / 2, rect.height / 2);
      };

      // /note, /task, /thread, /workspace, /widget
      if (raw.startsWith("/note ")) {
        if (!requiresWorkspace()) return;
        const title = raw.slice(6).trim() || "Untitled note";
        if (isLive) {
          // Show pending → running → done sequence honestly
          scheduleIslandDismiss({ status: "pending", text: "Queued…" }, 60000);
          await new Promise((r) => setTimeout(r, 150));
          setResultIsland({ status: "running", text: `Creating note "${title}"…` });
          const r = await createItemAction({ action: "createNote", workstreamId: wsId, title, content: "" });
          if (r.ok) {
             spawnCenterTrail();
          }
          scheduleIslandDismiss({
            status: r.ok ? "done" : "error",
            text: r.ok ? `Created note "${title}".` : "Could not create note.",
            action: r.data?.artifactId ? { label: "Open Note", onClick: () => setPendingOpenSourceId(r.data.artifactId) } : undefined
          });
        } else {
          // Demo: still show the sequence so the UI is honest
          scheduleIslandDismiss({ status: "pending", text: "Queued…" }, 60000);
          await new Promise((r) => setTimeout(r, 150));
          setResultIsland({ status: "running", text: `Creating note "${title}"…` });
          await new Promise((r) => setTimeout(r, 400));
          spawnCenterTrail();
          scheduleIslandDismiss({ status: "done", text: `(demo) Created note "${title}".`, chips: ["Note"] });
        }
        return;
      }
      if (raw.startsWith("/task ")) {
        if (!requiresWorkspace()) return;
        const title = raw.slice(6).trim() || "Untitled task";
        if (isLive) {
          const r = await createItemAction({ action: "createPlannerItem", workstreamId: wsId, title, type: "deadline", priority: "medium" });
          if (r.ok) {
             spawnCenterTrail();
          }
          scheduleIslandDismiss({ 
            status: r.ok ? "done" : "error", 
            text: r.ok ? `Added planner task "${title}".` : "Could not add task.", 
            action: r.data?.plannerItemId ? { label: "Open Task", onClick: () => setPendingOpenSourceId(r.data.plannerItemId) } : undefined
          });
        } else {
          spawnCenterTrail();
          scheduleIslandDismiss({ status: "done", text: `(demo) Added planner task "${title}".`, chips: ["Task"] });
        }
        return;
      }
      if (raw.startsWith("/thread ")) {
        if (!requiresWorkspace()) return;
        const title = raw.slice(8).trim() || "New thread";
        if (isLive) {
          const r = await createItemAction({ action: "createThread", workstreamId: wsId, title });
          if (r.ok) {
             spawnCenterTrail();
          }
          scheduleIslandDismiss({ 
            status: r.ok ? "done" : "error", 
            text: r.ok ? `Started thread "${title}".` : "Could not start thread.", 
            action: r.data?.chatId ? { label: "Open Thread", onClick: () => setPendingOpenSourceId(r.data.chatId) } : undefined
          });
        } else {
          spawnCenterTrail();
          scheduleIslandDismiss({ status: "done", text: `(demo) Started thread "${title}".`, chips: ["Thread"] });
        }
        return;
      }
      if (raw.startsWith("/workspace ")) {
        const title = raw.slice(11).trim() || "New workspace";
        if (isLive) {
          const r = await createItemAction({ action: "createWorkspace", title });
          scheduleIslandDismiss({ status: r.ok ? "done" : "error", text: r.ok ? `Created workspace "${title}".` : "Could not create workspace.", chips: ["Workspace"] });
        } else {
          scheduleIslandDismiss({ status: "done", text: `(demo) Created workspace "${title}".`, chips: ["Workspace"] });
        }
        return;
      }
      if (raw.startsWith("/widget ")) {
        addWidget("scratch");
        scheduleIslandDismiss({ status: "done", text: `Added scratchpad widget.`, chips: ["Widget"] });
        return;
      }

      // ?query / search …
      if (raw.startsWith("?") || lc.startsWith("search ")) {
        const q = raw.startsWith("?") ? raw.slice(1).trim() : raw.slice(7).trim();
        if (!requiresWorkspace()) return;
        scheduleIslandDismiss({ status: "streaming", text: `Searching for "${q}"…`, chips: ["Search"] });
        if (isLive && wsId) {
          const cr = await createCommandResult({ workstreamId: wsId, intent: "result", status: "processing", title: `Search: ${q}`, summary: "Searching…" });
          try {
            const res = await fetch("/api/workspace-data", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "search", workstreamId: wsId, query: q, limit: 8 }),
            });
            const j = res.ok ? await res.json() : null;
            const hits = (j?.results ?? []) as Array<{ title: string }>;
            const summary = hits.length > 0 ? `${hits.length} results found.` : "No matches.";
            if (cr) await updateCommandResult({ resultId: cr.resultId, status: "completed", summary });
            scheduleIslandDismiss({ status: "done", text: summary, chips: hits.slice(0, 3).map((h) => h.title) });
          } catch {
            scheduleIslandDismiss({ status: "error", text: "Search failed.", chips: ["Error"] });
          }
        } else {
          const hits = baseItems.filter((i) => i.title.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
          touchAI(hits.map((h) => h.id), `search ${q}`);
          scheduleIslandDismiss({ status: "done", text: hits.length ? `${hits.length} matches across the canvas.` : "No matches.", chips: hits.slice(0, 3).map((h) => h.title) });
        }
        return;
      }

      // Default → persisted workspace quick action / linked result.
      let touched: string[] = [];
      let stub: ResultIsland = null;
      let inferredAction: "summarize" | "make_flashcards" | "plan_week" | "create_note" | "create_task" | "create_thread" | "artifact_request" | undefined;
      if (selection.size > 1) {
        touched = Array.from(selection);
        stub = { status: "done", text: `Asked about ${selection.size} items.`, chips: [`${selection.size} items`] };
        inferredAction = "summarize";
      } else if (focusedItem?.kind === "essay") {
        touched = [focusedItem.id];
        stub = { status: "done", text: "Your thesis reads strong. The weakest transition is ¶3→¶4 — I've drafted a bridge sentence.", chips: ["Suggestion"] };
        inferredAction = "artifact_request";
      } else if (focusedItem?.kind === "pset") {
        touched = [focusedItem.id];
        stub = { status: "done", text: "Hint inserted at the current stuck problem. Try IBP with u=arctan(x), then a trig substitution.", chips: ["Hint"] };
        inferredAction = "summarize";
      } else if (focusedItem?.kind === "flashcards") {
        touched = [focusedItem.id];
        stub = { status: "done", text: "Review queued — 10 cards, weakest first.", chips: ["Review"] };
        inferredAction = "make_flashcards";
      } else if (focusedItem?.kind === "note") {
        touched = [focusedItem.id];
        stub = { status: "done", text: "Condensed into 3 lines and extracted 6 flashcard-ready terms at the bottom.", chips: ["Note updated"] };
        inferredAction = "artifact_request";
      } else if (lc.includes("plan") && (lc.includes("week") || lc.includes("exam"))) {
        touched = territories.flatMap((t) => baseItems.filter((i) => i.workspaceId === t.id).slice(0, 1).map((i) => i.id));
        stub = { status: "done", text: "This week: Biology midterm Thu, Calc pset Fri, essay Mon. Scheduled 6×50-min focus blocks with a 2-day taper.", chips: ["Plan drafted"] };
        inferredAction = "plan_week";
      } else if (/thread|chat|discuss/.test(lc)) {
        inferredAction = "create_thread";
        stub = { status: "done", text: `Started a linked thread for "${raw}".`, chips: ["Thread"] };
      } else if (/task|todo|deadline|remind/.test(lc)) {
        inferredAction = "create_task";
        stub = { status: "done", text: `Captured a planner task for "${raw}".`, chips: ["Task"] };
      } else if (/note|write down|capture/.test(lc)) {
        inferredAction = "create_note";
        stub = { status: "done", text: `Saved a note for "${raw}".`, chips: ["Note"] };
      } else {
        inferredAction = "summarize";
        stub = { status: "done", text: `Working on: "${raw}". I've surfaced the most relevant items for you.`, chips: ["AI"] };
      }

      if (isLive && wsId) {
        scheduleIslandDismiss({ status: "streaming", text: "Thinking…", chips: [] });
        try {
          const res = await fetch("/api/workspace-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "executeQuickAction",
              workstreamId: wsId,
              prompt: raw,
              quickAction: inferredAction,
              targetArtifactId: focusedItem?.sourceArtifactId,
              targetPlannerItemId: focusedItem?.sourcePlannerItemId,
              targetChatId: focusedItem?.sourceChatId,
              title: focusedItem ? `${focusedItem.title} · ${raw.slice(0, 48)}` : raw.slice(0, 72),
              content: focusedItem?.preview,
              metadata: {
                source: "workspace-v2-quick-chat",
                focusedItemId: focusedItem?.sourceId,
                selectedItemIds: Array.from(selection),
              },
            }),
          });
          if (res.ok) {
            const j = await res.json();
            refresh();
            scheduleIslandDismiss({
              status: "done",
              text: stub?.text ?? "Saved workspace action.",
              chips: j?.targetKind ? [j.targetKind] : stub?.chips,
              action: j?.targetId ? { label: "Open result", onClick: () => setPendingOpenSourceId(j.targetId) } : undefined,
            });
          } else {
            scheduleIslandDismiss(stub);
          }
        } catch {
          scheduleIslandDismiss(stub);
        }
      } else {
        setResultIsland({ ...stub, status: "streaming" } as ResultIsland);
        setTimeout(() => scheduleIslandDismiss(stub), 500);
      }
      if (touched.length) touchAI(touched, raw);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [committedWorkspaceId, isLive, createItemAction, scheduleIslandDismiss, baseItems, focusedItem, selection, territories, touchAI, runQuickStartScaffold, spawnTrail],
  );

  /* ─── Tray actions ─── */
  const onTrayAction = (action: "ask" | "focus") => {
    const ids = Array.from(selection);
    const n = ids.length;
    if (action === "focus") {
      // Open focused view with selected items
      setFocusSetIds(ids);
      setPrimaryFocusId(ids[0] ?? null);
      setFocusViewPrimaryId(ids[0] ?? null);
      setFocusViewFocusIdx(0);
      setBuildingFocusSet(false);
      setFocusedViewOpen(true);
      return;
    }
    touchAI(ids, action);
    const text = `Asked about ${n} items. Pulled common threads.`;
    scheduleIslandDismiss({ status: "done", text, chips: [`${n} items`] });
    setSelection(new Set());
    setTrayOpen(false);
  };

  /* ─── Spotlight picks ─── */
  const onSpotlightPick = (
    sel:
      | { type: "workspace"; id: string }
      | { type: "item"; id: string }
      | { type: "ai"; query: string }
      | { type: "view"; mode: ViewMode }
      | { type: "quick"; title: string },
  ) => {
    if (sel.type === "workspace") goToWorkspace(sel.id);
    else if (sel.type === "item") goToItem(sel.id, true);
    else if (sel.type === "ai") handleSendMessage(sel.query);
    else if (sel.type === "view") setViewMode(sel.mode);
    else if (sel.type === "quick") runQuickStartScaffold(sel.title);
  };

  /* ─── Widget Handlers ─── */
  const moveWidget = (id: string, x: number, y: number) =>
    setWidgets((ws) => {
      const next = ws.map((w) => (w.id === id ? { ...w, x, y } : w));
      if (isLive) {
        void updateWorkspaceWidget({ widgetId: id, x, y });
      }
      saveWidgetPositions(next);
      return next;
    });
  const closeWidget = (id: string) => {
    setWidgets((ws) => ws.filter((w) => w.id !== id));
    if (isLive) {
      void removeWorkspaceWidget(id);
    }
  };
  const toggleWidgetCollapsed = (id: string) =>
    setWidgets((ws) => {
      const next = ws.map((w) => {
        if (w.id !== id) return w;
        return { ...w, collapsed: !w.collapsed };
      });
      const w = next.find((w) => w.id === id);
      if (w && isLive) {
        void updateWorkspaceWidget({ widgetId: id, collapsed: w.collapsed });
      }
      saveWidgetPositions(next);
      return next;
    });

  const expandWidget = useCallback((id: string) => {
    setWidgets((ws) => {
      const next = ws.map((w) => {
        if (w.id !== id) return w;
        if (w.collapsed === false) return w;
        return { ...w, collapsed: false };
      });
      if (isLive) void updateWorkspaceWidget({ widgetId: id, collapsed: false });
      saveWidgetPositions(next);
      return next;
    });
  }, [isLive]);

  const collapseAllWidgets = useCallback(() => {
    setWidgets((ws) => {
      const next = ws.map((w) => {
        if (w.collapsed) return w;
        return { ...w, collapsed: true };
      });
      next.forEach((w) => { if (isLive) void updateWorkspaceWidget({ widgetId: w.id, collapsed: true }); });
      saveWidgetPositions(next);
      return next;
    });
  }, [isLive]);

  const expandAllWidgets = useCallback(() => {
    setWidgets((ws) => {
      const next = ws.map((w) => {
        if (!w.collapsed) return w;
        return { ...w, collapsed: false };
      });
      next.forEach((w) => { if (isLive) void updateWorkspaceWidget({ widgetId: w.id, collapsed: false }); });
      saveWidgetPositions(next);
      return next;
    });
  }, [isLive]);
  const toggleTimer = useCallback((id: string) =>
    setWidgets((ws) => ws.map((w) => {
      if (w.id !== id) return w;
      const next = { ...w, state: { ...w.state, running: !(w.state.running as boolean) } };
      if (isLive) {
        void updateWorkspaceWidget({ widgetId: id, state: next.state });
      }
      return next;
    })), [isLive]);
  const resetTimer = useCallback((id: string, secs: number) =>
    setWidgets((ws) => ws.map((w) => {
      if (w.id !== id) return w;
      const next = { ...w, state: { ...w.state, secs, running: false } };
      if (isLive) {
        void updateWorkspaceWidget({ widgetId: id, state: next.state });
      }
      return next;
    })), [isLive]);
  const updateWidgetState = (id: string, stateUpdate: Record<string, unknown>) =>
    setWidgets((ws) => ws.map((w) => {
      if (w.id !== id) return w;
      const next = { ...w, state: { ...w.state, ...stateUpdate } };
      if (isLive) {
        void updateWorkspaceWidget({ widgetId: id, state: next.state });
      }
      return next;
    }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const active = widgets.find((widget) => widget.kind === "timer" && !widget.collapsed);
    if (!active) return;
    const secs = Number(active.state.secs ?? 25 * 60);
    const running = Boolean(active.state.running);
    const total = Math.max(1, Number(active.state.totalSecs ?? 25 * 60));
    const progress = Math.max(0, Math.min(1, 1 - secs / total));
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    window.dispatchEvent(new CustomEvent("ai-school:timer-state", {
      detail: {
        display: `${mm}:${ss}`,
        isRunning: running,
        progress,
        phase: "work",
      },
    }));
  }, [widgets, widgetStateRevision]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStart = () => {
      const timer = widgets.find((widget) => widget.kind === "timer");
      if (!timer || Boolean(timer.state.running)) return;
      toggleTimer(timer.id);
    };
    const handlePause = () => {
      const timer = widgets.find((widget) => widget.kind === "timer" && Boolean(widget.state.running));
      if (!timer) return;
      toggleTimer(timer.id);
    };
    const handleReset = () => {
      const timer = widgets.find((widget) => widget.kind === "timer");
      if (!timer) return;
      resetTimer(timer.id, Number(timer.state.totalSecs ?? 25 * 60));
    };
    window.addEventListener("ai-school:timer-start", handleStart);
    window.addEventListener("ai-school:timer-pause", handlePause);
    window.addEventListener("ai-school:timer-reset", handleReset);
    return () => {
      window.removeEventListener("ai-school:timer-start", handleStart);
      window.removeEventListener("ai-school:timer-pause", handlePause);
      window.removeEventListener("ai-school:timer-reset", handleReset);
    };
  }, [widgets, resetTimer, toggleTimer]);

  /* ─── Keyboard (global) ─── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      // Keyboard guard: never steal keys from editable surfaces.
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) {
        if (e.key === "Escape") (tgt as HTMLElement).blur();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSpotOpen(true); return; }
      if (e.key === " ") {
        // Skip if focus is in a text field
        const tag = (e.target as HTMLElement)?.tagName;
        const isEditable = (e.target as HTMLElement)?.isContentEditable;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || isEditable) return;
        e.preventDefault();
        if (e.repeat) { setSpaceHeld(true); return; }
        // Space: open/close focused view
        if (focusedViewOpen) {
          // Already in focused view — close it
          setFocusedViewOpen(false);
          setBuildingFocusSet(false);
          setFocusSetIds([]);
          setPrimaryFocusId(null);
          setFocusViewPrimaryId(null);
        } else if (buildingFocusSet && focusSetIds.length > 0) {
          // Open focused view with the current set
          setFocusViewPrimaryId(primaryFocusId ?? focusSetIds[0]);
          setFocusViewFocusIdx(0);
          setFocusedViewOpen(true);
        } else if (selection.size > 0) {
          // Tray selection → open focused view with tray items
          const ids = Array.from(selection);
          setFocusSetIds(ids);
          setPrimaryFocusId(ids[0]);
          setFocusViewPrimaryId(ids[0]);
          setFocusViewFocusIdx(0);
          setBuildingFocusSet(false);
          setFocusedViewOpen(true);
        } else if (focusedItem) {
          // Quick-focus: 1-item focused view
          setFocusSetIds([focusedItem.id]);
          setPrimaryFocusId(focusedItem.id);
          setFocusViewPrimaryId(focusedItem.id);
          setFocusViewFocusIdx(0);
          setFocusedViewOpen(true);
        }
      }
      if (e.key === "Tab") {
        if (focusedViewOpen && focusSetIds.length > 0) {
          e.preventDefault();
          setFocusViewFocusIdx((i) => {
            const n = focusSetIds.length;
            return ((i + (e.shiftKey ? -1 : 1)) + n) % n;
          });
        } else {
          e.preventDefault();
          cycleFocus(e.shiftKey ? -1 : 1);
        }
      }
      if (e.key === "Escape") {
        if (focusedViewOpen) {
          setFocusedViewOpen(false);
          setBuildingFocusSet(false);
          setFocusSetIds([]);
          setPrimaryFocusId(null);
          setFocusViewPrimaryId(null);
        } else if (buildingFocusSet) {
          setBuildingFocusSet(false);
          setFocusSetIds([]);
          setPrimaryFocusId(null);
        } else if (openInspectorId) {
          setOpenInspectorId(null);
        } else if (ctx) setCtx(null);
        else if (editingWidgetId) setEditingWidgetId(null);
        else if (spotOpen) setSpotOpen(false);
        else if (infoOpen) setInfoOpen(false);
        else if (selection.size > 0) { setSelection(new Set()); setTrayOpen(false); }
        else if (trayOpen) setTrayOpen(false);
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect && (e.key === "=" || e.key === "+")) zoomAt(rect.width / 2, rect.height / 2, 1.08);
      if (rect && (e.key === "-" || e.key === "_")) zoomAt(rect.width / 2, rect.height / 2, 0.92);
      if (e.key === "0") goToAtlas();
      if (e.key === "1") setViewMode("topic");
      if (e.key === "2") setViewMode("type");
      if (e.key === "3") setViewMode("timeline");
      if (e.key.toLowerCase() === "w") setWidgetsHidden((h) => !h);
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === " ") setSpaceHeld(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedItem, focusedViewOpen, buildingFocusSet, focusSetIds, primaryFocusId, openInspectorId, spotOpen, selection, trayOpen, ctx, infoOpen, zoomAt]);

  /* ─── External event bridges (preserve legacy app contract) ─── */
  useEffect(() => {
    const onOpenItem = (e: Event) => {
      const ce = e as CustomEvent<{ itemId?: string }>;
      const id = ce.detail?.itemId;
      if (!id) return;
      // Match either v2 id or source id
      const hit = baseItems.find((i) => i.id === id || i.sourceId === id);
      if (hit) goToItem(hit.id, true);
    };
    const onContextAction = (e: Event) => {
      const ce = e as CustomEvent<{ action?: string; flowX?: number; flowY?: number }>;
      const action = ce.detail?.action;
      if (!action) return;
      // Translate world-ish coords if provided; otherwise use camera center.
      const worldX = ce.detail?.flowX ?? -pan.x;
      const worldY = ce.detail?.flowY ?? -pan.y;
      const map: Record<string, "note" | "task" | "thread" | "visual" | "code"> = {
        note: "note", task: "task", thread: "thread", visual: "visual", code: "code",
      };
      const kind = map[action];
      if (kind) void createHereByKind(kind, worldX, worldY);
    };
    window.addEventListener("workspace:open-item", onOpenItem);
    window.addEventListener("workspace:context-action", onContextAction);
    return () => {
      window.removeEventListener("workspace:open-item", onOpenItem);
      window.removeEventListener("workspace:context-action", onContextAction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseItems, pan]);

  /* ─── Visible item culling ─── */
  const visibleItems = useMemo(() => {
    const pad = 500;
    const cx = -pan.x, cy = -pan.y;
    const hw = vpSize.w / 2 / zoom + pad;
    const hh = vpSize.h / 2 / zoom + pad;
    // Show ALL items from ALL workspaces always
    return baseItems.filter((it) => {
      const p = posOf(it);
      return p.x + it.w > cx - hw && p.x < cx + hw && p.y + it.h > cy - hh && p.y < cy + hh;
    });
  }, [pan, zoom, vpSize, posOf, baseItems]);

  /* ─── Welcome toast (first-load) ─── */
  const [welcomeShown, setWelcomeShown] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem("spectra-v2:welcome");
    if (!seen) {
      setWelcomeShown(true);
      localStorage.setItem("spectra-v2:welcome", "seen");
      setTimeout(() => setWelcomeShown(false), 12000);
    }
  }, []);

  /* ─── On view-mode change, frame the territory ─── */
  useEffect(() => {
    if (currentTerritory) {
      flyTo({ x: -currentTerritory.cx, y: -currentTerritory.cy + 40 }, Math.max(0.62, zoom));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const [pendingOpenSourceId, setPendingOpenSourceId] = useState<string | null>(null);

  /* ─── Check pending open (after backend creation returns id) ─── */
  useEffect(() => {
    if (!pendingOpenSourceId) return;
    const hit = baseItems.find((i) => i.sourceChatId === pendingOpenSourceId || i.sourceArtifactId === pendingOpenSourceId || i.sourceId === pendingOpenSourceId);
    if (hit) {
      const p = posOf(hit);
      flyTo({ x: -(p.x + hit.w / 2), y: -(p.y + hit.h / 2) }, Math.max(zoom, TIERS.ITEM));
      setOpenInspectorId(hit.id);
      setPendingOpenSourceId(null);
    }
  }, [baseItems, pendingOpenSourceId, posOf, flyTo, zoom]);

  /* ─── Derived ─── */
  const canvasTransform = `translate(${vpSize.w / 2 + pan.x * zoom}px, ${vpSize.h / 2 + pan.y * zoom}px) scale(${zoom})`;
  const trayItems = Array.from(selection).map((id) => baseItems.find((i) => i.id === id)).filter(Boolean) as V2Item[];
  const pinnedItems = pinned.map((id) => baseItems.find((i) => i.id === id)).filter(Boolean) as V2Item[];

  /* ─── Render ─── */
  return (
    <div
      className={`spectra-v2 spectra-v2-grid fixed inset-0 overflow-hidden ${theme === "dark" ? "dark" : ""} ${buildingFocusSet ? "sv2-building-set" : ""}`}
      style={{ cursor: panning ? "grabbing" : spaceHeld ? "grab" : "default" }}
    >
      {/* Viewport / canvas bg */}
      <div
        ref={viewportRef}
        data-canvas-bg
        className="absolute inset-0"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={(e) => {
          e.preventDefault();
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) return;
          const worldX = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
          const worldY = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;
          setCtx({ x: e.clientX, y: e.clientY, worldX, worldY });
        }}
      >
        <div
          ref={canvasRef}
          data-canvas-bg
          className="absolute"
          style={{ left: 0, top: 0, transform: canvasTransform, transformOrigin: "0 0", width: 1, height: 1 }}
        >
          {/* Territory borders */}
          {territories.map((t) => (
              <div
                key={t.id}
                className="absolute pointer-events-none"
                style={{
                  left: t.cx - t.w / 2, top: t.cy - t.h / 2, width: t.w, height: t.h,
                  border: `2px dashed ${t.color}`, opacity: 0.55,
                  borderRadius: 24, transition: "opacity 220ms ease",
                }}
              />
          ))}

          {/* Territory titles */}
          {territories.map((t) => {
            const labelOpacity = 1;
            if (labelOpacity <= 0) return null;
            const itemCount = baseItems.filter((i) => i.workspaceId === t.id).length;
            return (
              <div
                key={"t-" + t.id}
                className="absolute pointer-events-none"
                style={{
                  left: t.cx - t.w / 2 + 30, top: t.cy - t.h / 2 + 24,
                  opacity: labelOpacity, transition: "opacity 220ms ease",
                }}
              >
                <div className="font-display" style={{ fontSize: 50, color: t.color, lineHeight: 1, letterSpacing: "-0.02em", opacity: 0.9 }}>
                  {t.name}
                </div>
                <div className="font-mono uppercase tracking-[0.16em]" style={{ fontSize: 16, color: t.color, opacity: 0.75, marginTop: 12 }}>
                  {itemCount} items · {t.subtitle}
                </div>
              </div>
            );
          })}

          {/* ─── View-mode group labels for ALL territories ─── */}
          {arranged && (() => {
            const allLabels: import("react").ReactNode[] = [];
            for (const w of territories) {
              const wsItems = baseItems.filter((i) => i.workspaceId === w.id);
              const padLeft = w.cx - w.w / 2 + 80;
              const padTop = w.cy - w.h / 2 + 160;

              if (viewMode === "type") {
                const byKey: Record<string, V2Item[]> = {};
                wsItems.forEach((it) => { (byKey[it.kind] = byKey[it.kind] || []).push(it); });
                let y = padTop;
                Object.keys(byKey).forEach((k, ki) => {
                  const row = byKey[k];
                  const color = KIND_META[k as V2Kind]?.tone ?? "var(--ink-400)";
                  allLabels.push(
                    <div key={`group-${w.id}-${ki}`} className="absolute pointer-events-none" style={{ left: 0, top: 0 }}>
                      {ki > 0 && (
                        <div className="absolute sv2-view-lane-divider"
                             style={{ left: padLeft - 20, top: y - 28, width: w.w - 100 }} />
                      )}
                      <div className="absolute sv2-view-group-label" style={{ left: padLeft, top: y - 22, color }}>
                        {KIND_META[k as V2Kind]?.label ?? k} · {row.length}
                      </div>
                    </div>
                  );
                  y += Math.ceil(row.length / 3) * 270 + 60;
                });
              }

              if (viewMode === "topic") {
                const groups = computeTopicGroups(wsItems);
                let y = padTop;
                Object.entries(groups).forEach(([topicLabel, items], ki) => {
                  allLabels.push(
                    <div key={`topic-${w.id}-${ki}`} className="absolute pointer-events-none" style={{ left: 0, top: 0 }}>
                      {ki > 0 && (
                        <div className="absolute sv2-view-lane-divider"
                             style={{ left: padLeft - 20, top: y - 28, width: w.w - 100 }} />
                      )}
                      <div className="absolute sv2-view-group-label" style={{ left: padLeft, top: y - 22, color: "var(--mint)" }}>
                        {topicLabel} · {items.length}
                      </div>
                    </div>
                  );
                  y += Math.ceil(items.length / 3) * 270 + 60;
                });
              }

              if (viewMode === "timeline") {
                const now = Date.now();
                const buckets: { label: string; until: number; items: V2Item[] }[] = [
                  { label: "Today",      until: now - 86_400_000,     items: [] },
                  { label: "Yesterday",  until: now - 2 * 86_400_000, items: [] },
                  { label: "Last week",  until: now - 7 * 86_400_000, items: [] },
                  { label: "Older",      until: 0,                    items: [] },
                ];
                wsItems.forEach((it) => {
                  const ts = (it.meta?.updatedAt as number) ?? (0);
                  const bucket = buckets.find((b) => ts > b.until) ?? buckets[buckets.length - 1];
                  bucket.items.push(it);
                });
                buckets.forEach((b) => b.items.sort((a, z) => ((z.meta?.updatedAt as number) ?? 0) - ((a.meta?.updatedAt as number) ?? 0)));
                let y = padTop;
                buckets.forEach((b, bi) => {
                  if (b.items.length === 0) return;
                  allLabels.push(
                    <div key={`tl-${w.id}-${bi}`} className="absolute pointer-events-none" style={{ left: 0, top: 0 }}>
                      {bi > 0 && (
                        <div className="absolute sv2-view-lane-divider"
                             style={{ left: padLeft, top: y - 28, width: w.w - 180 }} />
                      )}
                      <div className="absolute sv2-timeline-tick-label sv2-timeline-bucket-header"
                           style={{ left: padLeft, top: y - 20 }}>
                        {b.label}
                        <span className="ml-2 font-normal opacity-55">{b.items.length}</span>
                      </div>
                    </div>
                  );
                  y += Math.ceil(b.items.length / 3) * 270 + 70;
                });
              }
            }
            return allLabels;
          })()}

          {/* Items */}
          {visibleItems.map((it, idx) => {
            const m = modeFor(it);
            const p = posOf(it);
            const inSet = focusSetIds.includes(it.id);
            const isPrimary = it.id === primaryFocusId;
            const setIndex = focusSetIds.indexOf(it.id);
            return (
              <div
                key={it.id}
                className="absolute sv2-drift-in"
                style={{
                  left: p.x, top: p.y, width: it.w, height: it.h,
                  transition:
                    "left 380ms cubic-bezier(0.22,1,0.36,1), top 380ms cubic-bezier(0.22,1,0.36,1), width 260ms ease, height 260ms ease, opacity 220ms ease",
                  animationDelay: `${Math.min(idx * 22, 360)}ms`,
                  position: "absolute",
                }}
              >
                <ItemCard
                  item={it}
                  mode={m}
                  focused={focusedItem?.id === it.id}
                  selected={selection.has(it.id)}
                  inSet={inSet}
                  primaryInSet={isPrimary && buildingFocusSet}
                  aiTouched={!!aiTouched[it.id]}
                  onClick={onItemClick}
                  onDoubleClick={onItemDoubleClick}
                  onPin={onPinItem}
                  onEdit={(patch) => handleItemEdit(it, patch)}
                />
                {/* Set index badge */}
                {inSet && buildingFocusSet && (
                  <div className="sv2-set-badge" style={{ background: isPrimary ? "var(--accent)" : "var(--ink-300)" }}>
                    {isPrimary ? "★" : setIndex + 1}
                  </div>
                )}
              </div>
            );
          })}

          {/* Lasso */}
          {lasso && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: Math.min(lasso.x0, lasso.x1),
                top: Math.min(lasso.y0, lasso.y1),
                width: Math.abs(lasso.x1 - lasso.x0),
                height: Math.abs(lasso.y1 - lasso.y0),
                border: "1.5px dashed var(--accent)",
                background: "rgba(14,142,232,0.07)",
                borderRadius: 4,
              }}
            />
          )}
        </div>
      </div>

      {/* ─── AI connector trails (command-bar → new item) ─── */}
      {trails.length > 0 && (
        <svg className="fixed inset-0 pointer-events-none z-[35]" width="100%" height="100%">
          {trails.map((t) => {
            const midX = (t.x1 + t.x2) / 2;
            const midY = Math.min(t.y1, t.y2) - 40;
            const d = `M ${t.x1} ${t.y1} Q ${midX} ${midY} ${t.x2} ${t.y2}`;
            return (
              <path key={t.id} d={d} className="sv2-trail" />
            );
          })}
        </svg>
      )}

      {/* ─── Focused view (replaces bloom) ─── */}
      {focusedViewOpen && (() => {
        const focusItems = focusSetIds.map((id) => baseItems.find((i) => i.id === id)).filter(Boolean) as V2Item[];
        if (focusItems.length === 0) return null;
        const activePrimaryId = focusViewPrimaryId ?? focusItems[0].id;
        const closeView = () => {
          setFocusedViewOpen(false);
          setBuildingFocusSet(false);
          setFocusSetIds([]);
          setPrimaryFocusId(null);
          setFocusViewPrimaryId(null);
        };
        const promotePrimary = (id: string) => {
          setFocusViewPrimaryId(id);
          setFocusViewFocusIdx(focusSetIds.indexOf(id));
        };
        const n = focusItems.length;
        // Arrange primary first, then rest
        const primaryItem = focusItems.find((i) => i.id === activePrimaryId) ?? focusItems[0];
        const restItems = focusItems.filter((i) => i.id !== primaryItem.id);

        const renderPane = (it: V2Item, isPrim: boolean, isFocused: boolean, idx: number) => (
          <div
            key={it.id}
            data-bloom-editor="1"
            className={`sv2-focus-pane${isPrim ? " primary" : ""}`}
            style={{
              outline: isFocused && !isPrim ? "2px solid rgba(14,142,232,0.4)" : "none",
              animationDelay: `${idx * 50}ms`,
              flex: isPrim ? (n === 1 ? undefined : "1.55 1 0") : "1 1 0",
            }}
            onClick={!isPrim ? () => promotePrimary(it.id) : undefined}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sv2-focus-item-header" style={{ background: `linear-gradient(90deg, ${it.color}18, transparent 60%)` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: it.color }} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] truncate" style={{ color: "var(--ink-400)" }}>
                    {KIND_META[it.kind]?.label ?? it.kind}
                  </span>
                  {isPrim && <span className="font-mono text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full" style={{ background: "var(--accent)", color: "#fff" }}>Primary</span>}
                </div>
                {!isPrim && <span className="sv2-focus-promote-hint">Click to promote</span>}
                {isPrim && (
                  <button onClick={closeView} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-[var(--bg2)] transition-colors" style={{ color: "var(--ink-400)" }} title="Close (Esc)">
                    <Icon name="close" size={10} />
                  </button>
                )}
              </div>
              <div className="font-display text-[18px] leading-[1.2] mt-1 truncate" style={{ color: "var(--ink-100)" }}>{it.title}</div>
            </div>
            {/* Body */}
            <div className="sv2-focus-item-body sv2-slim">
              <FocusPaneContent item={it} onEdit={(patch) => handleItemEdit(it, patch)} />
            </div>
          </div>
        );

        return (
          <>
            <div className="sv2-focus-scrim" onClick={closeView} />
            {n <= 2 ? (
              <div
                className={`sv2-focus-stage count-${n}`}
                onMouseDown={(e) => { if (e.target === e.currentTarget) closeView(); }}
              >
                {renderPane(primaryItem, true, focusViewFocusIdx === 0, 0)}
                {restItems.map((it, i) => renderPane(it, false, focusViewFocusIdx === i + 1, i + 1))}
              </div>
            ) : n === 3 ? (
              <div
                className="sv2-focus-stage count-3"
                onMouseDown={(e) => { if (e.target === e.currentTarget) closeView(); }}
              >
                {renderPane(primaryItem, true, focusViewFocusIdx === 0, 0)}
                <div className="sv2-focus-secondary-col">
                  {restItems.map((it, i) => renderPane(it, false, focusViewFocusIdx === i + 1, i + 1))}
                </div>
              </div>
            ) : (
              <div
                className="sv2-focus-stage count-4"
                onMouseDown={(e) => { if (e.target === e.currentTarget) closeView(); }}
              >
                {renderPane(primaryItem, true, focusViewFocusIdx === 0, 0)}
                {restItems.slice(0, Math.min(restItems.length, 5)).map((it, i) => renderPane(it, false, focusViewFocusIdx === i + 1, i + 1))}
              </div>
            )}
          </>
        );
      })()}

      {/* Chrome — unified bar */}
      <TopRail
        workspace={currentTerritory}
        zoom={zoom}
        viewMode={viewMode}
        theme={theme}
        onViewMode={setViewMode}
        onHome={goToAtlas}
        onAtlas={goToAtlas}
        onSpotlight={() => setSpotOpen(true)}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onOpenInfo={() => setInfoOpen(true)}
        territories={territories}
        currentWorkspaceId={currentTerritory?.id ?? null}
        onPickWorkspace={goToWorkspace}
        onCreateWorkspace={async () => {
          if (isLive) {
            const r = await createItemAction({ action: "createWorkspace", title: "New workspace" });
            scheduleIslandDismiss({ status: r.ok ? "done" : "error", text: r.ok ? "Created new workspace." : "Could not create workspace.", chips: ["Workspace"] });
          } else {
            scheduleIslandDismiss({ status: "done", text: "(demo) New workspace would be created here.", chips: ["Workspace"] });
          }
        }}
      />

      <Minimap
        territories={territories}
        items={baseItems}
        viewport={{ x: -pan.x, y: -pan.y, w: vpSize.w / zoom, h: vpSize.h / zoom }}
        worldSize={WORLD_SIZE}
        onHoverPan={(wx, wy) => setPan({ x: -wx, y: -wy })}
        onCommitPan={(wx, wy) => setPan({ x: -wx, y: -wy })}
        onWorkspaceClick={goToWorkspace}
        onWheelZoom={(delta) => {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) return;
          zoomAt(rect.width / 2, rect.height / 2, Math.exp(delta * 0.001));
        }}
      />

      <ZoomControl
        zoom={zoom}
        onZoom={(factor) => {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) return;
          zoomAt(rect.width / 2, rect.height / 2, factor);
        }}
        onReset={goToAtlas}
      />

      {/* Widget chip rail — collapsed widget chips + add/manage */}
      <WidgetChipRail
        widgets={widgets.filter((w) => w.kind !== "artifact" && w.kind !== "thread")}
        tick={widgetStateRevision}
        aiTouched={Object.fromEntries(
          Object.entries(aiTouched).filter(([k]) => widgets.some((w) => w.id === k)).map(([k]) => [k, true])
        )}
        onExpand={expandWidget}
        onAddWidget={addWidget}
        onCollapseAll={collapseAllWidgets}
        onExpandAll={expandAllWidgets}
        allCollapsed={widgets.filter((w) => w.kind !== "artifact" && w.kind !== "thread").every((w) => Boolean(w.collapsed))}
        someCollapsed={widgets.filter((w) => w.kind !== "artifact" && w.kind !== "thread").some((w) => Boolean(w.collapsed))}
        revealingWidgetId={revealingWidgetId}
      />

      {/* ─── Inspector: ArtifactWidget / ThreadWidget (single-click opens item) ─── */}
      {(() => {
        if (!openInspectorId) return null;
        const item = baseItems.find((i) => i.id === openInspectorId);
        if (!item) return null;
        const vpW = typeof window !== "undefined" ? window.innerWidth : 1400;
        const x = Math.min(vpW - 456, vpW - 460);
        const y = 90;
        if (item.kind === "thread") {
          return (
            <ThreadWidget
              item={item}
              x={x} y={y} w={440} h={520}
              collapsed={false}
              onMove={() => {}}
              onClose={() => setOpenInspectorId(null)}
              onCollapse={() => setOpenInspectorId(null)}
              onExpand={() => {}}
            />
          );
        }
        return (
          <ArtifactWidget
            item={item}
            x={x} y={y} w={440} h={520}
            collapsed={false}
            onMove={() => {}}
            onClose={() => setOpenInspectorId(null)}
            onCollapse={() => setOpenInspectorId(null)}
            onExpand={() => {}}
            onEdit={(patch) => handleItemEdit(item, patch)}
          />
        );
      })()}

      {/* Floating utility widgets — never include artifact/thread (handled above as inspector) */}
      {widgets.filter((w) => w.kind !== "artifact" && w.kind !== "thread").map((w) => {
        if (widgetsHidden) return null;
        return (
          <FloatingWidget
            key={w.id}
            widget={w}
            workspaceItems={baseItems}
            onMove={moveWidget}
            onClose={closeWidget}
            onCollapse={toggleWidgetCollapsed}
            onExpand={expandWidget}
            onTimerToggle={toggleTimer}
            onTimerReset={resetTimer}
            aiTouched={!!aiTouched[w.id]}
            onAsk={(text) => handleSendMessage(text)}
            onExpandEdit={(id) => setEditingWidgetId(id)}
            onWidgetEdit={updateWidgetState}
            onOpenItem={(id) => setPendingOpenSourceId(id)}
          />
        );
      })}

      {/* Widget deep-edit (WidgetBloom) — separate from focused view */}
      {editingWidgetId && (() => {
        const w = widgets.find((ww) => ww.id === editingWidgetId);
        if (!w) return null;
        return (
          <>
            <div className="sv2-focus-scrim" onClick={() => setEditingWidgetId(null)} />
            <div
              className="sv2-focus-stage count-1"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingWidgetId(null); }}
            >
              <div className="sv2-focus-pane primary" style={{ pointerEvents: "auto" }}>
                <WidgetBloom
                  widget={w}
                  workspaceItems={baseItems}
                  onClose={() => setEditingWidgetId(null)}
                  onTimerToggle={toggleTimer}
                  onTimerReset={resetTimer}
                  onAsk={(text) => handleSendMessage(text)}
                  onWidgetEdit={updateWidgetState}
                  onOpenItem={(id) => setPendingOpenSourceId(id)}
                />
              </div>
            </div>
          </>
        );
      })()}

      <Tray
        open={trayOpen || selection.size > 1}
        items={trayItems}
        pinned={pinnedItems}
        onClose={() => { setTrayOpen(false); setSelection(new Set()); }}
        onRemove={(id) => { const s = new Set(selection); s.delete(id); setSelection(s); }}
        onAction={onTrayAction}
      />

      <CommandBar
        focusedItem={focusedItem}
        workspace={currentTerritory}
        selectedCount={selection.size}
        bloomedCount={0}
        resultIsland={resultIsland}
        quickStarts={QUICK_STARTS}
        onSubmit={handleSendMessage}
        onDismissResult={() => setResultIsland(null)}
        onSpotlight={() => setSpotOpen(true)}
        onCreate={(kind) => {
          void createHereByKind(kind, -pan.x, -pan.y);
        }}
        onClearFocusContext={() => {
          setOpenInspectorId(null);
          setBuildingFocusSet(false);
          setFocusSetIds([]);
          setPrimaryFocusId(null);
          setFocusedViewOpen(false);
          setFocusViewPrimaryId(null);
        }}
        focusContext={
          focusedViewOpen
            ? { kind: "focused-view", title: `${focusSetIds.length} items`, color: "var(--accent)", count: focusSetIds.length }
            : buildingFocusSet && focusSetIds.length > 0
            ? { kind: "building-set", title: `${focusSetIds.length} items`, color: "var(--ink-300)", count: focusSetIds.length }
            : openInspectorId
            ? (() => {
                const it = baseItems.find((i) => i.id === openInspectorId);
                if (!it) return null;
                return { kind: it.kind === "thread" ? "thread" as const : "artifact" as const, title: it.title, color: it.color };
              })()
            : null
        }
      />

      <Spotlight
        open={spotOpen}
        onClose={() => setSpotOpen(false)}
        items={baseItems}
        territories={territories}
        quickStarts={QUICK_STARTS}
        onPick={onSpotlightPick}
      />

      <InfoPanel open={infoOpen} onClose={() => setInfoOpen(false)} />

      {/* Right-click contextual menu */}
      {ctx && (
        <>
          <div className="fixed inset-0 z-[55]" onMouseDown={() => setCtx(null)} />
          <div
            className="fixed z-[56] rounded-lg py-1 min-w-[220px] sv2-drift-in"
            style={{
              left: Math.min(ctx.x, vpSize.w - 240),
              top: Math.min(ctx.y, vpSize.h - 280),
              background: "var(--paper)",
              border: "1px solid var(--line)",
              boxShadow: "0 18px 45px -28px rgba(8,22,40,0.2)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {([
              { id: "ask", label: "Ask AI…", icon: "sparkle" as const, run: () => { setCtx(null); setSpotOpen(true); } },
              { id: "c-note", label: "New note here", icon: "note" as const, run: () => { const c = ctx; setCtx(null); if (c) createHereByKind("note", c.worldX, c.worldY); } },
              { id: "c-task", label: "New task here", icon: "schedule" as const, run: () => { const c = ctx; setCtx(null); if (c) createHereByKind("task", c.worldX, c.worldY); } },
              { id: "c-thread", label: "New thread here", icon: "thread" as const, run: () => { const c = ctx; setCtx(null); if (c) createHereByKind("thread", c.worldX, c.worldY); } },
              { id: "c-visual", label: "New visual here", icon: "layers" as const, run: () => { const c = ctx; setCtx(null); if (c) createHereByKind("visual", c.worldX, c.worldY); } },
              { id: "c-code", label: "New code here", icon: "pset" as const, run: () => { const c = ctx; setCtx(null); if (c) createHereByKind("code", c.worldX, c.worldY); } },
              { id: "_div1", label: "", icon: "dots" as const, run: () => {} },
              { id: "w-planner", label: "Add Planner widget", icon: "planner" as const, run: () => { setCtx(null); addWidget("planner"); } },
              { id: "w-timer", label: "Add Timer widget", icon: "timer" as const, run: () => { setCtx(null); addWidget("timer"); } },
              { id: "w-scratch", label: "Add Scratchpad widget", icon: "note" as const, run: () => { setCtx(null); addWidget("scratch"); } },
              { id: "w-today", label: "Add Today widget", icon: "schedule" as const, run: () => { setCtx(null); addWidget("today"); } },
              { id: "w-library", label: "Add Library widget", icon: "reading" as const, run: () => { setCtx(null); addWidget("library"); } },
              { id: "w-calendar", label: "Add Calendar widget", icon: "schedule" as const, run: () => { setCtx(null); addWidget("calendar"); } },
              { id: "w-thread", label: "Add Thread widget", icon: "thread" as const, run: () => { setCtx(null); addWidget("thread"); } },
              { id: "w-artifact", label: "Add Artifact widget", icon: "note" as const, run: () => { setCtx(null); addWidget("artifact"); } },
            ] as const).map((row) =>
              row.id.startsWith("_div") ? (
                <div key={row.id} className="h-px mx-2 my-1" style={{ background: "var(--line)" }} />
              ) : (
                <button
                  key={row.id}
                  onClick={row.run}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12.5px] hover:bg-[var(--bg2)]"
                  style={{ color: "var(--ink-100)" }}
                >
                  <Icon name={row.icon} size={12} style={{ color: "var(--ink-400)" }} />
                  {row.label}
                </button>
              )
            )}
          </div>
        </>
      )}

      {/* Dynamic tip hint — reflects current interaction state */}
      {(() => {
        if (focusedViewOpen) {
          return (
            <div className="absolute left-1/2 -translate-x-1/2 top-[62px] z-10 pointer-events-none sv2-drift-in">
              <div className="sv2-hint-pill">
                <span style={{ color: "var(--accent)" }}>Focused</span>
                &nbsp;·&nbsp;<span className="sv2-kbd">Tab</span> cycle
                &nbsp;·&nbsp;Click pane to promote
                &nbsp;·&nbsp;<span className="sv2-kbd">Esc</span> exit
              </div>
            </div>
          );
        }
        if (buildingFocusSet) {
          return (
            <div className="absolute left-1/2 -translate-x-1/2 top-[62px] z-10 pointer-events-none sv2-drift-in">
              <div className="sv2-hint-pill" style={{ borderColor: "rgba(14,142,232,0.4)" }}>
                <span style={{ color: "var(--accent)" }}>Building set</span>
                &nbsp;·&nbsp;{focusSetIds.length} items selected
                &nbsp;·&nbsp;<span className="sv2-kbd">Space</span> to focus
                &nbsp;·&nbsp;<span className="sv2-kbd">Esc</span> cancel
              </div>
            </div>
          );
        }
        if (focusedItem && !openInspectorId) {
          return (
            <div className="absolute left-1/2 -translate-x-1/2 top-[62px] z-10 pointer-events-none sv2-drift-in">
              <div className="sv2-hint-pill">
                <span style={{ color: focusedItem.color }}>
                  <Icon name={KIND_META[focusedItem.kind as V2Kind].icon} size={12} />
                </span>
                <span style={{ color: "var(--ink-100)" }}>{focusedItem.title.slice(0, 28)}</span>
                &nbsp;·&nbsp;<span className="sv2-kbd">Space</span> focus
                &nbsp;·&nbsp;<span className="sv2-kbd">Tab</span> next
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* Welcome toast */}
      {welcomeShown && (
        <div className="absolute top-24 right-6 z-50 sv2-drift-in">
          <div
            className="rounded-2xl p-4 w-[340px]"
            style={{
              background: "rgba(251,250,246,0.94)",
              border: "1px solid var(--line)",
              backdropFilter: "blur(10px)",
              boxShadow: "0 18px 45px -28px rgba(8,22,40,0.2)",
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "linear-gradient(135deg, var(--accent), var(--mint))" }}
              >
                <Icon name="sparkle" size={13} stroke="#fff" />
              </div>
              <div className="flex-1">
                <div className="font-display text-[17px] leading-tight" style={{ color: "var(--ink-100)" }}>
                  Welcome back.
                </div>
                <div className="text-[12px] mt-1.5 leading-[1.55]" style={{ color: "var(--ink-300)" }}>
                  Scroll pan · ⌘ Scroll zoom · Double-click focus set · Space to open · Tab cycle · ⌘K spotlight
                </div>
              </div>
              <button
                onClick={() => setWelcomeShown(false)}
                className="shrink-0 mt-0.5"
                style={{ color: "var(--ink-400)" }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Type exports (for parent wiring, no-ops otherwise) ─── */
export type { FloatingWidgetData, WidgetKind, ViewMode };
export type SpectraWorkspaceItem = WorkspaceItemData;
