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
  WidgetLauncher,
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
  useTimerTick,
  type FloatingWidgetData,
  type WidgetKind,
} from "./widgets";
import { Icon, type IconName } from "./icons";
import {
  buildV2Graph,
  KIND_META,
  QUICK_STARTS,
  TIERS,
  V2_LAYOUT,
  ZOOM_MAX,
  ZOOM_MIN,
  type V2Item,
  type V2Kind,
  type V2Territory,
} from "./data";
import {
  createCommandResult,
  createWorkspaceWidget,
  updateCommandResult,
  useWorkspaceData,
  useWorkspacePageData,
  updateWorkspaceWidget,
  updateWorkspace,
} from "@/hooks/use-workspace-data";
import {
  notifyWorkspaceContentMutated,
} from "@/lib/workspace/events";
import type {
  WorkspaceData,
  WorkspaceItemData,
} from "@/lib/workspace/contracts";
import { useChatPanel } from "@/hooks/use-chat-panel";
import type { ChatStreamEvent } from "@/lib/chat/streaming";
import type { RouteTrace } from "@/types";

import { UnifiedPanel } from "@/components/chat/unified-panel";

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

const DEMO_NOW = 1_760_000_000_000;

const DEMO_WORKSPACES: WorkspaceData[] = [
  {
    id: "demo-bio",
    name: "Biology",
    emoji: "🧬",
    status: "active",
    itemCount: 5,
    lastActivity: DEMO_NOW - 3_600_000,
    items: [
      { id: "b1", workspaceId: "demo-bio", title: "Glycolysis pathway", preview: "10 steps from glucose to pyruvate — ATP yields and regulation.", itemType: "note", status: "active", meta: "2h ago", updatedAt: DEMO_NOW - 7_200_000 },
      { id: "b2", workspaceId: "demo-bio", title: "Midterm review flashcards", preview: "45 cards across cell bio, genetics, metabolism.", itemType: "flashcard_deck", status: "active", meta: "yesterday", updatedAt: DEMO_NOW - 86_400_000 },
      { id: "b3", workspaceId: "demo-bio", title: "Krebs cycle diagram", preview: "Mermaid-style diagram of citric acid cycle intermediates.", itemType: "visual", status: "active", meta: "3d ago", updatedAt: DEMO_NOW - 3 * 86_400_000 },
      { id: "b4", workspaceId: "demo-bio", title: "Practice problem set 3", preview: "Stoichiometry & enzyme kinetics — 12 problems.", itemType: "export", status: "active", meta: "1d ago", updatedAt: DEMO_NOW - 86_400_000 },
      { id: "b5", workspaceId: "demo-bio", title: "Midterm · Thu 9am", preview: "Chapters 4-9. Proctored, closed notes.", itemType: "planner", status: "active", meta: "due Thu", updatedAt: DEMO_NOW - 1_800_000 },
    ],
  },
  {
    id: "demo-eng",
    name: "English",
    emoji: "📖",
    status: "active",
    itemCount: 4,
    lastActivity: DEMO_NOW - 2 * 3_600_000,
    items: [
      { id: "e1", workspaceId: "demo-eng", title: "Gatsby essay draft", preview: "Distance as unavailability — thesis strong, §3 transition weak.", itemType: "note", status: "active", meta: "1h ago", updatedAt: DEMO_NOW - 3_600_000 },
      { id: "e2", workspaceId: "demo-eng", title: "Chapter 5 passage analysis", preview: "Reunion scene — close reading on restoration and artifice.", itemType: "export", status: "active", meta: "2d ago", updatedAt: DEMO_NOW - 2 * 86_400_000 },
      { id: "e3", workspaceId: "demo-eng", title: "Counter-argument thread", preview: "Q: Is Nick a reliable narrator?", itemType: "thread", status: "active", meta: "4h ago", updatedAt: DEMO_NOW - 4 * 3_600_000 },
      { id: "e4", workspaceId: "demo-eng", title: "Essay due · Fri", preview: "1500 words, MLA, one outside source.", itemType: "planner", status: "active", meta: "due Fri", updatedAt: DEMO_NOW - 7_200_000 },
    ],
  },
  {
    id: "demo-calc",
    name: "Calculus",
    emoji: "∫",
    status: "active",
    itemCount: 4,
    lastActivity: DEMO_NOW - 5 * 3_600_000,
    items: [
      { id: "c1", workspaceId: "demo-calc", title: "Pset 7 — IBP & trig sub", preview: "Problems 1–8. Stuck on Q4 (∫ arctan x dx).", itemType: "export", status: "active", meta: "5h ago", updatedAt: DEMO_NOW - 5 * 3_600_000 },
      { id: "c2", workspaceId: "demo-calc", title: "Integration techniques notes", preview: "Substitution, IBP, partial fractions, trig subs.", itemType: "note", status: "active", meta: "today", updatedAt: DEMO_NOW - 1_800_000 },
      { id: "c3", workspaceId: "demo-calc", title: "Weekly review flashcards", preview: "Limit laws, derivative rules, integration shortcuts.", itemType: "flashcard_deck", status: "active", meta: "2d ago", updatedAt: DEMO_NOW - 2 * 86_400_000 },
      { id: "c4", workspaceId: "demo-calc", title: "Spanish subjunctive deck", preview: "20 cards — dudo que, es posible que, ojalá…", itemType: "flashcard_deck", status: "active", meta: "3d ago", updatedAt: DEMO_NOW - 3 * 86_400_000 },
    ],
  },
];

const WORLD_SIZE = { w: 6000, h: 4400 };

type LayoutSection = {
  key: string;
  label: string;
  color: string;
  items: V2Item[];
};

type PlacedSection = LayoutSection & { y: number; h: number; x: number; w: number };

type TerritoryLayout = {
  positions: Record<string, { x: number; y: number }>;
  sections: PlacedSection[];
  minX: number;
  maxX: number;
  contentBottom: number;
};

type TopicSignal = {
  topic?: string;
  itemCount?: number;
  plannerCount?: number;
  chatCount?: number;
  resultCount?: number;
  latestTimestamp?: number;
  overdueCount?: number;
  unresolvedCount?: number;
  state?: string;
};

const TOPIC_SECTION_TONES = ["#20b8b2", "#0e8ee8", "#b67616", "#148f5d", "#e05137", "#6b5f52"] as const;

function normalizeTopicLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTopicKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function itemUpdatedAt(item: V2Item): number {
  if (typeof item.meta?.updatedAt === "number") return item.meta.updatedAt;
  return 0;
}

/* ─── Stopwords + tokenizer for "by topic" TF-IDF ─── */
const TOPIC_STOPWORDS = new Set([
  // base
  "this", "that", "with", "from", "have", "will", "been", "what", "when", "where", "which",
  "your", "more", "also", "some", "they", "their", "about", "these", "would", "could",
  "should", "there", "other", "after", "before", "during", "study", "notes", "review",
  "flashcard", "flashcards", "cards", "deck", "items", "item", "draft", "practice",
  // expanded per spec
  "make", "using", "based", "through", "across", "within", "every", "first", "second",
  "third", "great", "better", "still", "even", "just", "much", "many", "into", "onto",
  "over", "under", "because", "while", "then", "than", "only", "really", "however",
  "though",
]);

function tokenizeTopic(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !TOPIC_STOPWORDS.has(w) && Number.isNaN(Number(w)));
}

function foldPlural(token: string, allTokens: Set<string>): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    const singular = token.slice(0, -1);
    if (allTokens.has(singular)) return singular;
  }
  return token;
}

