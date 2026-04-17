"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
// lucide-react icons removed (CalendarDays, FileText, Sparkles) — unused after result card cleanup
import { useWorkspaceStore } from "@/stores/workspace-store";
import { WorkspaceCanvas } from "@/components/workspace/workspace-canvas";
import { CommandBar } from "@/components/workspace/command-bar";
import {
  WorkspaceDock,
  type WorkspaceDockItem,
} from "@/components/workspace/workspace-dock";
import { TimerWidget } from "@/components/workspace/timer-widget";
import { UtilityHubGroup } from "@/components/workspace/utility-hub-group";
import { QuickNotesHub } from "@/components/workspace/quick-notes-hub";
// LensHub merged into UtilityHubGroup
import { PlannerEdge } from "@/components/workspace/planner-edge";
import { DeepEditSurface } from "@/components/workspace/deep-edit-surface";
import { ThreadsHub } from "@/components/workspace/threads-hub";
import { PageModeNav } from "@/components/workspace/page-mode-nav";
import type { WorkspaceData, WorkspaceItemData } from "@/lib/workspace/contracts";
import {
  useWorkspaceData,
  dismissCommandResult,
  reopenCommandResult,
  createCommandResult,
  updateCommandResult,
} from "@/hooks/use-workspace-data";
import { notifyWorkspaceContentMutated } from "@/lib/workspace/events";

/* ─── Demo Fallback Data ──────────────────────────────── */

