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
  AtlasStrip,
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
  FloatingWidget,
  WidgetBloom,
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
  updateCommandResult,
  useWorkspaceData,
} from "@/hooks/use-workspace-data";
import {
  notifyWorkspaceContentMutated,
} from "@/lib/workspace/events";
import type {
  WorkspaceData,
  WorkspaceItemData,
} from "@/lib/workspace/contracts";

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
  const [bloomedIds, setBloomedIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<string[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);

  /* ─── Chrome panels ─── */
  const [spotOpen, setSpotOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("spatial");
  const [resultIsland, setResultIsland] = useState<ResultIsland>(null);

  /* ─── Widgets ─── */
  const [widgets, setWidgets] = useState<FloatingWidgetData[]>([
    { id: "w-timer", kind: "timer", x: 20, y: 100, w: 280, h: 112, state: { secs: 25 * 60, running: false } },
    { id: "w-planner", kind: "planner", x: 20, y: 230, w: 280, h: 260, state: {} },
    { id: "w-today", kind: "today", x: 20, y: 510, w: 280, h: 210, state: {} },
  ]);
  const [widgetsHidden, setWidgetsHidden] = useState(false);
  useTimerTick(widgets, setWidgets);

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

  /* ─── AI connector trails (spatial view only) ─── */
  const [trails, setTrails] = useState<Array<{ id: string; x1: number; y1: number; x2: number; y2: number; until: number }>>([]);
  const spawnTrail = useCallback((fromX: number, fromY: number, toWorldX: number, toWorldY: number) => {
    const id = `trail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setTrails((ts) => [...ts, { id, x1: fromX, y1: fromY, x2: toWorldX, y2: toWorldY, until: Date.now() + 900 }]);
    setTimeout(() => setTrails((ts) => ts.filter((t) => t.id !== id)), 950);
  }, []);

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
        if (j?.viewMode && ["spatial", "type", "topic", "timeline"].includes(j.viewMode)) {
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

  /* ─── View-mode reflow: produce positions keyed by item id ─── */
  const arranged = useMemo<Record<string, { x: number; y: number }> | null>(() => {
    if (viewMode === "spatial" || !currentTerritory) return null;
    const w = currentTerritory;
    const wsItems = baseItems.filter((i) => i.workspaceId === w.id);
    const coords: Record<string, { x: number; y: number }> = {};
    const padLeft = w.cx - w.w / 2 + 80;
    const padTop = w.cy - w.h / 2 + 160;

    if (viewMode === "type" || viewMode === "topic") {
      const byKey: Record<string, V2Item[]> = {};
      wsItems.forEach((it) => {
        const k = viewMode === "type" ? it.kind : (it.meta?.topic as string) ?? it.kind;
        (byKey[k] = byKey[k] || []).push(it);
      });
      let y = padTop;
      Object.keys(byKey).forEach((k) => {
        const row = byKey[k];
        row.forEach((it, idx) => {
          coords[it.id] = { x: padLeft + (idx % 3) * 360, y: y + Math.floor(idx / 3) * 270 };
        });
        y += Math.ceil(row.length / 3) * 270 + 50;
      });
    } else if (viewMode === "timeline") {
      const sorted = [...wsItems].sort((a, b) => {
        const au = (a.meta?.updatedAt as number) ?? 0;
        const bu = (b.meta?.updatedAt as number) ?? 0;
        return bu - au;
      });
      sorted.forEach((it, idx) => {
        coords[it.id] = { x: padLeft + (idx % 4) * 310, y: padTop + Math.floor(idx / 4) * 270 };
      });
    }
    return coords;
  }, [viewMode, currentTerritory, baseItems]);

  const posOf = useCallback(
    (it: V2Item): { x: number; y: number } => {
      if (arranged && arranged[it.id]) return arranged[it.id];
      return { x: it.x, y: it.y };
    },
    [arranged],
  );

  /* ─── Mode per item (glance/touch/bloom) ─── */
  const modeFor = useCallback(
    (item: V2Item): "glance" | "touch" | "bloom" => {
      if (bloomedIds.includes(item.id)) return "bloom";
      if (zoom < 0.42) return "glance";
      return "touch";
    },
    [zoom, bloomedIds],
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
    setViewMode("spatial");
    const t = territories.find((x) => x.id === terrId);
    if (!t) return;
    setBloomedIds([]);
    flyTo({ x: -t.cx, y: -t.cy }, TIERS.WORKSPACE);
  };
  const goToAtlas = () => {
    setBloomedIds([]);
    flyTo({ x: 0, y: 0 }, TIERS.OUT);
  };
  const goToItem = (itemId: string, bloom = true) => {
    const it = baseItems.find((x) => x.id === itemId);
    if (!it) return;
    const p = posOf(it);
    flyTo({ x: -(p.x + it.w / 2), y: -(p.y + it.h / 2) }, TIERS.ITEM);
    if (bloom) setTimeout(() => setBloomedIds((bs) => (bs.includes(it.id) ? bs : [...bs, it.id].slice(-3))), 440);
  };

  /* ─── Focused item (nearest to camera center) ─── */
  const focusedItem = useMemo<V2Item | null>(() => {
    if (zoom < 0.48) return null;
    if (bloomedIds.length > 0) return null;
    const cx = -pan.x, cy = -pan.y;
    const pool = currentTerritory ? baseItems.filter((i) => i.workspaceId === currentTerritory.id) : baseItems;
    let best: V2Item | null = null;
    let bd = Infinity;
    const maxDist = 300 / zoom;
    pool.forEach((it) => {
      const p = posOf(it);
      const ix = p.x + it.w / 2, iy = p.y + it.h / 2;
      const d = Math.hypot(ix - cx, iy - cy);
      if (d < bd && d < maxDist) { best = it; bd = d; }
    });
    return best;
  }, [pan, zoom, currentTerritory, posOf, baseItems, bloomedIds]);

  const cycleFocus = (dir: 1 | -1) => {
    const pool = currentTerritory ? baseItems.filter((i) => i.workspaceId === currentTerritory.id) : baseItems;
    if (pool.length === 0) return;
    let idx = focusedItem ? pool.findIndex((i) => i.id === focusedItem.id) : -1;
    idx = (idx + dir + pool.length) % pool.length;
    const it = pool[idx];
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
    if (e.shiftKey) {
      const s = new Set(selection);
      if (s.has(item.id)) s.delete(item.id); else s.add(item.id);
      setSelection(s);
      if (s.size > 1) setTrayOpen(true);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      if (bloomedIds.includes(item.id)) {
        // Promote to primary (first in list).
        setBloomedIds((bs) => [item.id, ...bs.filter((x) => x !== item.id)]);
        return;
      }
    }
    if (bloomedIds.includes(item.id)) return;
    const p = posOf(item);
    flyTo({ x: -(p.x + item.w / 2), y: -(p.y + item.h / 2) }, Math.max(zoom, TIERS.WORKSPACE + 0.1));
  };
  const onItemDoubleClick = (item: V2Item) => {
    setBloomedIds((bs) => (bs.includes(item.id) ? bs : [...bs, item.id].slice(-3)));
  };
  const closeBloom = (id: string) => setBloomedIds((bs) => bs.filter((i) => i !== id));
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

  /* ─── Result island auto-dismiss ─── */
  const scheduleIslandDismiss = useCallback((island: ResultIsland, ms = 8000) => {
    setResultIsland(island);
    if (!island) return;
    setTimeout(() => {
      setResultIsland((r) => (r && r.status !== "streaming" ? null : r));
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
        scheduleIslandDismiss({
          status: r.ok ? "done" : "error",
          text: r.ok ? `Created ${kind} here.` : `Could not create ${kind}.`,
          chips: [kind],
        });
      } else {
        scheduleIslandDismiss({ status: "done", text: `(demo) Created ${kind} here.`, chips: [kind] });
      }
    },
    [committedWorkspaceId, isLive, createItemAction, scheduleIslandDismiss, pan, zoom, spawnTrail],
  );

  /* ─── Quick-start scaffold (multi-widget + seeded tasks) ─── */
  const runQuickStartScaffold = useCallback(
    (title: string) => {
      const lc = title.toLowerCase();
      const chips: string[] = [];
      const actions: string[] = [];

      const seed = (kinds: WidgetKind[]) => {
        kinds.forEach((k, i) => {
          const id = `w-qs-${Date.now()}-${i}`;
          const sizes: Record<WidgetKind, { w: number; h: number }> = {
            timer: { w: 280, h: 112 },
            planner: { w: 280, h: 260 },
            today: { w: 280, h: 210 },
            scratch: { w: 280, h: 220 },
            library: { w: 300, h: 260 },
            calendar: { w: 300, h: 260 },
          };
          const size = sizes[k];
          const y = 96 + i * 24;
          setWidgets((ws) => [
            ...ws,
            {
              id,
              kind: k,
              x: 96 + i * 20,
              y,
              ...size,
              state: k === "timer" ? { secs: 25 * 60, running: false } : {},
            },
          ]);
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
    [widgetsHidden, isLive, committedWorkspaceId, createItemAction, scheduleIslandDismiss],
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
          const r = await createItemAction({ action: "createNote", workstreamId: wsId, title, content: "" });
          if (r.ok) spawnCenterTrail();
          scheduleIslandDismiss({ status: r.ok ? "done" : "error", text: r.ok ? `Created note "${title}".` : "Could not create note.", chips: ["Note"] });
        } else {
          spawnCenterTrail();
          scheduleIslandDismiss({ status: "done", text: `(demo) Created note "${title}".`, chips: ["Note"] });
        }
        return;
      }
      if (raw.startsWith("/task ")) {
        if (!requiresWorkspace()) return;
        const title = raw.slice(6).trim() || "Untitled task";
        if (isLive) {
          const r = await createItemAction({ action: "createPlannerItem", workstreamId: wsId, title, type: "deadline", priority: "normal" });
          if (r.ok) spawnCenterTrail();
          scheduleIslandDismiss({ status: r.ok ? "done" : "error", text: r.ok ? `Added planner task "${title}".` : "Could not add task.", chips: ["Task"] });
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
          if (r.ok) spawnCenterTrail();
          scheduleIslandDismiss({ status: r.ok ? "done" : "error", text: r.ok ? `Started thread "${title}".` : "Could not start thread.", chips: ["Thread"] });
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

      // Default → /api/chat or stubbed v1-style reply.
      let touched: string[] = [];
      let stub: ResultIsland = null;
      if (selection.size > 1) {
        touched = Array.from(selection);
        stub = { status: "done", text: `Compared ${selection.size} items. Built a side-by-side with differences highlighted.`, chips: ["Compare", `${selection.size} items`] };
      } else if (focusedItem?.kind === "essay") {
        touched = [focusedItem.id];
        stub = { status: "done", text: "Your thesis reads strong. The weakest transition is ¶3→¶4 — I've drafted a bridge sentence.", chips: ["Suggestion"] };
      } else if (focusedItem?.kind === "pset") {
        touched = [focusedItem.id];
        stub = { status: "done", text: "Hint inserted at the current stuck problem. Try IBP with u=arctan(x), then a trig substitution.", chips: ["Hint"] };
      } else if (focusedItem?.kind === "flashcards") {
        touched = [focusedItem.id];
        stub = { status: "done", text: "Review queued — 10 cards, weakest first.", chips: ["Review"] };
      } else if (focusedItem?.kind === "note") {
        touched = [focusedItem.id];
        stub = { status: "done", text: "Condensed into 3 lines and extracted 6 flashcard-ready terms at the bottom.", chips: ["Note updated"] };
      } else if (lc.includes("plan") && (lc.includes("week") || lc.includes("exam"))) {
        touched = territories.flatMap((t) => baseItems.filter((i) => i.workspaceId === t.id).slice(0, 1).map((i) => i.id));
        stub = { status: "done", text: "This week: Biology midterm Thu, Calc pset Fri, essay Mon. Scheduled 6×50-min focus blocks with a 2-day taper.", chips: ["Plan drafted"] };
      } else {
        stub = { status: "done", text: `Working on: "${raw}". I've surfaced the most relevant items for you.`, chips: ["AI"] };
      }

      if (isLive && wsId) {
        scheduleIslandDismiss({ status: "streaming", text: "Thinking…", chips: [] });
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "general",
              message: raw,
              thinkingLevel: "low",
              routerMode: "auto",
              usePersonalResources: true,
              workstreamId: wsId,
              scopeLevel: "workspace",
            }),
          });
          if (res.ok) {
            const j = await res.json();
            const t = (j?.threadTitle as string) ?? "Response ready";
            scheduleIslandDismiss({ status: "done", text: t, chips: j?.chatId ? ["Chat opened"] : ["Answered"] });
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
  const onTrayAction = (action: "bloom" | "compare" | "merge" | "quiz" | "link" | "ask") => {
    const ids = Array.from(selection);
    const n = ids.length;
    if (action === "bloom") {
      ids.slice(0, 3).forEach((id) => setBloomedIds((bs) => (bs.includes(id) ? bs : [...bs, id].slice(-3))));
      return;
    }
    touchAI(ids, action);
    let text = "";
    if (action === "ask") text = `Asked about ${n} items. Pulled common threads.`;
    if (action === "compare") text = `Built a side-by-side of ${n} items with differences highlighted.`;
    if (action === "merge") text = `Merged ${n} items into a new combined note.`;
    if (action === "quiz") text = `Quiz generated from ${n} items — 12 questions.`;
    if (action === "link") text = `Linked ${n} items as related.`;
    scheduleIslandDismiss({ status: "done", text, chips: [`${n} items`] });
    setSelection(new Set());
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

  /* ─── Widgets ─── */
  const addWidget = (kind: string) => {
    const id = `w-${Date.now()}`;
    const sizes: Record<string, { w: number; h: number }> = {
      timer: { w: 280, h: 112 }, planner: { w: 280, h: 260 }, today: { w: 280, h: 210 },
      scratch: { w: 280, h: 220 }, calendar: { w: 300, h: 260 }, library: { w: 300, h: 260 },
    };
    const size = sizes[kind] ?? { w: 260, h: 200 };
    setWidgets((ws) => [
      ...ws,
      {
        id,
        kind: (kind as WidgetKind),
        x: 96, y: 96, ...size,
        state: kind === "timer" ? { secs: 25 * 60, running: false } : {},
      },
    ]);
    if (widgetsHidden) setWidgetsHidden(false);
  };
  const moveWidget = (id: string, x: number, y: number) =>
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, x, y } : w)));
  const closeWidget = (id: string) => setWidgets((ws) => ws.filter((w) => w.id !== id));
  const toggleWidgetCollapsed = (id: string) =>
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, collapsed: !w.collapsed } : w)));
  const toggleTimer = (id: string) =>
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, state: { ...w.state, running: !(w.state.running as boolean) } } : w)));
  const resetTimer = (id: string, secs: number) =>
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, state: { ...w.state, secs, running: false } } : w)));

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
        e.preventDefault();
        if (e.repeat) { setSpaceHeld(true); return; }
        if (focusedItem) {
          setBloomedIds((bs) => (bs.includes(focusedItem.id) ? bs.filter((i) => i !== focusedItem.id) : [...bs, focusedItem.id].slice(-3)));
        }
      }
      if (e.key === "Tab") { e.preventDefault(); cycleFocus(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") {
        if (ctx) setCtx(null);
        else if (editingWidgetId) setEditingWidgetId(null);
        else if (spotOpen) setSpotOpen(false);
        else if (infoOpen) setInfoOpen(false);
        else if (bloomedIds.length > 0) setBloomedIds((bs) => bs.slice(0, -1));
        else if (selection.size > 0) setSelection(new Set());
        else if (trayOpen) setTrayOpen(false);
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect && (e.key === "=" || e.key === "+")) zoomAt(rect.width / 2, rect.height / 2, 1.08);
      if (rect && (e.key === "-" || e.key === "_")) zoomAt(rect.width / 2, rect.height / 2, 0.92);
      if (e.key === "0") goToAtlas();
      if (e.key === "1") setViewMode("spatial");
      if (e.key === "2") setViewMode("type");
      if (e.key === "3") setViewMode("topic");
      if (e.key === "4") setViewMode("timeline");
      if (e.key.toLowerCase() === "w") setWidgetsHidden((h) => !h);
      if (e.key.toLowerCase() === "b" && focusedItem) {
        setBloomedIds((bs) => (bs.includes(focusedItem.id) ? bs.filter((i) => i !== focusedItem.id) : [...bs, focusedItem.id].slice(-3)));
      }
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === " ") setSpaceHeld(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedItem, bloomedIds, spotOpen, selection, trayOpen, ctx, infoOpen, zoomAt]);

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
    let pool = baseItems;
    if (arranged && currentTerritory) pool = baseItems.filter((i) => i.workspaceId === currentTerritory.id);
    return pool.filter((it) => {
      const p = posOf(it);
      return p.x + it.w > cx - hw && p.x < cx + hw && p.y + it.h > cy - hh && p.y < cy + hh;
    });
  }, [pan, zoom, vpSize, arranged, currentTerritory, posOf, baseItems]);

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

  /* ─── On view-mode change (non-spatial), frame the territory ─── */
  useEffect(() => {
    if (viewMode !== "spatial" && currentTerritory) {
      flyTo({ x: -currentTerritory.cx, y: -currentTerritory.cy + 40 }, Math.max(0.62, zoom));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  /* ─── Bloom layout (flex/grid — never overlap) ─── */
  const bloomed = bloomedIds.map((id) => baseItems.find((i) => i.id === id)).filter(Boolean) as V2Item[];

  /* ─── Derived ─── */
  const canvasTransform = `translate(${vpSize.w / 2 + pan.x * zoom}px, ${vpSize.h / 2 + pan.y * zoom}px) scale(${zoom})`;
  const trayItems = Array.from(selection).map((id) => baseItems.find((i) => i.id === id)).filter(Boolean) as V2Item[];
  const pinnedItems = pinned.map((id) => baseItems.find((i) => i.id === id)).filter(Boolean) as V2Item[];

  /* ─── Render ─── */
  return (
    <div
      className={`spectra-v2 spectra-v2-grid fixed inset-0 overflow-hidden ${theme === "dark" ? "dark" : ""}`}
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
          {territories.map((t) => {
            const territoryOpacity = zoom < 0.5 ? 1 : zoom < 0.8 ? (0.8 - zoom) * 4 : 0;
            return (
              <div
                key={t.id}
                className="absolute pointer-events-none"
                style={{
                  left: t.cx - t.w / 2, top: t.cy - t.h / 2, width: t.w, height: t.h,
                  border: `1.5px dashed ${t.color}`, opacity: territoryOpacity * 0.35,
                  borderRadius: 24, transition: "opacity 220ms ease",
                }}
              />
            );
          })}

          {/* Territory titles */}
          {territories.map((t) => {
            const labelOpacity = zoom < 0.32 ? 1 : zoom < 0.5 ? 1 : zoom < 0.72 ? (0.72 - zoom) * 3.2 : 0;
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
                <div className="font-display" style={{ fontSize: 44, color: t.color, lineHeight: 1, letterSpacing: "-0.02em", opacity: 0.85 }}>
                  {t.name}
                </div>
                <div className="font-mono uppercase tracking-[0.16em]" style={{ fontSize: 14, color: t.color, opacity: 0.6, marginTop: 10 }}>
                  {itemCount} items · {t.subtitle}
                </div>
              </div>
            );
          })}

          {/* Items */}
          {visibleItems.map((it, idx) => {
            const m = modeFor(it);
            const p = posOf(it);
            const dimmed = bloomedIds.length > 0 && !bloomedIds.includes(it.id);
            return (
              <div
                key={it.id}
                className="absolute sv2-drift-in"
                style={{
                  left: p.x, top: p.y, width: it.w, height: it.h,
                  opacity: dimmed ? 0.22 : 1,
                  pointerEvents: dimmed || m === "bloom" ? "none" : "auto",
                  transition:
                    "left 380ms cubic-bezier(0.22,1,0.36,1), top 380ms cubic-bezier(0.22,1,0.36,1), width 260ms ease, height 260ms ease, opacity 220ms ease",
                  animationDelay: `${Math.min(idx * 22, 360)}ms`,
                }}
              >
                {/* When bloomed we render a faint placeholder here; real bloom is rendered in the overlay. */}
                {m === "bloom" ? (
                  <div className="w-full h-full rounded-xl" style={{ background: "rgba(200,200,200,0.06)", border: "1px dashed var(--line)" }} />
                ) : (
                  <ItemCard
                    item={it}
                    mode={m}
                    focused={focusedItem?.id === it.id}
                    selected={selection.has(it.id)}
                    aiTouched={!!aiTouched[it.id]}
                    onClick={onItemClick}
                    onDoubleClick={onItemDoubleClick}
                    onPin={onPinItem}
                    onClose={() => closeBloom(it.id)}
                  />
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
      {trails.length > 0 && viewMode === "spatial" && (
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

      {/* ─── Bloom overlay (fixed-position, solid, flex-based layout) ─── */}
      {bloomed.length > 0 && (
        <>
          <div className="sv2-scrim" onClick={() => setBloomedIds([])} />
          <div
            className={`sv2-bloom-stage count-${Math.min(bloomed.length, 3)}`}
            onMouseDown={(e) => {
              // Clicking the stage background (not a pane) closes all.
              if (e.target === e.currentTarget) setBloomedIds([]);
            }}
          >
            {bloomed.length <= 2 && bloomed.map((it, idx) => (
              <div
                key={it.id}
                data-bloom-editor="1"
                className="sv2-bloom-slot"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    e.stopPropagation();
                    setBloomedIds((bs) => [it.id, ...bs.filter((x) => x !== it.id)]);
                  }
                }}
              >
                <ItemCard
                  item={it}
                  mode="bloom"
                  aiTouched={!!aiTouched[it.id]}
                  bloomPrimary={idx === 0}
                  onClose={() => closeBloom(it.id)}
                  onPin={onPinItem}
                />
              </div>
            ))}
            {bloomed.length === 3 && (
              <>
                <div
                  key={bloomed[0].id}
                  data-bloom-editor="1"
                  className="sv2-bloom-slot primary"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      e.stopPropagation();
                      setBloomedIds((bs) => [bloomed[0].id, ...bs.filter((x) => x !== bloomed[0].id)]);
                    }
                  }}
                >
                  <ItemCard
                    item={bloomed[0]}
                    mode="bloom"
                    aiTouched={!!aiTouched[bloomed[0].id]}
                    bloomPrimary
                    onClose={() => closeBloom(bloomed[0].id)}
                    onPin={onPinItem}
                  />
                </div>
                <div className="sv2-bloom-slot secondary-col">
                  {[bloomed[1], bloomed[2]].map((it) => (
                    <div
                      key={it.id}
                      data-bloom-editor="1"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) {
                          e.stopPropagation();
                          setBloomedIds((bs) => [it.id, ...bs.filter((x) => x !== it.id)]);
                        }
                      }}
                    >
                      <ItemCard
                        item={it}
                        mode="bloom"
                        aiTouched={!!aiTouched[it.id]}
                        bloomPrimary={false}
                        onClose={() => closeBloom(it.id)}
                        onPin={onPinItem}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Chrome */}
      <TopRail
        workspace={currentTerritory}
        zoom={zoom}
        trayCount={selection.size + pinned.length}
        viewMode={viewMode}
        widgetsHidden={widgetsHidden}
        theme={theme}
        onViewMode={setViewMode}
        onOpenTray={() => setTrayOpen((v) => !v)}
        onHome={goToAtlas}
        onAtlas={goToAtlas}
        onSpotlight={() => setSpotOpen(true)}
        onToggleWidgets={() => setWidgetsHidden((h) => !h)}
        onAddWidget={addWidget}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onOpenInfo={() => setInfoOpen(true)}
      />

      <AtlasStrip
        territories={territories}
        current={currentTerritory?.id ?? null}
        onPick={goToWorkspace}
        onCreate={async () => {
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

      {/* Floating widgets (fixed position — outside canvas transform) */}
      {!widgetsHidden &&
        widgets.map((w) => (
          <FloatingWidget
            key={w.id}
            widget={w}
            onMove={moveWidget}
            onClose={closeWidget}
            onToggleCollapsed={toggleWidgetCollapsed}
            onTimerToggle={toggleTimer}
            onTimerReset={resetTimer}
            aiTouched={!!aiTouched[w.id]}
            onAsk={(text) => handleSendMessage(text)}
            onExpandEdit={(id) => setEditingWidgetId(id)}
          />
        ))}

      {/* Widget deep-edit bloom */}
      {editingWidgetId && (() => {
        const w = widgets.find((ww) => ww.id === editingWidgetId);
        if (!w) return null;
        return (
          <>
            <div className="sv2-scrim" onClick={() => setEditingWidgetId(null)} />
            <div
              className="sv2-bloom-stage count-1"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingWidgetId(null); }}
            >
              <div className="sv2-bloom-slot">
                <WidgetBloom
                  widget={w}
                  onClose={() => setEditingWidgetId(null)}
                  onTimerToggle={toggleTimer}
                  onTimerReset={resetTimer}
                  onAsk={(text) => handleSendMessage(text)}
                />
              </div>
            </div>
          </>
        );
      })()}

      <Tray
        open={trayOpen || selection.size > 0}
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
        bloomedCount={bloomedIds.length}
        resultIsland={resultIsland}
        quickStarts={QUICK_STARTS}
        onSubmit={handleSendMessage}
        onDismissResult={() => setResultIsland(null)}
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
              { id: "_div1", label: "", icon: "dots" as const, run: () => {} },
              { id: "w-planner", label: "Add Planner widget", icon: "planner" as const, run: () => { setCtx(null); addWidget("planner"); } },
              { id: "w-timer", label: "Add Timer widget", icon: "timer" as const, run: () => { setCtx(null); addWidget("timer"); } },
              { id: "w-scratch", label: "Add Scratchpad widget", icon: "note" as const, run: () => { setCtx(null); addWidget("scratch"); } },
              { id: "w-today", label: "Add Today widget", icon: "schedule" as const, run: () => { setCtx(null); addWidget("today"); } },
              { id: "w-library", label: "Add Library widget", icon: "reading" as const, run: () => { setCtx(null); addWidget("library"); } },
              { id: "w-calendar", label: "Add Calendar widget", icon: "schedule" as const, run: () => { setCtx(null); addWidget("calendar"); } },
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

      {/* Focused hint */}
      {focusedItem && bloomedIds.length === 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 top-[96px] z-10 pointer-events-none sv2-drift-in">
          <div className="sv2-chip" style={{ background: "var(--paper)" }}>
            <span style={{ color: focusedItem.color }}>
              <Icon name={KIND_META[focusedItem.kind as V2Kind].icon} size={10} />
            </span>
            Focused · <span className="sv2-kbd ml-1">Space</span> to open · <span className="sv2-kbd">Tab</span> next
          </div>
        </div>
      )}

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
                  Scroll pan · ⌘ Scroll zoom · Space bloom · Tab cycle · ⌘K spotlight
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