function computeSemanticTopicSections(items: V2Item[], topicSignals?: TopicSignal[] | null): LayoutSection[] {
  // ── 1. Backend topicCluster signal (primary) ──
  const itemsByCluster = new Map<string, V2Item[]>();
  items.forEach((item) => {
    const cluster = typeof item.meta?.topicCluster === "string" ? item.meta.topicCluster : "";
    const key = cluster ? normalizeTopicKey(cluster) : "";
    if (!key) return;
    const bucket = itemsByCluster.get(key) ?? [];
    bucket.push(item);
    itemsByCluster.set(key, bucket);
  });

  if (itemsByCluster.size > 0) {
    const normalizedSignals = (topicSignals ?? [])
      .filter((signal): signal is TopicSignal & { topic: string } => typeof signal?.topic === "string" && signal.topic.trim().length > 0)
      .map((signal) => ({ ...signal, topic: normalizeTopicKey(signal.topic) }));
    const signalByTopic = new Map(normalizedSignals.map((signal) => [signal.topic, signal]));
    const keys = Array.from(itemsByCluster.keys());
    const sections = keys
      .map((topic, index) => {
        const sectionItems = [...(itemsByCluster.get(topic) ?? [])].sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a) || a.title.localeCompare(b.title));
        const signal = signalByTopic.get(topic);
        const score =
          sectionItems.length * 5 +
          (signal?.itemCount ?? 0) * 4 +
          (signal?.plannerCount ?? 0) * 3 +
          (signal?.chatCount ?? 0) * 2 +
          (signal?.resultCount ?? 0) * 2 +
          (signal?.overdueCount ?? 0) * 3 +
          (signal?.unresolvedCount ?? 0) * 2;
        return {
          key: topic,
          label: normalizeTopicLabel(signal?.topic ?? topic),
          color: TOPIC_SECTION_TONES[index % TOPIC_SECTION_TONES.length],
          items: sectionItems,
          score,
          latestTimestamp: Math.max(signal?.latestTimestamp ?? 0, ...sectionItems.map(itemUpdatedAt)),
        };
      })
      .filter((section) => section.items.length > 0)
      .sort((a, b) => b.score - a.score || b.latestTimestamp - a.latestTimestamp || a.label.localeCompare(b.label))
      .map(({ key, label, color, items: sectionItems }) => ({ key, label, color, items: sectionItems }));
    if (sections.length > 0) return sections;
  }

  // ── 2. Low-count fallback: just group by kind ──
  if (items.length < 4) {
    const buckets = new Map<string, V2Item[]>();
    items.forEach((item) => {
      const label = KIND_META[item.kind]?.label ?? normalizeTopicLabel(item.kind);
      const bucket = buckets.get(label) ?? [];
      bucket.push(item);
      buckets.set(label, bucket);
    });
    return Array.from(buckets.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([label, sectionItems], index) => ({
        key: `kind-${label.toLowerCase()}`,
        label,
        color: TOPIC_SECTION_TONES[index % TOPIC_SECTION_TONES.length],
        items: [...sectionItems].sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a) || a.title.localeCompare(b.title)),
      }));
  }

  // ── 3. TF-IDF-like scoring over title/preview/body ──
  // Collect global token universe for plural folding.
  const globalTokens = new Set<string>();
  const perItemTokens: Array<{ item: V2Item; unigrams: Map<string, number>; bigrams: Map<string, number>; surface: Map<string, string> }> = [];
  items.forEach((item) => {
    const sources: Array<{ text: string; weight: number }> = [
      { text: item.title ?? "", weight: 2.0 },
      { text: item.preview ?? "", weight: 1.0 },
      { text: item.body ?? "", weight: 0.5 },
    ];
    const unigrams = new Map<string, number>();
    const bigrams = new Map<string, number>();
    const surface = new Map<string, string>();
    sources.forEach(({ text, weight }) => {
      if (!text) return;
      const rawWords = text.split(/\s+/).filter(Boolean);
      const tokens = tokenizeTopic(text);
      tokens.forEach((t) => globalTokens.add(t));
      // Track surface form from the title only (weight 2.0 sources first).
      if (weight >= 2.0) {
        rawWords.forEach((raw) => {
          const clean = raw.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
          if (clean && !surface.has(clean)) surface.set(clean, raw.replace(/[^\p{L}\p{N}]/gu, ""));
        });
      }
      tokens.forEach((t) => unigrams.set(t, (unigrams.get(t) ?? 0) + weight));
      for (let i = 0; i < tokens.length - 1; i += 1) {
        const bg = `${tokens[i]} ${tokens[i + 1]}`;
        bigrams.set(bg, (bigrams.get(bg) ?? 0) + weight);
      }
    });
    perItemTokens.push({ item, unigrams, bigrams, surface });
  });

  // Fold plurals: merge counts into singular.
  const foldedPerItem = perItemTokens.map(({ item, unigrams, bigrams, surface }) => {
    const folded = new Map<string, number>();
    unigrams.forEach((count, token) => {
      const key = foldPlural(token, globalTokens);
      folded.set(key, (folded.get(key) ?? 0) + count);
    });
    return { item, unigrams: folded, bigrams, surface };
  });

  // Per-term: score = sum(weight × count) across items that contain it; itemSet.
  type TermStat = { term: string; score: number; itemIds: Set<string> };
  const termStats = new Map<string, TermStat>();
  const recordTerm = (term: string, score: number, itemId: string) => {
    const entry = termStats.get(term) ?? { term, score: 0, itemIds: new Set<string>() };
    entry.score += score;
    entry.itemIds.add(itemId);
    termStats.set(term, entry);
  };
  foldedPerItem.forEach(({ item, unigrams, bigrams }) => {
    unigrams.forEach((score, term) => recordTerm(term, score, item.id));
    bigrams.forEach((score, term) => recordTerm(term, score, item.id));
  });

  // Filter: each term must have ≥ 2 items.
  const candidates = Array.from(termStats.values())
    .filter((t) => t.itemIds.size >= 2)
    .sort((a, b) => b.score - a.score || b.itemIds.size - a.itemIds.size || a.term.localeCompare(b.term))
    .slice(0, 12);

  // Merge near-duplicate topics (Jaccard ≥ 0.6): keep higher-scoring one.
  const kept: TermStat[] = [];
  candidates.forEach((cand) => {
    let merged = false;
    for (const existing of kept) {
      const intersection = new Set(Array.from(cand.itemIds).filter((id) => existing.itemIds.has(id)));
      const union = new Set([...cand.itemIds, ...existing.itemIds]);
      const jaccard = intersection.size / union.size;
      if (jaccard >= 0.6) {
        // existing has higher/equal score (came first); discard cand.
        merged = true;
        break;
      }
    }
    if (!merged) kept.push(cand);
  });

  // Greedy-assign items: terms claim items not yet in a larger section.
  const claimed = new Set<string>();
  const assigned: Array<{ term: TermStat; items: V2Item[] }> = [];
  kept.forEach((term) => {
    const available = items.filter((item) => term.itemIds.has(item.id) && !claimed.has(item.id));
    if (available.length < 2) return;
    available.forEach((item) => claimed.add(item.id));
    assigned.push({ term, items: available });
  });

  // Cap at 6 sections; sort by (count desc, score desc, label asc).
  // Build surface labels — most-frequent title-cased form seen across section items.
  const surfaceByItemId = new Map(foldedPerItem.map(({ item, surface }) => [item.id, surface]));
  const labelForTerm = (term: string, sectionItems: V2Item[]): string => {
    // For bigrams, join two surfaces; for unigrams, most-common title-surface.
    const parts = term.split(" ");
    const surfaces = parts.map((part) => {
      const counts = new Map<string, number>();
      sectionItems.forEach((it) => {
        const map = surfaceByItemId.get(it.id);
        const s = map?.get(part);
        if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
      });
      const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      return best ?? part;
    });
    return normalizeTopicLabel(surfaces.join(" "));
  };

  const sections: LayoutSection[] = assigned
    .sort((a, b) => b.items.length - a.items.length || b.term.score - a.term.score || a.term.term.localeCompare(b.term.term))
    .slice(0, 6)
    .map(({ term, items: sectionItems }, index) => ({
      key: `tfidf-${term.term.replace(/\s+/g, "-")}`,
      label: labelForTerm(term.term, sectionItems),
      color: TOPIC_SECTION_TONES[index % TOPIC_SECTION_TONES.length],
      items: [...sectionItems].sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a) || a.title.localeCompare(b.title)),
    }));

  // Trailing "Other" section for unclaimed items.
  const leftovers = items.filter((item) => !claimed.has(item.id));
  if (leftovers.length > 0) {
    sections.push({
      key: "other",
      label: "Other",
      color: "var(--ink-300)",
      items: [...leftovers].sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a) || a.title.localeCompare(b.title)),
    });
  }

  return sections;
}

type RuntimeRunState = {
  startedAt: number;
  prompt: string;
  targetIds: Set<string>;
  lastSummary?: string;
  routeTrace?: RouteTrace;
  failed?: string;
  aborted?: boolean;
};

function collectRuntimeTargetIds(payload: unknown, sink: Set<string>, depth = 0) {
  if (!payload || depth > 4) return;
  if (typeof payload === "string") {
    sink.add(payload);
    return;
  }
  if (Array.isArray(payload)) {
    payload.forEach((entry) => collectRuntimeTargetIds(entry, sink, depth + 1));
    return;
  }
  if (typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  const direct = ["artifactId", "chatId", "plannerItemId", "targetId", "itemId", "workspaceItemId"];
  direct.forEach((key) => {
    if (typeof record[key] === "string" && record[key]) sink.add(record[key] as string);
  });
  if (Array.isArray(record.targetIds)) {
    record.targetIds.forEach((entry) => {
      if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
        sink.add((entry as { id: string }).id);
      }
    });
  }
  Object.values(record).forEach((value) => {
    if (value && (typeof value === "object" || Array.isArray(value))) {
      collectRuntimeTargetIds(value, sink, depth + 1);
    }
  });
}