const DEMO_ITEMS: WorkspaceItemData[] = [
  // ── Product Launch: Nova Wearable ──
  { id: "i1", workspaceId: "ws1", title: "Go-to-Market Strategy Brief", preview: "Comprehensive GTM plan covering market positioning for Nova wearable, targeting health-conscious millennials 25-40. Key differentiators: 7-day battery, medical-grade SpO2, open API for third-party health apps. Launch window: Q3 2026 to align with back-to-school and fitness season.", itemType: "note", status: "active", updatedAt: Date.now() - 45_000, meta: "Edited just now" },
  { id: "i2", workspaceId: "ws1", title: "Competitive Landscape Analysis", preview: "Deep dive into Whoop 4.0, Oura Ring Gen 3, Apple Watch Ultra 2 pricing tiers. SWOT analysis per competitor. Nova positioning: premium health-focused at mid-range price ($249 vs Whoop $336/yr). Market gap: no device under $300 offers continuous blood oxygen + skin temp + HRV with open developer API.", itemType: "export", status: "active", updatedAt: Date.now() - 180_000, meta: "24 pages" },
  { id: "i3", workspaceId: "ws1", title: "Launch Campaign Assets Tracker", preview: "Social media creative briefs, influencer partnership contracts, PR outreach list (TechCrunch, The Verge, Wired). Landing page copy drafts A/B tested. Email drip sequence: 5-part pre-launch teaser series targeting waitlist of 12,400 signups.", itemType: "planner", status: "active", meta: "14 tasks, 6 in progress" },
  { id: "i4", workspaceId: "ws1", title: "Pricing Model: Sensitivity Analysis", preview: "Python simulation of demand elasticity across price points $199-$349. Monte Carlo analysis with 10k iterations shows optimal price at $249 with 85% confidence interval for 50k units in first quarter. Includes break-even analysis at varying CAC scenarios.", itemType: "code", status: "active", updatedAt: Date.now() - 360_000, meta: "Python · 340 lines" },
  { id: "i5", workspaceId: "ws1", title: "Investor Pitch Deck v4", preview: "Series A deck: 18 slides covering traction (12.4k waitlist, 340 beta users, 92% retention at 8 weeks), market sizing ($34B wearable health by 2028), team (ex-Apple, ex-Fitbit), financial projections. Raising $8M for scaling manufacturing and hiring 15 engineers.", itemType: "visual", status: "active", updatedAt: Date.now() - 240_000 },
  { id: "i6", workspaceId: "ws1", title: "Beta Feedback Synthesis", preview: "Compiled feedback from 340 beta testers across 8 weeks. Top requests: sleep staging (67%), native Strava integration (54%), smaller form factor for women wrists (41%). Net Promoter Score: 72. Common praise: battery life, SpO2 accuracy, comfortable sleep tracking.", itemType: "thread", status: "active", updatedAt: Date.now() - 90_000, meta: "23 messages" },
  { id: "i7", workspaceId: "ws1", title: "Regulatory Compliance Checklist", preview: "FCC Part 15 Class B certification, FDA 510(k) pre-submission for SpO2 medical claims, CE Marking under MDR for EU launch, California Prop 65 compliance. Legal review of health data privacy (HIPAA adjacency, not covered entity). Estimated timeline: 14 weeks for full certification.", itemType: "note", status: "idle", updatedAt: Date.now() - 7200_000 },

  // ── CS 301: Algorithms & Data Structures ──
  { id: "i8", workspaceId: "ws2", title: "Lecture Notes: Graph Traversal", preview: "BFS vs DFS tradeoffs for different graph types. Dijkstra with priority queue optimization O((V+E)log V). A* search with admissible heuristics. Problem set 7: implement bidirectional BFS for social network shortest path on a graph with 10M nodes.", itemType: "note", status: "active", updatedAt: Date.now() - 120_000, meta: "Edited 2m ago" },
  { id: "i9", workspaceId: "ws2", title: "Dynamic Programming Patterns", preview: "5 core DP patterns: linear (fibonacci, LIS), grid (unique paths, min cost path), interval (matrix chain, burst balloons), tree (diameter, max path sum), and subset (0/1 knapsack, partition equal subset). Each pattern with 3-4 LeetCode-style problems ranked easy to hard.", itemType: "flashcard_deck", status: "active", updatedAt: Date.now() - 600_000, meta: "48 cards, 15 due today" },
  { id: "i10", workspaceId: "ws2", title: "Red-Black Tree Implementation", preview: "Complete RBT implementation in C++ with insert, delete, search, and range queries. Includes rotation helpers, fixup procedures, and comprehensive test suite with 200+ edge cases. Benchmarked against std::map on 1M random operations.", itemType: "code", status: "active", updatedAt: Date.now() - 1_800_000, meta: "C++ · 580 lines" },
  { id: "i11", workspaceId: "ws2", title: "Algorithm Complexity Cheat Sheet", preview: "Visual reference card: sorting algorithms (comparison, non-comparison, hybrid), graph algorithms (spanning tree, shortest path, flow), string algorithms (KMP, Rabin-Karp, suffix array), and data structure operation costs. Space-time tradeoffs for each category.", itemType: "visual", status: "active", updatedAt: Date.now() - 3_600_000 },
  { id: "i12", workspaceId: "ws2", title: "Study Group: Midterm Prep Thread", preview: "Coordinating midterm review sessions. Topics: amortized analysis (potential method), disjoint sets with path compression proof, advanced DP (digit DP, bitmask DP). Meeting Saturday 2pm in CS lab. Sharing practice problems from past 3 years.", itemType: "thread", status: "active", updatedAt: Date.now() - 300_000, meta: "11 messages · 3 new" },
  { id: "i13", workspaceId: "ws2", title: "Problem Set 6: Solutions", preview: "Full worked solutions for PS6: Q1 greedy interval scheduling proof by exchange argument, Q2 Huffman coding with tiebreaking rules, Q3 union-find with both path compression and union by rank proving inverse Ackermann bound, Q4 designing a data structure for dynamic order statistics.", itemType: "note", status: "completed", updatedAt: Date.now() - 7_200_000, meta: "Graded 94/100" },
  { id: "i14", workspaceId: "ws2", title: "Assignment Deadlines & Exam Schedule", itemType: "planner", status: "active", meta: "5 upcoming deadlines" },

  // ── Personal Finance 2026 ──
  { id: "i15", workspaceId: "ws3", title: "Monthly Budget Tracker: April", preview: "Income: $6,800 salary + $420 freelance design. Expenses: rent $1,850, groceries $380 (down 12% from March with meal prep), transport $95, subscriptions $47, dining out $210, fitness $65. Savings rate: 38.2%. Emergency fund now at 5.2 months expenses.", itemType: "note", status: "active", updatedAt: Date.now() - 60_000, meta: "Updated today" },
  { id: "i16", workspaceId: "ws3", title: "Investment Portfolio Rebalancing", preview: "Current allocation: 72% VTI (US total market), 18% VXUS (international), 10% BND (bonds). Target: 65/25/10. Need to sell $4.2k VTI and buy VXUS. Tax-loss harvesting opportunity: sell VTSAX lot from Nov 2024 at -$680 loss, redirect to VFIAX. Rebalance by April 30.", itemType: "note", status: "active", updatedAt: Date.now() - 300_000 },
  { id: "i17", workspaceId: "ws3", title: "Tax Filing Preparation 2025", preview: "W-2 from employer, 1099-NEC from freelance ($5,040 total), 1099-DIV from brokerage. Deductions: home office (simplified method $5/sqft x 120sqft), student loan interest $2,400, traditional IRA contribution $6,500. Estimated refund: $1,840. Filing deadline: April 15, 2026.", itemType: "export", status: "active", updatedAt: Date.now() - 1_200_000, meta: "Draft · 12 pages" },
  { id: "i18", workspaceId: "ws3", title: "Savings Goal Simulator", preview: "Interactive Python model projecting savings trajectories. Scenarios: conservative (4% real return), moderate (7%), aggressive (10%). Monte Carlo simulation for retirement age probability. Current trajectory: FIRE at age 47 with 85% confidence at 6% savings rate increase per year.", itemType: "code", status: "idle", updatedAt: Date.now() - 14_400_000, meta: "Python · Jupyter notebook" },
  { id: "i19", workspaceId: "ws3", title: "Apartment Lease Renewal Decision", preview: "Landlord offered renewal at $1,950/mo (5.4% increase) vs current $1,850. Comparing: negotiate down to $1,900, move to comparable apt at $1,780 but $2,500 moving costs + hassle, or buy a condo. Running 3-year total cost comparison including opportunity cost of down payment.", itemType: "thread", status: "active", updatedAt: Date.now() - 180_000, meta: "8 messages" },
  { id: "i20", workspaceId: "ws3", title: "Financial Milestones & Goals", itemType: "planner", status: "active", meta: "7 goals, 3 on track" },

  // ── Screenplay: "The Last Frequency" ──
  { id: "i21", workspaceId: "ws4", title: "Act I: The Signal — Treatment", preview: "Dr. Maren Cole, radio astronomer at Arecibo II, detects a repeating signal at 1.42 GHz with embedded mathematical structure — prime number sequence modulated into carrier wave. Her supervisor dismisses it as pulsar interference. She secretly continues analysis, discovering the signal contains a self-referencing data format: a Rosetta Stone that teaches its own decoding protocol. Setup ends when she realizes the signal is not arriving from space — it is originating from 847 meters beneath the observatory.", itemType: "note", status: "active", updatedAt: Date.now() - 180_000, meta: "2,840 words" },
  { id: "i22", workspaceId: "ws4", title: "Character Bible", preview: "MAREN COLE (38): Brilliant but marginalized. Published breakthrough paper at 26, then blacklisted for claiming anomalous signals were structured. Obsessive, dry humor, terrible at personal relationships. Key wound: her mother, also a scientist, died in a lab accident Maren believes was covered up. JONAS OSEI (42): Geologist turned government liaison. Pragmatic, loyal to institutions. The reveal: he has been monitoring the same signal for 11 years.", itemType: "note", status: "active", updatedAt: Date.now() - 600_000, meta: "6 characters" },
  { id: "i23", workspaceId: "ws4", title: "Scene Breakdown: Full Script", preview: "87 scenes across 3 acts. Act I (scenes 1-28): Discovery and denial. Act II (scenes 29-62): Descent and confrontation — physical descent into the cave system, emotional confrontation with Jonas. Act III (scenes 63-87): Contact and choice — Maren must decide whether to answer the signal, knowing a response will expose humanity position. The signal is a question, not a message.", itemType: "planner", status: "active", meta: "87 scenes · Act II drafting" },
  { id: "i24", workspaceId: "ws4", title: "Dialogue Workshop: Maren & Jonas", preview: "Workshopping the Act II confrontation scene. Current draft feels too on-the-nose. Need subtext: Maren anger at Jonas should mirror her anger at her mother secrecy. Jonas protectiveness should reveal his own fear. Key line being refined: You think silence is safety. My mother thought that too. Revision notes from screenwriting group incorporated.", itemType: "thread", status: "active", updatedAt: Date.now() - 90_000, meta: "15 messages · 4 new" },
  { id: "i25", workspaceId: "ws4", title: "World-Building: Arecibo II", preview: "Technical specifications of the fictional observatory. Located in same karst terrain as original Arecibo. Upgraded with quantum-enhanced receivers, deep borehole sensor array, and a SETI-dedicated compute cluster. The underground anomaly: a natural limestone chamber with crystalline formations that function as a resonant cavity at exactly 1.42 GHz — the hydrogen line frequency. Geological impossibility or engineered?", itemType: "note", status: "idle", updatedAt: Date.now() - 7_200_000 },
  { id: "i26", workspaceId: "ws4", title: "Pitch Deck: Visual References", preview: "Mood board compiled from: Arrival (Villeneuve) for tone, Contact (Zemeckis) for scientific authenticity, Annihilation (Garland) for the descent metaphor, Underwater (Eubank) for claustrophobic tension. Color palette: deep teal and amber. Key visual: the signal visualized as interference patterns on water — ripples that spell out equations.", itemType: "visual", status: "active", updatedAt: Date.now() - 1_440_000 },
];