function runtimePhaseLabel(event: ChatStreamEvent): string | null {
  if (event.type === "phase" && typeof event.phase === "string") {
    if (event.phase === "routing") return "Routing workspace request…";
    if (event.phase === "searching") return "Searching workspace context…";
    if (event.phase === "thinking") return "Thinking…";
    if (event.phase === "generating") return "Generating response…";
    if (event.phase === "synthesizing") return "Synthesizing result…";
    if (event.phase === "compacting") return "Compacting context…";
    return null;
  }
  if (event.type !== "phase_update") return null;
  const status = typeof event.status === "string" ? event.status : "";
  if (status !== "in_progress") return null;
  const phaseId = typeof (event as Record<string, unknown>).phaseId === "string"
    ? String((event as Record<string, unknown>).phaseId).toLowerCase()
    : "";
  if (phaseId.includes("route")) return "Routing workspace request…";
  if (phaseId.includes("search")) return "Searching workspace context…";
  if (phaseId.includes("compact")) return "Compacting context…";
  if (phaseId.includes("author") || phaseId.includes("compose") || phaseId.includes("write")) return "Drafting output…";
  if (phaseId.includes("synth") || phaseId.includes("verif") || phaseId.includes("repair")) return "Finalizing…";
  return "Thinking…";
}

function compactRuntimeSummary(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 132 ? `${normalized.slice(0, 129)}…` : normalized;
}

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
  const [commandProcessing, setCommandProcessing] = useState(false);
  const [pendingOpenSourceId, setPendingOpenSourceId] = useState<string | null>(null);
  const [artifactBlueprintPendingKind, setArtifactBlueprintPendingKind] = useState<"note" | "task" | "thread" | "visual" | "code" | null>(null);
  const runtimeRunRef = useRef<RuntimeRunState | null>(null);

  const handleWorkspaceRuntimeEvent = useCallback((event: ChatStreamEvent) => {
    const activeRun = runtimeRunRef.current;
    if (!activeRun) return;

    const phaseLabel = runtimePhaseLabel(event);
    if (phaseLabel) {
      setResultIsland((current) => ({
        status: "streaming",
        text: phaseLabel,
        routeTrace: activeRun.routeTrace ?? current?.routeTrace,
      }));
    }

    if ((event.type === "route_model" || event.type === "done") && event.routeTrace) {
      activeRun.routeTrace = event.routeTrace as RouteTrace;
      setResultIsland((current) => ({
        status: current?.status === "pending" ? "streaming" : (current?.status ?? "streaming"),
        text: current?.text ?? "Thinking…",
        routeTrace: activeRun.routeTrace,
      }));
    }

    if (event.type === "tool_result") {
      collectRuntimeTargetIds(event.result, activeRun.targetIds);
      if (typeof event.summary === "string" && event.summary.trim().length > 0) {
        activeRun.lastSummary = compactRuntimeSummary(event.summary);
        setResultIsland((current) => ({
          status: "running",
          text: activeRun.lastSummary ?? current?.text ?? "Applying workspace action…",
          routeTrace: activeRun.routeTrace ?? current?.routeTrace,
        }));
      }
    }

    if (event.type === "done" && typeof event.content === "string" && event.content.trim().length > 0) {
      activeRun.lastSummary = compactRuntimeSummary(event.content);
    }

    if (event.type === "error") {
      if (typeof event.error === "string") {
        activeRun.failed = event.error;
        return;
      }
      const payload = event.error as Record<string, unknown> | undefined;
      activeRun.failed = typeof payload?.message === "string" ? payload.message : "Workspace action failed.";
    }
  }, []);

  /* ─── Widgets — positions from localStorage (loaded after mount to avoid SSR mismatch) ─── */
  const WIDGET_LS_KEY = "spectra-v2:widget-layout";
  type PersistedWidget = { x: number; y: number; collapsed: boolean; hidden?: boolean; collapseAnchor?: "left" | "right" };
  const loadWidgetLayout = (): Record<string, PersistedWidget> => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(WIDGET_LS_KEY);
      if (!raw) return {};
      const parsed: Record<string, { x?: number; y?: number; collapsed?: boolean; hidden?: boolean; collapseAnchor?: string }> = JSON.parse(raw);
      const result: Record<string, PersistedWidget> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v?.x === "number" && typeof v?.y === "number") {
          const anchor = v.collapseAnchor === "left" || v.collapseAnchor === "right" ? v.collapseAnchor : undefined;
          result[k] = { x: v.x, y: v.y, collapsed: v.collapsed ?? false, hidden: v.hidden ?? false, collapseAnchor: anchor };
        }
      }
      return result;
    } catch { return {}; }
  };
  const saveWidgetLayout = (ws: FloatingWidgetData[]) => {
    if (typeof window === "undefined") return;
    try {
      const positions: Record<string, PersistedWidget> = {};
      ws.forEach((w) => {
        positions[w.id] = {
          x: w.x,
          y: w.y,
          collapsed: w.collapsed ?? false,
          hidden: Boolean((w.state as Record<string, unknown>).hidden),
          collapseAnchor: w.collapseAnchor,
        };
      });
      localStorage.setItem(WIDGET_LS_KEY, JSON.stringify(positions));
    } catch { /* ignore */ }
  };
  const WIDGET_DEFAULTS: FloatingWidgetData[] = [
    { id: "w-timer",     kind: "timer",     x: 16, y: 84,  w: 288, h: 132, collapsed: false, state: { secs: 25 * 60, running: false, totalSecs: 25 * 60 } },
    { id: "w-today",     kind: "today",     x: 16, y: 238, w: 296, h: 230, collapsed: true, state: {} },
    { id: "w-planner",   kind: "planner",   x: 16, y: 318, w: 300, h: 278, collapsed: true, state: {} },
    { id: "w-timetable", kind: "timetable", x: 16, y: 398, w: 308, h: 248, collapsed: true, state: {} },
    { id: "w-scratch",   kind: "scratch",   x: 9999, y: 9999, w: 304, h: 232, collapsed: true, collapseAnchor: "right", state: {} },
    { id: "w-thread",    kind: "thread",    x: 9999, y: 8000, w: 340, h: 320, collapsed: true, collapseAnchor: "right", state: {} },
    { id: "w-artifact",  kind: "artifact",  x: 9999, y: 6000, w: 380, h: 300, collapsed: false, collapseAnchor: "right", state: {} },
  ];
  // Init with plain defaults (no localStorage read here → avoids SSR hydration mismatch)
  const [widgets, setWidgets] = useState<FloatingWidgetData[]>(WIDGET_DEFAULTS);

  // After mount, load saved positions from localStorage
  useEffect(() => {
    const saved = loadWidgetLayout();
    if (Object.keys(saved).length > 0) {
      setWidgets((prev) => prev.map((w) => {
        const p = saved[w.id];
        return p ? { ...w, x: p.x, y: p.y, collapsed: p.collapsed, collapseAnchor: p.collapseAnchor, state: { ...w.state, hidden: p.hidden ?? false } } : w;
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
    | { type: "pan"; sx: number; sy: number; px: number; py: number; nx: number; ny: number }
    | { type: "lasso"; wx0: number; wy0: number }
    | null
  >(null);

  /* ─── Viewport size tracking (SSR-safe; populated after mount to avoid hydration drift) ─── */
  const [vpSize, setVpSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  /** Tracks whether the client has mounted. Server and first-client paints must match, so
   *  anything that depends on viewport-derived values is disabled until `mounted === true`. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setVpSize({ w: window.innerWidth, h: window.innerHeight });
    const onR = () => setVpSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  const clampWidgetPosition = useCallback((x: number, y: number, width: number, height: number) => ({
    x: Math.max(16, Math.min(vpSize.w - width - 16, x)),
    y: Math.max(84, Math.min(vpSize.h - height - 20, y)),
  }), [vpSize.h, vpSize.w]);

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
  }, [setViewMode]);

  /* ─── Committed workspace from camera center ─── */
  const [committedWorkspaceId, setCommittedWorkspaceId] = useState<string | null>(null);
  const {
    workspaces: live,
    commandResultCards,
    isLive,
    refresh,
  } = useWorkspaceData(committedWorkspaceId);
  const { widgets: liveWidgets, signals: activeWorkspaceSignals } = useWorkspacePageData(committedWorkspaceId);
  const workspaceRuntime = useChatPanel({
    workstreamId: committedWorkspaceId ?? undefined,
    threadType: "conversation",
    mode: "tutor",
    thinkingLevel: "low",
    routerMode: "auto",
    scopeLevel: "workspace",
    onStreamEvent: handleWorkspaceRuntimeEvent,
  });
  const runtimeWorkspaceRef = useRef<string | null>(committedWorkspaceId);

  useEffect(() => {
    if (runtimeWorkspaceRef.current === committedWorkspaceId) return;
    runtimeWorkspaceRef.current = committedWorkspaceId;
    runtimeRunRef.current = null;
    workspaceRuntime.reset();
  }, [committedWorkspaceId, workspaceRuntime.reset]);

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
      state: { ...(widget.state ?? {}), hidden: false },
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

  const topicSignalsByWorkspace = useMemo(() => {
    const map = new Map<string, TopicSignal[]>();
    if (committedWorkspaceId && activeWorkspaceSignals?.topicSignals?.length) {
      map.set(`terr-${committedWorkspaceId}`, activeWorkspaceSignals.topicSignals);
    }
    return map;
  }, [activeWorkspaceSignals, committedWorkspaceId]);

  /* ─── Timeline Buckets ─── */
  const timelineBucketsFor = useCallback((items: V2Item[]) => {
    const now = Date.now();
    const buckets: { label: string; until: number; since: number; items: V2Item[] }[] = [
      { label: "Today", until: now, since: now - 86_400_000, items: [] },
      { label: "Yesterday", until: now - 86_400_000, since: now - 2 * 86_400_000, items: [] },
      { label: "Last week", until: now - 2 * 86_400_000, since: now - 7 * 86_400_000, items: [] },
      { label: "Earlier this month", until: now - 7 * 86_400_000, since: now - 30 * 86_400_000, items: [] },
      { label: "Older", until: now - 30 * 86_400_000, since: 0, items: [] },
    ];
    items.forEach((it) => {
      const ts = (it.meta?.updatedAt as number) ?? 0;
      const bucket = buckets.find((candidate) => ts <= candidate.until && ts > candidate.since) ?? buckets[buckets.length - 1];
      bucket.items.push(it);
    });
    buckets.forEach((bucket) => bucket.items.sort((a, z) => ((z.meta?.updatedAt as number) ?? 0) - ((a.meta?.updatedAt as number) ?? 0)));
    return buckets.filter((bucket) => bucket.items.length > 0);
  }, []);

  const buildTerritoryLayout = useCallback((territory: V2Territory, wsItems: V2Item[]): TerritoryLayout => {
    const positions: Record<string, { x: number; y: number }> = {};
    const sections: Array<LayoutSection & { y: number; h: number; x: number; w: number }> = [];
    const {
      itemW: ITEM_W,
      itemH: ITEM_H,
      gapX: GAP_X,
      gapY: GAP_Y,
      sectionGap: GROUP_GAP_Y,
      sectionGapX: GROUP_GAP_X,
      sidePad,
    } = V2_LAYOUT;
    const usableW = Math.max(ITEM_W, territory.w - sidePad * 2);
    const maxCols = Math.max(1, Math.min(V2_LAYOUT.maxCols, Math.floor((usableW + GAP_X) / (ITEM_W + GAP_X))));
    const leftBound = territory.cx - territory.w / 2 + sidePad;
    const rightBound = territory.cx + territory.w / 2 - sidePad;

    const createSection = (key: string, label: string, color: string, items: V2Item[]): LayoutSection => ({ key, label, color, items });

    const sectionsToRender: LayoutSection[] =
      viewMode === "type"
        ? Object.entries(wsItems.reduce<Record<string, V2Item[]>>((acc, item) => {
            (acc[item.kind] = acc[item.kind] ?? []).push(item);
            return acc;
          }, {})).map(([key, items]) => createSection(key, KIND_META[key as V2Kind]?.label ?? key, KIND_META[key as V2Kind]?.tone ?? "var(--ink-400)", items))
        : viewMode === "topic"
          ? computeSemanticTopicSections(wsItems, topicSignalsByWorkspace.get(territory.id))
          : timelineBucketsFor(wsItems).map((bucket) => createSection(bucket.label, bucket.label, "var(--ink-300)", bucket.items));

    // Step 1: compute each section's intrinsic width (columns) and height (rows).
    const sized = sectionsToRender
      .filter((s) => s.items.length > 0)
      .map((section) => {
        // Target columns based on section size. Small sections stay narrow so
        // they can pack side-by-side. Large ones expand up to maxCols.
        const desired = section.items.length <= 2
          ? section.items.length
          : section.items.length <= 4
            ? 2
            : Math.min(maxCols, Math.ceil(Math.sqrt(section.items.length)));
        const cols = Math.max(1, Math.min(maxCols, desired));
        const rows = Math.max(1, Math.ceil(section.items.length / cols));
        const w = cols * ITEM_W + Math.max(0, cols - 1) * GAP_X;
        const h = rows * ITEM_H + Math.max(0, rows - 1) * GAP_Y;
        return { section, cols, rows, w, h };
      });

    // Step 2: shelf-pack sections into rows. A section fits the current shelf
    // if current shelf width + gap + section width ≤ usableW.
    type Shelf = { items: typeof sized; width: number; height: number };
    const shelves: Shelf[] = [];
    sized.forEach((entry) => {
      const last = shelves[shelves.length - 1];
      const projected = last ? last.width + GROUP_GAP_X + entry.w : entry.w;
      if (last && projected <= usableW) {
        last.items.push(entry);
        last.width = projected;
        last.height = Math.max(last.height, entry.h);
      } else {
        shelves.push({ items: [entry], width: entry.w, height: entry.h });
      }
    });

    // Step 3: place each shelf vertically, each section horizontally centered.
    let yCursor = territory.contentTop;
    let minX = leftBound;
    let maxX = rightBound;
    shelves.forEach((shelf, shelfIdx) => {
      // Center the shelf row within usableW.
      const shelfStartX = territory.cx - shelf.width / 2;
      let xCursor = shelfStartX;
      shelf.items.forEach((entry) => {
        const { section, cols, rows, w: sectionW, h: sectionH } = entry;
        // Clamp x so the section never crosses the territory's side bounds.
        const clampedX = Math.max(leftBound, Math.min(rightBound - sectionW, xCursor));
        // Place items inside this section.
        section.items.forEach((item, index) => {
          const col = index % cols;
          const row = Math.floor(index / cols);
          const x = clampedX + col * (ITEM_W + GAP_X);
          const y = yCursor + row * (ITEM_H + GAP_Y);
          positions[item.id] = { x, y };
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x + ITEM_W);
        });
        sections.push({
          ...section,
          x: clampedX,
          w: sectionW,
          y: yCursor,
          h: sectionH,
          items: section.items,
          key: `${section.key}-${shelfIdx}`,
        });
        xCursor = clampedX + sectionW + GROUP_GAP_X;
        void rows;
      });
      yCursor += shelf.height + GROUP_GAP_Y;
    });

    return {
      positions,
      sections,
      minX,
      maxX,
      contentBottom: Math.max(territory.contentTop, yCursor - GROUP_GAP_Y),
    };
  }, [viewMode, timelineBucketsFor, topicSignalsByWorkspace]);

  /**
   * Two-pass layout:
   * 1. Probe each territory at its base position to learn how tall its packed
   *    content needs to be.
   * 2. Re-flow territories vertically (per atlas row) using required heights so
   *    workspaces never collide. Width is never expanded — that would push into
   *    a neighbor territory in the same row.
   * 3. Re-layout sections against the effective territory (so item positions
   *    track the new cy/contentTop).
   */
  const layoutPass = useMemo(() => {
    if (territories.length === 0) {
      return { effectiveTerritories: territories, layoutByTerritory: {} as Record<string, TerritoryLayout> };
    }
    // Probe heights using base territories.
    const probe: Record<string, TerritoryLayout> = {};
    territories.forEach((t) => {
      const wsItems = baseItems.filter((item) => item.workspaceId === t.id);
      probe[t.id] = buildTerritoryLayout(t, wsItems);
    });

    const bottomPad = V2_LAYOUT.bottomPad;
    const rowGap = V2_LAYOUT.territoryGapY;
    const atlasCols = V2_LAYOUT.atlasCols;

    // Compute required heights.
    const heights = territories.map((t) => {
      const layout = probe[t.id];
      const originalTopOffset = t.contentTop - (t.cy - t.h / 2);
      const requiredContentH = layout
        ? Math.max(t.contentBottom - t.contentTop, layout.contentBottom - t.contentTop)
        : t.contentBottom - t.contentTop;
      const requiredH = Math.max(t.h, originalTopOffset + requiredContentH + bottomPad);
      return { originalTopOffset, requiredH };
    });

    // Group rows.
    const rowsCount = Math.ceil(territories.length / atlasCols);
    const rowHeights: number[] = Array.from({ length: rowsCount }, () => 0);
    territories.forEach((_, idx) => {
      const r = Math.floor(idx / atlasCols);
      rowHeights[r] = Math.max(rowHeights[r], heights[idx].requiredH);
    });
    const totalHeight = rowHeights.reduce((s, h) => s + h, 0) + Math.max(0, rowsCount - 1) * rowGap;

    // Compute new cy for each row.
    const rowYCenters: number[] = [];
    let yCursor = -totalHeight / 2;
    for (let r = 0; r < rowsCount; r += 1) {
      rowYCenters[r] = yCursor + rowHeights[r] / 2;
      yCursor += rowHeights[r] + rowGap;
    }

    const effective: V2Territory[] = territories.map((t, idx) => {
      const { originalTopOffset, requiredH } = heights[idx];
      const r = Math.floor(idx / atlasCols);
      const newH = requiredH;
      const newCy = rowYCenters[r];
      const newContentTop = newCy - newH / 2 + originalTopOffset;
      return {
        ...t,
        h: newH,
        cy: newCy,
        minY: newCy - newH / 2,
        maxY: newCy + newH / 2,
        contentTop: newContentTop,
        contentBottom: newCy + newH / 2 - bottomPad,
      };
    });

    // Re-layout against effective territories so item positions match.
    const final: Record<string, TerritoryLayout> = {};
    effective.forEach((t) => {
      const wsItems = baseItems.filter((item) => item.workspaceId === t.id);
      final[t.id] = buildTerritoryLayout(t, wsItems);
    });

    return { effectiveTerritories: effective, layoutByTerritory: final };
  }, [territories, baseItems, buildTerritoryLayout]);

  const effectiveTerritories = layoutPass.effectiveTerritories;
  const layoutByTerritory = layoutPass.layoutByTerritory;

  /* ─── Derive current territory from pan ─── */
  const currentTerritory = useMemo<V2Territory | null>(() => {
    const cx = -pan.x, cy = -pan.y;
    const hit = effectiveTerritories.find(
      (t) => cx >= t.cx - t.w / 2 && cx <= t.cx + t.w / 2 && cy >= t.cy - t.h / 2 && cy <= t.cy + t.h / 2,
    );
    return hit ?? null;
  }, [pan, effectiveTerritories]);

  useEffect(() => {
    const nextCommit = currentTerritory && zoom > 0.34 ? currentTerritory.sourceId : null;
    if (nextCommit !== committedWorkspaceId) setCommittedWorkspaceId(nextCommit);
  }, [currentTerritory, zoom, committedWorkspaceId]);

  const arranged = useMemo<Record<string, { x: number; y: number }> | null>(() => {
    const coords = Object.values(layoutByTerritory).reduce<Record<string, { x: number; y: number }>>((acc, layout) => {
      Object.assign(acc, layout.positions);
      return acc;
    }, {});
    return Object.keys(coords).length > 0 ? coords : null;
  }, [layoutByTerritory]);

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
  const wheelPanRef = useRef<{ x: number; y: number; active: boolean; timeout: ReturnType<typeof setTimeout> | null }>({ x: 0, y: 0, active: false, timeout: null });

  const onWheel = useCallback((e: React.WheelEvent) => {
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
      if (wheelPanRef.current.active) {
        if (wheelPanRef.current.timeout) clearTimeout(wheelPanRef.current.timeout);
        setPan({ x: wheelPanRef.current.x, y: wheelPanRef.current.y });
        wheelPanRef.current.active = false;
      }
      zoomAt(mx, my, factor);
    } else {
      if (!wheelPanRef.current.active) {
         wheelPanRef.current.x = pan.x;
         wheelPanRef.current.y = pan.y;
         wheelPanRef.current.active = true;
      }
      wheelPanRef.current.x -= e.deltaX / zoom;
      wheelPanRef.current.y -= e.deltaY / zoom;

      if (canvasRef.current) {
        canvasRef.current.style.transform = `translate(${vpSize.w / 2 + wheelPanRef.current.x * zoom}px, ${vpSize.h / 2 + wheelPanRef.current.y * zoom}px) scale(${zoom})`;
      }

      if (wheelPanRef.current.timeout) clearTimeout(wheelPanRef.current.timeout);
      wheelPanRef.current.timeout = setTimeout(() => {
         setPan({ x: wheelPanRef.current.x, y: wheelPanRef.current.y });
         wheelPanRef.current.active = false;
      }, 100);
    }
  }, [zoom, zoomAt, pan.x, pan.y, vpSize]);

  /* ─── Mouse drag: pan OR lasso ─── */
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("[data-widget]")) return;
    if (el.closest("[data-bloom-editor]")) return;
    if (ctx) setCtx(null);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("workspace:close-create-menu"));
    }
    
    const isBackground = el === canvasRef.current || el.closest("[data-canvas-bg]");

    if (e.button === 1 || e.button === 2 || (e.button === 0 && !e.shiftKey && isBackground)) {
      e.preventDefault();
      // Close inspector/artifact panel if clicking on empty canvas
      if (openInspectorId) {
        setOpenInspectorId(null);
      }
      const artifactPanel = widgets.find((w) => w.kind === "artifact");
      if (artifactPanel && !artifactPanel.collapsed && isBackground) {
        toggleWidgetCollapsed(artifactPanel.id);
      }
      dragRef.current = { type: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, nx: pan.x, ny: pan.y };
      setPanning(true);
    } else if (e.button === 0 && e.shiftKey && isBackground) {
      e.preventDefault();
      // Close inspector/artifact panel if clicking on empty canvas
      if (openInspectorId) {
        setOpenInspectorId(null);
      }
      const artifactPanel = widgets.find((w) => w.kind === "artifact");
      if (artifactPanel && !artifactPanel.collapsed && isBackground) {
        toggleWidgetCollapsed(artifactPanel.id);
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wx = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
      const wy = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;
      dragRef.current = { type: "lasso", wx0: wx, wy0: wy };
      setLasso({ x0: wx, y0: wy, x1: wx, y1: wy });
      setSelection(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, openInspectorId, pan.x, pan.y, zoom, widgets]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.type === "pan") {
      const newX = d.px + (e.clientX - d.sx) / zoom;
      const newY = d.py + (e.clientY - d.sy) / zoom;
      d.nx = newX;
      d.ny = newY;
      if (canvasRef.current) {
        canvasRef.current.style.transform = `translate(${vpSize.w / 2 + newX * zoom}px, ${vpSize.h / 2 + newY * zoom}px) scale(${zoom})`;
      }
    } else {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wx = (e.clientX - rect.left - rect.width / 2) / zoom - pan.x;
      const wy = (e.clientY - rect.top - rect.height / 2) / zoom - pan.y;
      setLasso({ x0: d.wx0, y0: d.wy0, x1: wx, y1: wy });
    }
  }, [pan.x, pan.y, zoom, vpSize]);
  const onMouseUp = useCallback(() => {
    const d = dragRef.current;
    if (d?.type === "pan") {
      setPan({ x: d.nx, y: d.ny });
    } else if (d?.type === "lasso" && lasso) {
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
  }, [baseItems, lasso, posOf, selection]);

  /* ─── Navigation helpers ─── */
  const goToWorkspace = (terrId: string) => {
    // Do NOT force viewMode — keep the previous arrangement so items don't jump around
    const t = effectiveTerritories.find((x) => x.id === terrId);
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

  const getBaseItemById = useCallback((id: string | null | undefined) => {
    if (!id) return null;
    return baseItems.find((item) => item.id === id) ?? null;
  }, [baseItems]);

  /* ─── Focused item (nearest to camera center) ─── */
  const centeredFocusedItem = useMemo<V2Item | null>(() => {
    if (zoom < 0.48) return null;
    if (focusedViewOpen) return null;
    
    // Instead of raw pan, use the visually-accurate canvas offset during drag if available
    let cx = -pan.x;
    let cy = -pan.y;
    if (dragRef.current?.type === "pan") {
      cx = -dragRef.current.nx;
      cy = -dragRef.current.ny;
    }

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
  }, [pan, zoom, posOf, baseItems, focusedViewOpen, panning]); // Need `panning` state to trigger re-eval when letting go of drag!

  const deepFocusItem = useMemo<V2Item | null>(() => {
    if (!focusedViewOpen) return null;
    return getBaseItemById(focusViewPrimaryId ?? primaryFocusId ?? focusSetIds[0] ?? null);
  }, [focusSetIds, focusViewPrimaryId, focusedViewOpen, getBaseItemById, primaryFocusId]);

  const highlightedFocusItem = useMemo<V2Item | null>(() => {
    if (selection.size > 0) {
      const selectedId = primaryFocusId ?? focusSetIds[0] ?? Array.from(selection)[0] ?? null;
      return getBaseItemById(selectedId);
    }
    if (buildingFocusSet && focusSetIds.length > 0) {
      return getBaseItemById(primaryFocusId ?? focusSetIds[0] ?? null);
    }
    return null;
  }, [buildingFocusSet, focusSetIds, getBaseItemById, primaryFocusId, selection]);

  const explicitTargetItem = useMemo<V2Item | null>(() => getBaseItemById(openInspectorId), [getBaseItemById, openInspectorId]);

  // Focus weighting: explicit target > opened deep edit > highlighted > centered.
  const focusedItem = explicitTargetItem ?? deepFocusItem ?? highlightedFocusItem ?? centeredFocusedItem;

  const cycleFocus = (dir: 1 | -1) => {
    // Cycle through ALL items
    if (baseItems.length === 0) return;
    let idx = focusedItem ? baseItems.findIndex((i) => i.id === focusedItem.id) : -1;
    idx = (idx + dir + baseItems.length) % baseItems.length;
    const it = baseItems[idx];
    const p = posOf(it);
    setOpenInspectorId(null);
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
      return;
    }

    if (patch.title !== undefined && patch.title.trim() && patch.title !== item.title) {
      if (item.sourceArtifactId) {
        try {
          await fetch("/api/artifacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", artifactId: item.sourceArtifactId, title: patch.title.trim() }),
          });
          refresh();
        } catch {}
      } else if (item.sourcePlannerItemId) {
        try {
          await fetch("/api/planner-items", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plannerItemId: item.sourcePlannerItemId, title: patch.title.trim() }),
          });
          refresh();
        } catch {}
      }
    }
  }, [committedWorkspaceId, isLive, refresh]);

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
      if (!isLive) {
        scheduleIslandDismiss({ status: "error", text: "Live workspace runtime is unavailable.", chips: ["Offline"] });
        return;
      }
      setResultIsland({ status: "pending", text: `Queueing ${kind}…`, chips: [kind] });
      if (kind === "note" || kind === "thread" || kind === "visual" || kind === "code") {
        setArtifactBlueprintPendingKind(kind);
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = rect.width / 2 + (worldX + pan.x) * zoom;
        const screenY = rect.height / 2 + (worldY + pan.y) * zoom;
        const startX = rect.width / 2;
        const startY = rect.height - 56;
        spawnTrail(startX, startY, screenX, screenY);
      }
      setResultIsland({ status: "running", text: `Creating ${kind}…`, chips: [kind] });
      try {
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
            setPendingOpenSourceId(id);
            action = { label: `Open ${kind}`, onClick: () => setPendingOpenSourceId(id) };
          }
        }
        scheduleIslandDismiss({
          status: r.ok ? "done" : "error",
          text: r.ok ? `Created ${kind} here.` : `Could not create ${kind}.`,
          chips: action ? undefined : [kind],
          action,
        });
      } finally {
        setArtifactBlueprintPendingKind((current) => (current === kind ? null : current));
      }
    },
    [committedWorkspaceId, createItemAction, isLive, pan, scheduleIslandDismiss, spawnTrail, zoom],
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
        if (isLive) void updateWorkspaceWidget({ widgetId: existing.id, collapsed: false, hidden: false });
        const next = ws.map((w) => w.id === existing.id ? { ...w, collapsed: false, state: { ...w.state, hidden: false } } : w);
        saveWidgetLayout(next);
        return next;
      }

      const id = `w-${Date.now()}`;
      const sizes: Record<string, { w: number; h: number }> = {
        timer: { w: 288, h: 132 }, planner: { w: 300, h: 278 }, today: { w: 296, h: 230 },
        timetable: { w: 308, h: 248 }, scratch: { w: 304, h: 232 }, calendar: { w: 312, h: 270 },
        thread: { w: 340, h: 320 }, artifact: { w: 380, h: 300 }
      };
      const size = sizes[kind] ?? { w: 288, h: 200 };
      const pos = clampWidgetPosition(position?.x ?? 96, position?.y ?? 96, size.w, size.h);
      const widget: FloatingWidgetData = {
        id,
        kind: (kind as WidgetKind),
        x: pos.x,
        y: pos.y,
        ...size,
        collapsed: false,
        state: kind === "timer" ? { secs: 25 * 60, running: false, hidden: false } : { hidden: false },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampWidgetPosition, isLive, committedWorkspaceId, refresh, widgetsHidden]);

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
        seed(["scratch", "planner", "today"]);
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
      if (!raw || commandProcessing) return;
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

      const requiresLiveRuntime = () => {
        if (!isLive) {
          scheduleIslandDismiss({
            status: "error",
            text: "Live workspace runtime is unavailable.",
            chips: ["Offline"],
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
        if (!requiresWorkspace() || !requiresLiveRuntime()) return;
        const title = raw.slice(6).trim() || "Untitled note";
        setCommandProcessing(true);
        try {
          scheduleIslandDismiss({ status: "pending", text: "Queued…" }, 60000);
          await new Promise((r) => setTimeout(r, 120));
          setResultIsland({ status: "running", text: `Creating note "${title}"…` });
          const r = await createItemAction({ action: "createNote", workstreamId: wsId, title, content: "" });
          if (r.ok) {
            spawnCenterTrail();
          }
          if (r.data?.artifactId) {
            setPendingOpenSourceId(r.data.artifactId);
          }
          scheduleIslandDismiss({
            status: r.ok ? "done" : "error",
            text: r.ok ? `Created note "${title}".` : "Could not create note.",
            action: r.data?.artifactId ? { label: "Open note", onClick: () => setPendingOpenSourceId(r.data.artifactId) } : undefined,
          });
        } finally {
          setCommandProcessing(false);
        }
        return;
      }
      if (raw.startsWith("/task ")) {
        if (!requiresWorkspace() || !requiresLiveRuntime()) return;
        const title = raw.slice(6).trim() || "Untitled task";
        setCommandProcessing(true);
        try {
          setResultIsland({ status: "running", text: `Adding task "${title}"…` });
          const r = await createItemAction({ action: "createPlannerItem", workstreamId: wsId, title, type: "deadline", priority: "medium" });
          if (r.ok) {
            spawnCenterTrail();
          }
          if (r.data?.plannerItemId) {
            setPendingOpenSourceId(r.data.plannerItemId);
          }
          scheduleIslandDismiss({
            status: r.ok ? "done" : "error",
            text: r.ok ? `Added planner task "${title}".` : "Could not add task.",
            action: r.data?.plannerItemId ? { label: "Open task", onClick: () => setPendingOpenSourceId(r.data.plannerItemId) } : undefined,
          });
        } finally {
          setCommandProcessing(false);
        }
        return;
      }
      if (raw.startsWith("/thread ")) {
        if (!requiresWorkspace() || !requiresLiveRuntime()) return;
        const title = raw.slice(8).trim() || "New thread";
        setCommandProcessing(true);
        try {
          setResultIsland({ status: "running", text: `Starting thread "${title}"…` });
          const r = await createItemAction({ action: "createThread", workstreamId: wsId, title });
          if (r.ok) {
            spawnCenterTrail();
          }
          if (r.data?.chatId) {
            setPendingOpenSourceId(r.data.chatId);
          }
          scheduleIslandDismiss({
            status: r.ok ? "done" : "error",
            text: r.ok ? `Started thread "${title}".` : "Could not start thread.",
            action: r.data?.chatId ? { label: "Open thread", onClick: () => setPendingOpenSourceId(r.data.chatId) } : undefined,
          });
        } finally {
          setCommandProcessing(false);
        }
        return;
      }
      if (raw.startsWith("/workspace ")) {
        if (!requiresLiveRuntime()) return;
        const title = raw.slice(11).trim() || "New workspace";
        setCommandProcessing(true);
        try {
          setResultIsland({ status: "running", text: `Creating workspace "${title}"…` });
          const r = await createItemAction({ action: "createWorkspace", title });
          scheduleIslandDismiss({ status: r.ok ? "done" : "error", text: r.ok ? `Created workspace "${title}".` : "Could not create workspace.", chips: ["Workspace"] });
        } finally {
          setCommandProcessing(false);
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
        if (!requiresWorkspace() || !requiresLiveRuntime()) return;
        const workspaceId = wsId;
        if (!workspaceId) return;
        setCommandProcessing(true);
        scheduleIslandDismiss({ status: "streaming", text: `Searching for "${q}"…`, chips: ["Search"] });
        const cr = await createCommandResult({ workstreamId: workspaceId, intent: "result", status: "processing", title: `Search: ${q}`, summary: "Searching…" });
        try {
          const res = await fetch("/api/workspace-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "search", workstreamId: workspaceId, query: q, limit: 8 }),
          });
          const j = res.ok ? await res.json() : null;
          const hits = (j?.results ?? []) as Array<{ title: string }>;
          const summary = hits.length > 0 ? `${hits.length} results found.` : "No matches.";
          if (cr) await updateCommandResult({ resultId: cr.resultId, status: "completed", summary });
          scheduleIslandDismiss({ status: "done", text: summary, chips: hits.slice(0, 3).map((h) => h.title) });
        } catch {
          if (cr) await updateCommandResult({ resultId: cr.resultId, status: "completed", summary: "Search failed." });
          scheduleIslandDismiss({ status: "error", text: "Search failed.", chips: ["Error"] });
        } finally {
          setCommandProcessing(false);
        }
        return;
      }

      // Default → persisted workspace quick action / linked result.
      if (!requiresWorkspace() || !requiresLiveRuntime()) return;
      const scopedPrimaryItem = explicitTargetItem
        ?? (focusedViewOpen
          ? getBaseItemById(focusViewPrimaryId ?? focusSetIds[0] ?? null)
          : focusedItem);
      const scopedSelectionIds = explicitTargetItem
        ? [explicitTargetItem.id]
        : (focusedViewOpen ? focusSetIds : Array.from(selection));
      const touched = scopedSelectionIds.length > 0
        ? scopedSelectionIds
        : scopedPrimaryItem
          ? [scopedPrimaryItem.id]
          : [];
      setCommandProcessing(true);
      runtimeRunRef.current = {
        startedAt: Date.now(),
        prompt: raw,
        targetIds: new Set<string>(),
        routeTrace: workspaceRuntime.latestRouteTrace ?? undefined,
      };
      setResultIsland({
        status: "pending",
        text: "Queued in workspace runtime…",
        chips: scopedPrimaryItem ? [KIND_META[scopedPrimaryItem.kind].label] : undefined,
        routeTrace: workspaceRuntime.latestRouteTrace ?? undefined,
      });
      try {
        await workspaceRuntime.sendMessage(raw);
        refresh();
        const run = runtimeRunRef.current;
        if (!run) return;
        if (run.aborted) {
          setResultIsland(null);
          return;
        }
        if (!run.failed && workspaceRuntime.error) {
          run.failed = workspaceRuntime.error;
        }
        let resolvedTargetId = Array.from(run.targetIds)[0];
        if (!resolvedTargetId && commandResultCards.length > 0) {
          const latestResult = [...commandResultCards]
            .filter((card) => card.targetId && card.createdAt >= run.startedAt - 5_000)
            .sort((a, b) => b.createdAt - a.createdAt)[0];
          if (typeof latestResult?.targetId === "string") {
            resolvedTargetId = latestResult.targetId;
          }
        }
        if (resolvedTargetId) {
          setPendingOpenSourceId(resolvedTargetId);
          spawnCenterTrail();
        }
        const completionText = run.failed
          ? compactRuntimeSummary(run.failed)
          : run.lastSummary || "Workspace runtime completed.";
        scheduleIslandDismiss({
          status: run.failed ? "error" : "done",
          text: completionText,
          routeTrace: run.routeTrace ?? workspaceRuntime.latestRouteTrace ?? undefined,
          action: resolvedTargetId ? { label: "Open result", onClick: () => setPendingOpenSourceId(resolvedTargetId!) } : undefined,
        });
      } catch {
        scheduleIslandDismiss({ status: "error", text: "Workspace action failed.", chips: ["Error"] });
      } finally {
        runtimeRunRef.current = null;
        setCommandProcessing(false);
      }
      if (touched.length) touchAI(touched, raw);
    },
    [addWidget, commandProcessing, commandResultCards, committedWorkspaceId, createItemAction, explicitTargetItem, focusSetIds, focusViewPrimaryId, focusedItem, focusedViewOpen, getBaseItemById, isLive, refresh, runQuickStartScaffold, scheduleIslandDismiss, selection, spawnTrail, touchAI, workspaceRuntime],
  );

  const stopWorkspaceRuntime = useCallback(() => {
    const run = runtimeRunRef.current;
    if (run) run.aborted = true;
    workspaceRuntime.stopGeneration();
    setCommandProcessing(false);
  }, [workspaceRuntime]);

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
      const next = ws.map((w) => {
        if (w.id !== id) return w;
        const pos = clampWidgetPosition(x, y, w.collapsed ? 52 : w.w, w.collapsed ? 52 : w.h);
        return { ...w, x: pos.x, y: pos.y };
      });
      if (isLive) {
        const moved = next.find((w) => w.id === id);
        if (moved) void updateWorkspaceWidget({
          widgetId: id,
          x: moved.x,
          y: moved.y,
          hidden: Boolean((moved.state as Record<string, unknown>).hidden),
        });
      }
      saveWidgetLayout(next);
      return next;
    });
  const dropWidgetAnchor = (id: string, anchor: "left" | "right") =>
    setWidgets((ws) => {
      const next = ws.map((w) => (w.id === id ? { ...w, collapseAnchor: anchor } : w));
      saveWidgetLayout(next);
      return next;
    });

  const closeWidget = (id: string) => {
    setWidgets((ws) => {
      const next = ws.map((w) => w.id === id ? { ...w, state: { ...w.state, hidden: true } } : w);
      saveWidgetLayout(next);
      return next;
    });
    if (isLive) {
      void updateWorkspaceWidget({ widgetId: id, hidden: true });
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
        void updateWorkspaceWidget({ widgetId: id, collapsed: w.collapsed, hidden: Boolean((w.state as Record<string, unknown>).hidden) });
      }
      saveWidgetLayout(next);
      return next;
    });

  const expandWidget = useCallback((id: string) => {
    setWidgets((ws) => {
      const next = ws.map((w) => {
        if (w.id !== id) return w;
        if (w.collapsed === false) return w;
        return { ...w, collapsed: false };
      });
      const revived = next.find((w) => w.id === id);
      if (isLive && revived) void updateWorkspaceWidget({
        widgetId: id,
        collapsed: false,
        hidden: Boolean((revived.state as Record<string, unknown>).hidden),
      });
      saveWidgetLayout(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Re-expand the artifact panel whenever a new inspector item is opened.
  useEffect(() => {
    if (!openInspectorId) return;
    const artifactPanel = widgets.find((w) => w.kind === "artifact");
    if (artifactPanel?.collapsed) expandWidget(artifactPanel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openInspectorId]);

  const renameWorkspace = useCallback(async (id: string, name: string) => {
    const workstreamId = effectiveTerritories.find((territory) => territory.id === id)?.sourceId;
    if (!workstreamId || !name.trim()) return;
    const ok = await updateWorkspace({ workstreamId, title: name.trim() });
    if (ok) refresh();
  }, [effectiveTerritories, refresh]);

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
        } else if (openInspectorId) {
          e.preventDefault();
          cycleFocus(e.shiftKey ? -1 : 1);
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
      if (hit) {
        goToItem(hit.id, true);
        setFocusedViewOpen(false);
        setBuildingFocusSet(false);
        setFocusSetIds([]);
        setPrimaryFocusId(null);
        setFocusViewPrimaryId(null);
        setSelection(new Set());
        setTrayOpen(false);
        setOpenInspectorId(hit.id);
      }
    };
    const onContextAction = (e: Event) => {
      const ce = e as CustomEvent<{ action?: string; flowX?: number; flowY?: number }>;
      const action = ce.detail?.action;
      if (!action) return;
      // Translate world-ish coords if provided; otherwise use camera center.
      const worldX = ce.detail?.flowX ?? -pan.x;
      const worldY = ce.detail?.flowY ?? -pan.y;
      const map: Record<string, "note" | "task" | "thread" | "visual" | "code"> = {
        note: "note", newNote: "note",
        task: "task", newTask: "task",
        thread: "thread", newThread: "thread",
        visual: "visual", newVisual: "visual",
        code: "code", newCode: "code",
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
  const lastViewModeRef = useRef(viewMode);
  useEffect(() => {
    if (viewMode !== lastViewModeRef.current) {
      lastViewModeRef.current = viewMode;
      if (currentTerritory) {
        flyTo({ x: -currentTerritory.cx, y: -currentTerritory.cy + 40 }, Math.max(0.62, zoom));
      }
    }
  }, [viewMode, currentTerritory, flyTo, zoom]);

  /* ─── Check pending open (after backend creation returns id) ─── */
  useEffect(() => {
    if (!pendingOpenSourceId) return;
    const hit = baseItems.find((i) => i.sourceChatId === pendingOpenSourceId || i.sourceArtifactId === pendingOpenSourceId || i.sourceId === pendingOpenSourceId);
    if (hit) {
      const p = posOf(hit);
      flyTo({ x: -(p.x + hit.w / 2), y: -(p.y + hit.h / 2) }, Math.max(zoom, TIERS.ITEM));
      setFocusedViewOpen(false);
      setBuildingFocusSet(false);
      setFocusSetIds([]);
      setPrimaryFocusId(null);
      setFocusViewPrimaryId(null);
      setSelection(new Set());
      setTrayOpen(false);
      setOpenInspectorId(hit.id);
      setPendingOpenSourceId(null);
    }
  }, [baseItems, pendingOpenSourceId, posOf, flyTo, zoom]);

  /* ─── Derived ─── */
  const getCanvasTransform = () => {
    if (!mounted) return "translate(0px, 0px) scale(1)";
    let activeX = pan.x;
    let activeY = pan.y;
    if (dragRef.current?.type === "pan") {
      activeX = dragRef.current.nx;
      activeY = dragRef.current.ny;
    } else if (wheelPanRef.current.active) {
      activeX = wheelPanRef.current.x;
      activeY = wheelPanRef.current.y;
    }
    return `translate(${vpSize.w / 2 + activeX * zoom}px, ${vpSize.h / 2 + activeY * zoom}px) scale(${zoom})`;
  };
  const canvasTransform = getCanvasTransform();
  const trayItems = Array.from(selection).map((id) => baseItems.find((i) => i.id === id)).filter(Boolean) as V2Item[];
  const pinnedItems = pinned.map((id) => baseItems.find((i) => i.id === id)).filter(Boolean) as V2Item[];
  const quickChatFocusContext = useMemo(() => {
    if (openInspectorId) {
      const target = baseItems.find((item) => item.id === openInspectorId);
      if (target) {
        return {
          kind: target.kind === "thread" ? "thread" as const : "artifact" as const,
          title: target.title,
          color: target.color,
        };
      }
    }
    if (focusedViewOpen) {
      return {
        kind: "focused-view" as const,
        title: `${focusSetIds.length} items`,
        color: "var(--accent)",
        count: focusSetIds.length,
      };
    }
    if (buildingFocusSet && focusSetIds.length > 0) {
      return {
        kind: "building-set" as const,
        title: `${focusSetIds.length} items`,
        color: "var(--ink-300)",
        count: focusSetIds.length,
      };
    }
    return null;
  }, [baseItems, buildingFocusSet, focusSetIds, focusedViewOpen, openInspectorId]);

  /* ─── Render ─── */
  return (
    <div
      className={`spectra-v2 spectra-v2-grid fixed inset-0 overflow-hidden ${theme === "dark" ? "dark" : ""} ${buildingFocusSet ? "sv2-building-set" : ""}`}
      style={{ cursor: panning ? "grabbing" : spaceHeld ? "grab" : "default", userSelect: panning ? "none" : "auto" }}
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
          {effectiveTerritories.map((t) => (
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
          {effectiveTerritories.map((t) => {
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
            for (const w of effectiveTerritories) {
              const layout = layoutByTerritory[w.id];
              if (!layout) continue;
              // Group sections by shelf row (same y). The shelf divider only
              // renders before the first section of each shelf that is NOT
              // the first shelf, and spans the full width of that shelf.
              const shelvesMap = new Map<number, PlacedSection[]>();
              layout.sections.forEach((section) => {
                const bucket = shelvesMap.get(section.y) ?? [];
                bucket.push(section);
                shelvesMap.set(section.y, bucket);
              });
              const shelfYs = Array.from(shelvesMap.keys()).sort((a, b) => a - b);
              shelfYs.forEach((shelfY, shelfIdx) => {
                const shelfSections = (shelvesMap.get(shelfY) ?? []).slice().sort((a, b) => a.x - b.x);
                if (shelfSections.length === 0) return;
                // Shelf divider — spans the shelf width.
                if (shelfIdx > 0) {
                  const shelfLeft = shelfSections[0].x;
                  const last = shelfSections[shelfSections.length - 1];
                  const shelfRight = last.x + last.w;
                  allLabels.push(
                    <div
                      key={`${w.id}-shelf-div-${shelfIdx}`}
                      className="absolute sv2-view-lane-divider pointer-events-none"
                      style={{ left: shelfLeft - 18, top: shelfY - 30, width: shelfRight - shelfLeft + 36 }}
                    />,
                  );
                }
                // Section labels — one per section, sitting above it.
                shelfSections.forEach((section, sectionIdx) => {
                  allLabels.push(
                    <div
                      key={`${w.id}-${section.key}-${shelfIdx}-${sectionIdx}`}
                      className={viewMode === "timeline" ? "absolute sv2-timeline-tick-label sv2-timeline-bucket-header pointer-events-none" : "absolute sv2-view-group-label pointer-events-none"}
                      style={{ left: section.x, top: section.y - 22, color: viewMode === "timeline" ? undefined : section.color }}
                    >
                      {section.label}
                      <span className="ml-2 font-normal opacity-55">{section.items.length}</span>
                    </div>,
                  );
                });
              });
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
      {/* Sidebar - integrated UnifiedPanel */}
      <div className="absolute left-0 top-0 bottom-0 z-50 pointer-events-auto">
        <UnifiedPanel />
      </div>

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
        territories={effectiveTerritories}
        currentWorkspaceId={currentTerritory?.id ?? null}
        onPickWorkspace={goToWorkspace}
        onRenameWorkspace={renameWorkspace}
        onCreateWorkspace={async () => {
          if (isLive) {
            const r = await createItemAction({ action: "createWorkspace", title: "New workspace" });
            scheduleIslandDismiss({ status: r.ok ? "done" : "error", text: r.ok ? "Created new workspace." : "Could not create workspace.", chips: ["Workspace"] });
          } else {
            scheduleIslandDismiss({ status: "done", text: "(demo) New workspace would be created here.", chips: ["Workspace"] });
          }
        }}
      />

      <WidgetLauncher
        widgetsHidden={widgetsHidden}
        onToggleWidgets={() => setWidgetsHidden((v) => !v)}
        onAddWidget={(kind) => addWidget(kind)}
      />

      <Minimap
        territories={effectiveTerritories}
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

      {/* Collapsed widgets now render in-place as rich pills via FloatingWidget — no separate chip rail. */}

      {/* ─── Inspector: ArtifactWidget / ThreadWidget (single-click opens item) ─── */}
      {(() => {
        const artifactPanel = widgets.find((widget) => widget.kind === "artifact");
        if (!artifactPanel || widgetsHidden || artifactPanel.collapsed) return null;
        const item = openInspectorId ? baseItems.find((candidate) => candidate.id === openInspectorId && candidate.kind !== "thread") ?? null : null;
        const fallbackWorkspace = currentTerritory ?? effectiveTerritories[0] ?? null;
        const artifactItem = item ?? (fallbackWorkspace ? ({
          id: "artifact-panel",
          sourceId: "artifact-panel",
          workspaceId: fallbackWorkspace.id,
          kind: "note" as const,
          title: "Artifacts",
          preview: "Create a note, visual, code file, or quick capture from here.",
          body: "Use the quick-create actions below to start a new artifact in this workspace.",
          x: artifactPanel.x,
          y: artifactPanel.y,
          w: artifactPanel.w,
          h: artifactPanel.h,
          color: fallbackWorkspace.color,
          updated: "ready",
          meta: {},
        }) : null);
        if (!artifactItem) return null;
        return (
          <ArtifactWidget
            item={artifactItem}
            x={artifactPanel.x} y={artifactPanel.y} w={artifactPanel.w} h={artifactPanel.h}
            collapsed={false}
            onMove={(x, y) => moveWidget(artifactPanel.id, x, y)}
            onClose={() => closeWidget(artifactPanel.id)}
            onCollapse={() => toggleWidgetCollapsed(artifactPanel.id)}
            onExpand={() => expandWidget(artifactPanel.id)}
            onEdit={(patch) => { if (item) handleItemEdit(item, patch); }}
            onQuickCreate={(kind) => { void createHereByKind(kind, -pan.x, -pan.y); }}
            pendingCreateKind={artifactBlueprintPendingKind}
          />
        );
      })()}

      {(() => {
        const item = openInspectorId ? baseItems.find((candidate) => candidate.id === openInspectorId && candidate.kind === "thread") : null;
        if (!item) return null;
        const x = Math.max(16, vpSize.w - 460);
        return (
          <ThreadWidget
            item={item}
            x={x} y={90} w={440} h={520}
            collapsed={false}
            onMove={() => {}}
            onClose={() => setOpenInspectorId(null)}
            onCollapse={() => setOpenInspectorId(null)}
            onExpand={() => {}}
          />
        );
      })()}

      {/* Floating utility widgets — never include artifact/thread (handled above as inspector) */}
      {widgets.filter((w) => w.kind !== "artifact" && w.kind !== "thread").map((w) => {
        if (widgetsHidden || Boolean((w.state as Record<string, unknown>).hidden)) return null;
        return (
          <FloatingWidget
            key={w.id}
            widget={w}
            workspaceItems={baseItems}
            tick={widgetStateRevision}
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
            onDropAnchor={dropWidgetAnchor}
            isRevealing={revealingWidgetId === w.id}
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

      {/* ─── Always-visible artifact creation shortcut (bottom of workspace) ─── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex flex-col items-center"
        style={{ bottom: 84 }}
      >
        {/* Quick create row — always visible */}
        <div className="flex items-center gap-2 mb-2">
          {(["note", "task", "thread", "visual", "code"] as const).map((kind) => {
            const icons: Record<string, IconName> = { note: "note", task: "schedule", thread: "thread", visual: "layers", code: "pset" };
            const labels: Record<string, string> = { note: "Note", task: "Task", thread: "Thread", visual: "Visual", code: "Code" };
            return (
              <button
                key={kind}
                onClick={() => void createHereByKind(kind, -pan.x, -pan.y)}
                className="sv2-quick-create-btn"
                title={`Create ${labels[kind]} at cursor`}
              >
                <Icon name={icons[kind]} size={11} />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.1em]">{labels[kind]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick chat. When focus view is open, float above the scrim (z=60) so it
          remains usable and carries focus-group scope into `handleSendMessage`. */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{ zIndex: focusedViewOpen ? 60 : undefined }}
      >
        <CommandBar
          focusedItem={focusedItem}
          workspace={currentTerritory}
          selectedCount={selection.size}
          bloomedCount={0}
          resultIsland={resultIsland}
          isProcessing={commandProcessing}
          isStreaming={workspaceRuntime.streaming}
          onStop={stopWorkspaceRuntime}
          quickStarts={QUICK_STARTS}
          onSubmit={handleSendMessage}
          onDismissResult={() => setResultIsland(null)}
          onSpotlight={focusedViewOpen ? () => {} : () => setSpotOpen(true)}
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
          focusContext={quickChatFocusContext}
        />
      </div>

      <Spotlight
        open={spotOpen}
        onClose={() => setSpotOpen(false)}
        items={baseItems}
        territories={effectiveTerritories}
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