const DEMO_WORKSPACES: WorkspaceData[] = [
  { id: "ws1", name: "Product Launch: Nova", emoji: "⚙️", status: "active", itemCount: 7, lastActivity: Date.now() - 45_000, items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws1") },
  { id: "ws2", name: "CS 301: Algorithms", emoji: "👨‍💻", status: "active", itemCount: 7, lastActivity: Date.now() - 120_000, items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws2") },
  { id: "ws3", name: "Personal Finance 2026", emoji: "💰", status: "active", itemCount: 6, lastActivity: Date.now() - 60_000, items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws3") },
  { id: "ws4", name: "Screenplay: Last Frequency", emoji: "🎬", status: "quiet", itemCount: 6, lastActivity: Date.now() - 90_000, items: DEMO_ITEMS.filter((i) => i.workspaceId === "ws4") },
];



/* ─── Main Workspace Page ─── */

export default function WorkspacePage() {
  const {
    committedWorkspaceId,
    viewedWorkspaceId,
    commitToWorkspace,
    flyToWorkspace,
    setWorkspaces,
    workspaces,
    setFocusedItem,
    openDeepEdit,
    closeDeepEdit,
    toggleDeepEditLock,
    deepEditTargets,
    closeAllDeepEdits,
    pushResultCard,
    updateResultCard,
    dismissResultCard: storeDismissResultCard,
    reopenResultCard: storeReopenResultCard,
    hydratePreferences,
    hasHydratedPreferences,
    hubVisibility,
    openThreadInHub,
    workspaces: storeWorkspaces,
  } = useWorkspaceStore();
  const [workspacePickerIntent, setWorkspacePickerIntent] = useState<null | {
    kind: "note" | "code" | "visual" | "task" | "thread";
    title?: string;
    content?: string;
  }>(null);
  const [isEditingWorkspaceName, setIsEditingWorkspaceName] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const workspaceNameInputRef = useRef<HTMLInputElement>(null);

  const hubHidden = hubVisibility === "hidden";
  const hubForceExpanded = hubVisibility === "expanded";

  /* ─── Real data hook: fetches from backend, falls back to demo ─── */
  const {
    workspaces: liveWorkspaces,
    commandResultCards,
    isLive,
    loading: dataLoading,
    refresh: refreshData,
  } = useWorkspaceData(committedWorkspaceId);

  useEffect(() => {
    if (hasHydratedPreferences) return;
    let cancelled = false;

    const loadPreferences = async () => {
      try {
        const response = await fetch("/api/preferences");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          preferences?: {
            workspaceViewMode?: "byType" | "byTopic" | "timeline";
            workspaceBackgroundMode?: "dots" | "blank" | "grid";
            workspaceHubVisibility?: "hidden" | "collapsed" | "expanded";
            workspaceAutoSelectContext?: boolean;
          };
        };
        if (!cancelled && payload.preferences) {
          const normalizedPreferences = {
            ...payload.preferences,
            workspaceHubVisibility:
              payload.preferences.workspaceHubVisibility === "hidden"
                ? "expanded"
                : payload.preferences.workspaceHubVisibility,
          };
          if (normalizedPreferences.workspaceHubVisibility !== payload.preferences.workspaceHubVisibility) {
            void fetch("/api/preferences", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workspaceHubVisibility: normalizedPreferences.workspaceHubVisibility,
              }),
            }).catch(() => undefined);
          }
          hydratePreferences(normalizedPreferences);
        }
      } catch {
        // Preference hydration is best-effort.
      }
    };

    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, [hasHydratedPreferences, hydratePreferences]);

  // Sync live data into the store, or use demo fallback
  const prevIsLiveRef = useRef(false);
  useEffect(() => {
    if (isLive && liveWorkspaces.length > 0) {
      setWorkspaces(liveWorkspaces);
      prevIsLiveRef.current = true;
    } else if (!isLive && !dataLoading && !prevIsLiveRef.current) {
      setWorkspaces(DEMO_WORKSPACES);
    }
  }, [isLive, liveWorkspaces, dataLoading, setWorkspaces]);

  // Sync command result cards from backend into the store
  useEffect(() => {
    if (!isLive || commandResultCards.length === 0) return;
    const state = useWorkspaceStore.getState();
    const existingIds = new Set(state.resultCards.map((c) => c.id));
    for (const card of commandResultCards) {
      if (!existingIds.has(card.id)) {
        state.pushResultCard(card);
      } else {
        state.updateResultCard(card.id, { state: card.state, summary: card.summary });
      }
    }
  }, [commandResultCards, isLive]);

  // Refresh data when committing to a workspace
  useEffect(() => {
    if (committedWorkspaceId && isLive) {
      refreshData();
    }
  }, [committedWorkspaceId, isLive, refreshData]);

  const committedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === committedWorkspaceId) ?? null,
    [workspaces, committedWorkspaceId],
  );

  useEffect(() => {
    if (!committedWorkspace) {
      setIsEditingWorkspaceName(false);
      setWorkspaceNameDraft("");
      return;
    }
    setWorkspaceNameDraft(committedWorkspace.name);
  }, [committedWorkspace]);

  useEffect(() => {
    if (isEditingWorkspaceName) {
      workspaceNameInputRef.current?.focus();
      workspaceNameInputRef.current?.select();
    }
  }, [isEditingWorkspaceName]);

  const dockItems: WorkspaceDockItem[] = useMemo(
    () =>
      [...workspaces]
        .sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
        .map((ws) => ({
        id: ws.id,
        name: ws.name,
        emoji: ws.emoji,
        isActive: ws.id === committedWorkspaceId,
      })),
    [workspaces, committedWorkspaceId],
  );

  const handleWorkspaceSelect = useCallback(
    (id: string) => {
      flyToWorkspace(id);
    },
    [flyToWorkspace],
  );

  const handleBack = useCallback(() => {
    commitToWorkspace(null);
    closeAllDeepEdits();
    setFocusedItem(null);
  }, [commitToWorkspace, closeAllDeepEdits, setFocusedItem]);

  const handleItemClick = useCallback(
    (item: WorkspaceItemData) => {
      setFocusedItem(item.id);
      if (item.itemType === "thread") {
        openThreadInHub(item.id);
      } else {
        openDeepEdit(item);
      }
    },
    [openDeepEdit, openThreadInHub, setFocusedItem],
  );

  const handleCanvasNodeClick = useCallback(
    (workspaceId: string) => {
      flyToWorkspace(workspaceId);
    },
    [flyToWorkspace],
  );

  const handleCanvasItemClick = useCallback(
    (itemId: string) => {
      const allItems = workspaces.flatMap((w) => w.items);
      const item = allItems.find((i) => i.id === itemId);
      if (item) handleItemClick(item);
    },
    [workspaces, handleItemClick],
  );

  const createWorkspaceAction = useCallback(async (payload: { title: string; description?: string; emoji?: string }) => {
    const response = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "createWorkspace",
        ...payload,
      }),
    });
    if (!response.ok) throw new Error("Failed to create workspace");
    const data = (await response.json()) as { workstreamId?: string };
    notifyWorkspaceContentMutated({ refreshWorkstreams: true, refreshHub: true });
    refreshData();
    if (data.workstreamId) {
      flyToWorkspace(data.workstreamId);
    }
  }, [flyToWorkspace, refreshData]);

  const renameWorkspaceAction = useCallback(async (workstreamId: string, title: string) => {
    const response = await fetch("/api/workstreams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        workstreamId,
        title,
      }),
    });
    if (!response.ok) throw new Error("Failed to rename workspace");
    notifyWorkspaceContentMutated({ workstreamId, refreshWorkstreams: true, refreshHub: true });
    refreshData();
  }, [refreshData]);

  const commitWorkspaceRename = useCallback(async () => {
    if (!committedWorkspace) return;
    const trimmed = workspaceNameDraft.trim();
    setIsEditingWorkspaceName(false);
    if (!trimmed || trimmed === committedWorkspace.name) {
      setWorkspaceNameDraft(committedWorkspace.name);
      return;
    }
    await renameWorkspaceAction(committedWorkspace.id, trimmed).catch(() => undefined);
  }, [committedWorkspace, workspaceNameDraft, renameWorkspaceAction]);

  const createItemAction = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("Failed workspace command");
    notifyWorkspaceContentMutated({
      workstreamId: committedWorkspaceId ?? undefined,
      refreshHub: true,
      refreshWorkstreams: true,
    });
    refreshData();
    return response.json();
  }, [committedWorkspaceId, refreshData]);

  const submitCreationIntent = useCallback(async (workstreamId: string, intent: NonNullable<typeof workspacePickerIntent>) => {
    switch (intent.kind) {
      case "note":
        await createItemAction({ action: "createNote", workstreamId, title: intent.title ?? "Untitled note", content: intent.content ?? "" });
        break;
      case "code":
        await createItemAction({ action: "createArtifact", workstreamId, type: "code_project", title: intent.title ?? "Untitled code", content: intent.content ?? "// Start coding\n" });
        break;
      case "visual":
        await createItemAction({ action: "createArtifact", workstreamId, type: "visualization", title: intent.title ?? "Untitled visual", content: intent.content ?? "<svg></svg>" });
        break;
      case "task":
        await createItemAction({ action: "createPlannerItem", workstreamId, title: intent.title ?? "New task", type: "deadline", priority: "medium" });
        break;
      case "thread":
        await createItemAction({ action: "createThread", workstreamId, title: intent.title ?? "New thread" });
        break;
    }
    setWorkspacePickerIntent(null);
  }, [createItemAction]);

  /* ─── Command bar: uses result card stack ─── */
  const [isProcessingCommand, setIsProcessingCommand] = useState(false);

  const handleSendMessage = useCallback(async (message: string) => {
    const normalized = message.trim();
    const lowered = normalized.toLowerCase();

    // Determine intent from command prefix
    const isSearch = normalized.startsWith("?") || lowered.startsWith("search ") || lowered.startsWith("find ");
    const isNoteCmd = lowered.startsWith("/note") || lowered.startsWith("create note");
    const isTaskCmd = lowered.startsWith("/task") || lowered.startsWith("create task");
    const isWidgetCmd = lowered.startsWith("/widget") || lowered.startsWith("create widget");
    const isThreadCmd = lowered.startsWith("/thread") || lowered.startsWith("create thread");
    const isWorkspaceCmd = lowered.startsWith("/workspace") || lowered.startsWith("create workspace");

    setIsProcessingCommand(true);
    // Use viewed workspace as fallback when no workspace is explicitly committed
    const effectiveWorkspaceId = committedWorkspaceId ?? viewedWorkspaceId;

    let createdResultId: string | undefined;

    try {
      /* ── Search ── */
      if (isSearch) {
        const query = normalized.replace(/^\?/, "").replace(/^(search|find)\s+/i, "").trim();
        const res = await createCommandResult({
          workstreamId: effectiveWorkspaceId ?? "",
          intent: "result",
          title: normalized.length > 60 ? normalized.slice(0, 57) + "\u2026" : normalized,
          status: "processing",
        });
        createdResultId = res?.resultId;

        const result = await createItemAction({
          action: "search",
          workstreamId: effectiveWorkspaceId ?? "",
          query,
          limit: 8,
        }) as { results?: Array<{ title: string; workspaceTitle?: string; _id?: string }> };
        const count = result.results?.length ?? 0;
        
        if (createdResultId) {
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary: count > 0
              ? `${count} result${count === 1 ? "" : "s"} for \u201c${query}\u201d`
              : `No results for \u201c${query}\u201d`,
          });
          refreshData();
        }
        return;
      }

      /* ── Create note ── */
      if (isNoteCmd) {
        if (!effectiveWorkspaceId) throw new Error("Enter a workspace first");
        const title = normalized.replace(/^\/note\s*/i, "").replace(/^create note\s*/i, "").trim() || "Untitled note";
        // Push optimistic result card for immediate feedback
        const optimisticId = `optimistic-note-${Date.now()}`;
        pushResultCard({
          id: optimisticId,
          state: "loading",
          promptSnippet: `Creating note\u2026`,
          actionType: "created",
          targetItemType: "note",
        });
        try {
          await createItemAction({
            action: "createNote",
            workstreamId: effectiveWorkspaceId,
            title,
            content: "",
          });
          // Backend result card will be synced by refreshData() inside createItemAction
          // Mark optimistic card as done; the real backend card will appear alongside it
          updateResultCard(optimisticId, {
            state: "done",
            summary: `Note \u201c${title}\u201d created`,
          });
        } catch (err) {
          updateResultCard(optimisticId, {
            state: "error",
            summary: err instanceof Error ? err.message : "Failed to create note",
          });
          throw err;
        }
        return;
      }

      /* ── Create task ── */
      if (isTaskCmd) {
        if (!effectiveWorkspaceId) throw new Error("Enter a workspace first");
        const title = normalized.replace(/^\/task\s*/i, "").replace(/^create task\s*/i, "").trim() || "New task";
        // Push optimistic result card for immediate feedback
        const optimisticId = `optimistic-task-${Date.now()}`;
        pushResultCard({
          id: optimisticId,
          state: "loading",
          promptSnippet: `Creating task\u2026`,
          actionType: "planned",
          targetItemType: "planner",
        });
        try {
          await createItemAction({
            action: "createPlannerItem",
            workstreamId: effectiveWorkspaceId,
            title,
            type: "deadline",
            priority: "medium",
          });
          updateResultCard(optimisticId, {
            state: "done",
            summary: `Task \u201c${title}\u201d created`,
          });
        } catch (err) {
          updateResultCard(optimisticId, {
            state: "error",
            summary: err instanceof Error ? err.message : "Failed to create task",
          });
          throw err;
        }
        return;
      }

      /* ── Create widget ── */
      if (isWidgetCmd) {
        useWorkspaceStore.getState().setWidgetPlacementHint({ kind: "sticky", at: "pointer" });
        return;
      }

      /* ── Create thread ── */
      if (isThreadCmd) {
        if (!effectiveWorkspaceId) throw new Error("Enter a workspace first");
        const title = normalized.replace(/^\/thread\s*/i, "").replace(/^create thread\s*/i, "").trim() || "New thread";
        // Push optimistic result card for immediate feedback
        const optimisticId = `optimistic-thread-${Date.now()}`;
        pushResultCard({
          id: optimisticId,
          state: "loading",
          promptSnippet: `Creating thread\u2026`,
          actionType: "answered",
          targetItemType: "thread",
        });
        try {
          await createItemAction({
            action: "createThread",
            workstreamId: effectiveWorkspaceId,
            title,
          });
          updateResultCard(optimisticId, {
            state: "done",
            summary: `Thread \u201c${title}\u201d created`,
          });
        } catch (err) {
          updateResultCard(optimisticId, {
            state: "error",
            summary: err instanceof Error ? err.message : "Failed to create thread",
          });
          throw err;
        }
        return;
      }

      /* ── Create workspace ── */
      if (isWorkspaceCmd) {
        const title = normalized.replace(/^\/workspace\s*/i, "").replace(/^create workspace\s*/i, "").trim() || "New workspace";
        const res = await createCommandResult({
          workstreamId: committedWorkspaceId ?? "", // wait, we don't know the new workstream ID yet
          intent: "result",
          title: "Create workspace",
          status: "processing",
        });
        createdResultId = res?.resultId;

        await createWorkspaceAction({ title });
        
        if (createdResultId) {
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary: `Workspace \u201c${title}\u201d created`,
          });
        }
        return;
      }

      /* ── General AI message → routed to chat pipeline ── */
      // Create backend processing result first
      if (effectiveWorkspaceId) {
        const res = await createCommandResult({
          workstreamId: effectiveWorkspaceId ?? "",
          intent: "result",
          title: normalized.length > 60 ? normalized.slice(0, 57) + "\u2026" : normalized,
          status: "processing",
        });
        createdResultId = res?.resultId;
        refreshData();
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "general",
          message: normalized,
          thinkingLevel: "low",
          routerMode: "auto",
          usePersonalResources: true,
          skipUserMessagePersist: false,
          workstreamId: effectiveWorkspaceId,
          scopeLevel: effectiveWorkspaceId ? "workspace" : "global",
        }),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(errText || "Request failed");
      }

      let chatId: string | undefined;
      let threadTitle: string | undefined;
      let createdArtifacts: Array<{ id: string; title: string; type: string }> = [];
      try {
        const data = await response.json() as {
          chatId?: string;
          threadTitle?: string;
          artifacts?: Array<{ id: string; title: string; type: string }>;
        };
        chatId = data.chatId;
        threadTitle = data.threadTitle;
        createdArtifacts = data.artifacts ?? [];
      } catch {
        // Response might be streaming or non-JSON — that's ok
      }

      if (createdResultId) {
        if (createdArtifacts.length > 0) {
          const first = createdArtifacts[0];
          const summary = createdArtifacts.length === 1
            ? `Created ${first.type}: \u201c${first.title}\u201d`
            : `Created ${createdArtifacts.length} items`;
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary,
            targetKind: "artifact",
            targetId: first.id,
            variant: "artifact",
          });
        } else if (chatId) {
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary: threadTitle
              ? `Replied in \u201c${threadTitle}\u201d`
              : "Sent to chat thread",
            targetKind: "chat",
            targetId: chatId,
            variant: "thread",
          });
        } else {
          await updateCommandResult({
            resultId: createdResultId,
            status: "completed",
            summary: "Response sent to chat",
          });
        }
      }

      refreshData();
    } catch (error) {
      if (createdResultId) {
        await updateCommandResult({
          resultId: createdResultId,
          status: "completed", 
          summary: error instanceof Error ? error.message : "Command failed",
        });
        refreshData();
      }
    } finally {
      setIsProcessingCommand(false);
    }
  }, [committedWorkspaceId, viewedWorkspaceId, createWorkspaceAction, refreshData, createItemAction, pushResultCard, updateResultCard]);

  /* ─── Dismiss/reopen: real backend when live, store-only otherwise ─── */
  const handleDismissResultCard = useCallback(
    (cardId: string) => {
      storeDismissResultCard(cardId);
      if (isLive) {
        dismissCommandResult(cardId);
      }
    },
    [storeDismissResultCard, isLive],
  );

  const handleReopenResultCard = useCallback(
    (cardId: string) => {
      storeReopenResultCard(cardId);
      if (isLive) {
        reopenCommandResult(cardId);
      }
    },
    [storeReopenResultCard, isLive],
  );

  const noop = useCallback(() => {}, []);

  const handleTaskClick = useCallback(
    (taskId: string) => {
      const taskItem = workspaces.flatMap((w) => w.items).find((item) => item.id === taskId);
      if (taskItem) {
        handleItemClick(taskItem);
      }
    },
    [workspaces, handleItemClick],
  );

  // Clear focused item when switching workspaces
  useEffect(() => {
    setFocusedItem(null);
    closeAllDeepEdits();
  }, [committedWorkspaceId, setFocusedItem, closeAllDeepEdits]);

  // Auto-dismiss completed result cards after 12s to keep UI clean
  const resultCards = useWorkspaceStore((s) => s.resultCards);
  useEffect(() => {
    const doneCards = resultCards.filter(
      (c) => c.state === "done" || c.state === "error",
    );
    if (doneCards.length === 0) return;

    const timers = doneCards.map((card) => {
      const age = Date.now() - card.createdAt;
      const remainingMs = Math.max(0, 30_000 - age);
      return setTimeout(() => {
        storeDismissResultCard(card.id);
      }, remainingMs);
    });

    return () => timers.forEach(clearTimeout);
  }, [resultCards, storeDismissResultCard]);

  // Global keyboard: Escape closes deep edits, Tab/. toggles page mode, Cmd+1..9 pins/focuses
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (deepEditTargets.length > 0) {
          const last = deepEditTargets[deepEditTargets.length - 1];
          closeDeepEdit(last.item.id);
        } else if (committedWorkspaceId) {
          handleBack();
        }
      } else if (e.key === "Tab" || e.key === ".") {
        e.preventDefault();
        useWorkspaceStore.getState().toggleNavigationMode();
      } else if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const num = parseInt(e.key, 10);
        // Toggle pin for the Nth deep edit target, or open the Nth workspace if no targets
        if (deepEditTargets.length > 0) {
          const target = deepEditTargets[num - 1];
          if (target) {
            useWorkspaceStore.getState().toggleDeepEditLock(target.item.id);
          }
        } else {
          const ws = workspaces[num - 1];
          if (ws) handleWorkspaceSelect(ws.id);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deepEditTargets, closeDeepEdit, committedWorkspaceId, handleBack, workspaces, handleWorkspaceSelect]);

  // Handle open-item events from result cards and other surfaces
  useEffect(() => {
    const handleOpenItem = (e: Event) => {
      const customEvent = e as CustomEvent<{ itemId: string; itemType?: string }>;
      const { itemId, itemType } = customEvent.detail ?? {};
      if (!itemId) return;

      // First try to find by direct workspace item ID
      const allItems = workspaces.flatMap((w) => w.items);
      let item = allItems.find((i) => i.id === itemId);

      // If not found, the targetId may be a source entity ID (chatId, artifactId, etc.)
      // Workspace items sometimes have a different ID from their source entity
      if (!item) {
        // Try matching by source entity IDs first (more precise than type-only fallback)
        item = allItems.find((i) =>
          i.sourceChatId === itemId ||
          i.sourceArtifactId === itemId ||
          i.sourcePlannerItemId === itemId
        );
      }

      // Last resort: match by type if itemId is clearly not a database ID
      // (prevents false positives from matching ANY item of the same type)
      if (!item && itemType) {
        // Only use type fallback if the itemId doesn't look like a Convex ID
        const isConvexId = itemId.length > 16;
        if (!isConvexId) {
          item = allItems.find((i) => i.itemType === itemType);
        }
      }

      if (item) {
        handleItemClick(item);
      } else {
        // Item not yet in workspace items (may still be syncing).
        // Refresh data and try again after a short delay.
        refreshData();
        setTimeout(() => {
          const freshItems = useWorkspaceStore.getState().workspaces.flatMap((w) => w.items);
          const freshItem = freshItems.find((i) =>
            i.id === itemId ||
            i.sourceChatId === itemId ||
            i.sourceArtifactId === itemId ||
            i.sourcePlannerItemId === itemId
          );
          if (freshItem) handleItemClick(freshItem);
        }, 1200);
      }
    };
    window.addEventListener("workspace:open-item", handleOpenItem);
    return () => window.removeEventListener("workspace:open-item", handleOpenItem);
  }, [workspaces, handleItemClick, refreshData]);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-[var(--bg-primary)]">
      {/* Loading indicator when fetching real data */}
      {dataLoading && (
        <div className="absolute left-1/2 top-4 z-[60] -translate-x-1/2 rounded-full border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/95 px-4 py-1.5 backdrop-blur-xl">
          <span className="text-[11px] font-medium text-[var(--text-tertiary)] animate-pulse">
            Loading workspace…
          </span>
        </div>
      )}

      {/* Live data indicator — brief flash */}
      {isLive && !dataLoading && (
        <div className="absolute left-1/2 top-4 z-[60] -translate-x-1/2 rounded-full border border-[color-mix(in_oklab,var(--success)_20%,var(--border-default))] bg-[var(--bg-elevated)]/95 px-3 py-1 backdrop-blur-xl animate-[fadeInOut_2s_ease-in-out_forwards]">
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--success)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
            Live
          </span>
        </div>
      )}

      {/* Continuous canvas — always present, never replaced */}
      <div className="flex-1 relative">
        <PageModeNav />
        <WorkspaceCanvas
          onNodeClick={handleCanvasNodeClick}
          onItemClick={handleCanvasItemClick}
        />
      </div>

      {/* Hub ecology: Right-edge deep-edit surfaces */}
      {!hubHidden && (
        <AnimatePresence>
          {deepEditTargets.map((target) => (
            <DeepEditSurface
              key={target.item.id}
              item={target.item}
              locked={target.locked}
              pinned={target.pinned}
              onClose={() => closeDeepEdit(target.item.id)}
              onToggleLock={() => toggleDeepEditLock(target.item.id)}
            />
          ))}
        </AnimatePresence>
      )}

      {/* Hub ecology: Right-edge threads hub */}
      {!hubHidden && <ThreadsHub forceExpanded={hubForceExpanded} />}

      {/* Hub ecology: Left-edge planner (above dock) */}
      {!hubHidden && (
        <PlannerEdge
          onTaskClick={handleTaskClick}
          forceExpanded={hubForceExpanded}
        />
      )}

      {/* Hub ecology: Left-edge workspace dock */}
      {!hubHidden && (
        <WorkspaceDock
          workspaces={dockItems}
          onSelect={handleWorkspaceSelect}
          onCreateNew={() => { void createWorkspaceAction({ title: "New workspace" }); }}
          onGoHome={handleBack}
        />
      )}

      {/* Hub ecology: Top-right utility controls (always visible for settings access) */}
      <UtilityHubGroup />

      {/* Hub ecology: Left-edge quick notes (~3/4 down) */}
      {!hubHidden && <QuickNotesHub forceExpanded={hubForceExpanded} />}

      {/* Hub ecology: Bottom-center unified command bar with result cards */}
      <CommandBar
        workspaceName={committedWorkspace?.name}
        onSendMessage={handleSendMessage}
        onDismissResultCard={handleDismissResultCard}
        onReopenResultCard={handleReopenResultCard}
        isProcessing={isProcessingCommand}
        onCreateWorkspace={() => { void createWorkspaceAction({ title: "New workspace" }); }}
        onCreateNote={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "note", title: "Untitled note", content: "" });
            return;
          }
          void createItemAction({ action: "createNote", workstreamId: committedWorkspaceId, title: "Untitled note", content: "" });
        }}
        onCreateCode={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "code", title: "Untitled code", content: "// Start coding\n" });
            return;
          }
          void createItemAction({ action: "createArtifact", workstreamId: committedWorkspaceId, type: "code_project", title: "Untitled code", content: "// Start coding\n" });
        }}
        onCreateVisual={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "visual", title: "Untitled visual", content: "<svg></svg>" });
            return;
          }
          void createItemAction({ action: "createArtifact", workstreamId: committedWorkspaceId, type: "visualization", title: "Untitled visual", content: "<svg></svg>" });
        }}
        onCreateTask={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "task", title: "New task" });
            return;
          }
          void createItemAction({ action: "createPlannerItem", workstreamId: committedWorkspaceId, title: "New task", type: "deadline", priority: "medium" });
        }}
        onCreateWidget={() => {
          useWorkspaceStore.getState().setWidgetPlacementHint({ kind: "sticky", at: "pointer" });
        }}
        onCreateThread={() => {
          if (!committedWorkspaceId) {
            setWorkspacePickerIntent({ kind: "thread", title: "New thread" });
            return;
          }
          void createItemAction({ action: "createThread", workstreamId: committedWorkspaceId, title: "New thread" });
        }}
        onCreateWithAi={noop}
      />

      {/* Hub ecology: Bottom-right timer */}
      {!hubHidden && <TimerWidget forceExpanded={hubForceExpanded} />}

      {committedWorkspace && (
        <div className="absolute left-[92px] top-5 z-[45] flex items-center gap-3 px-1 py-1">
          <span className="text-lg leading-none">{committedWorkspace.emoji}</span>
          {isEditingWorkspaceName ? (
            <input
              ref={workspaceNameInputRef}
              value={workspaceNameDraft}
              onChange={(event) => setWorkspaceNameDraft(event.target.value)}
              onBlur={() => { void commitWorkspaceRename(); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitWorkspaceRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setIsEditingWorkspaceName(false);
                  setWorkspaceNameDraft(committedWorkspace.name);
                }
              }}
              className="max-w-[280px] border-b border-[var(--accent-cyan)]/35 bg-transparent text-[14px] font-semibold text-[var(--text-primary)] outline-none"
            />
          ) : (
            <div
              className="group/name flex max-w-[320px] cursor-text items-center gap-2"
              onDoubleClick={() => {
                setWorkspaceNameDraft(committedWorkspace.name);
                setIsEditingWorkspaceName(true);
              }}
            >
              <span className="truncate text-left text-[14px] font-semibold text-[var(--text-primary)] transition-colors group-hover/name:text-[var(--accent-cyan)]">
                {committedWorkspace.name}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover/name:opacity-100">
                rename
              </span>
            </div>
          )}
        </div>
      )}

      {workspacePickerIntent && storeWorkspaces.length > 0 && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <div className="w-[min(420px,calc(100vw-32px))] rounded-3xl border border-[var(--border-default)]/40 bg-[var(--bg-elevated)] p-5 shadow-[0_28px_60px_-28px_rgba(8,22,40,0.35)]">
            <div className="mb-4">
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Choose a workspace</h2>
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Create this {workspacePickerIntent.kind} in one of your workspaces.</p>
            </div>
            <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto">
              {storeWorkspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => { void submitCreationIntent(workspace.id, workspacePickerIntent); }}
                  className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <span className="text-lg leading-none">{workspace.emoji}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{workspace.name}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">{workspace.itemCount} items</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setWorkspacePickerIntent(null)}
                className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
