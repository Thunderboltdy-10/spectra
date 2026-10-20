"use client";

import dynamic from "next/dynamic";
import { Loader2, ShieldCheck, Bot, CheckCircle2, Plus, Search, Grid3X3 } from "@/components/icons/glyph-icons";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { createDefaultArtifactPayload } from "../components/artifact-blueprint-sheet";
import { authoredSummary } from "../artifacts/registry";
import {
  StudioSplitPlaceholder,
  useArtifactStudioState,
} from "../components/artifact-studio-shell";
import { ShareDialog } from "../components/share-dialog";
import { useSpectraRun } from "../ai/use-spectra-run";
import {
  addSpectraPublicAgent,
  getSpectraArtifact,
  getSpectraPublicAgents,
  postSpectra,
  getSpectraInstalledAgents,
  setSpectraAgentInstalled,
  type SpectraArtifact,
  type SpectraInstalledAgent,
  type SpectraPublicAgent,
  type SpectraWorkspace,
} from "../data/api";
import { useProvideIslandEngine } from "../island/engine";
import { Button } from "@/components/ui/button";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { IconButton } from "@/components/ui/icon-button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { AgentStarters, type AgentStarter } from "../agents/agent-starters";
import { AgentLibraryEntry, type LibraryCard, type LibrarySection } from "../agents/agent-library-entry";
import type { AgentContent } from "../agents/model";
import { EmptyState, LoadingRows, ProblemState } from "@/components/ui/page-state";
import { SelectField } from "@/components/ui/select";
import { useAgentCatalog, useWorkspaceCatalog } from "../data/use-catalog-pages";
import { CatalogProgress } from "../components/catalog-progress";
import { createLatestStudioLoad } from "../components/latest-studio-load";
import { beginCreation } from "../life/use-life";
import { useSpectraContextStore } from "@/stores/spectra-context-store";

const ArtifactStudio = dynamic(
  () =>
    import("../components/artifact-studio").then(
      (module) => module.ArtifactStudio,
    ),
  { loading: () => <StudioSplitPlaceholder /> },
);

type SortMode = "relevance" | "recent" | "title";
const AGENT_BAR_PLAN: readonly CollapseStep[] = [{ hideLabel: "filter" }, { hideLabel: "new" }];

function subjectLabel(tags: string[], skills: string[]) {
  const candidate = [...tags, ...skills].find(
    (value) => value.trim() && value.trim().length < 36,
  );
  return candidate?.trim() || "General";
}

function accessibleCard(artifact: SpectraArtifact): LibraryCard {
  const capabilities = [...new Set(artifact.tags)].slice(0, 4);
  return {
    id: artifact._id,
    section: artifact.ownership === "shared" ? "shared" : "yours",
    title: artifact.title,
    summary: authoredSummary("agent", artifact.summary) ?? "",
    subject: subjectLabel(artifact.tags, []),
    capabilities,
    owner: artifact.owner ?? {
      name: artifact.ownership === "shared" ? "School member" : "You",
    },
    updatedAt: artifact.updatedAt,
    releaseNumber: artifact.agentRelease?.releaseNumber,
    artifact,
  };
}

function publicCard(agent: SpectraPublicAgent): LibraryCard {
  return {
    id: agent.agentId,
    section: "discover",
    title: agent.title,
    summary:
      agent.summary?.trim() || agent.purpose.trim() || agent.routingDescription,
    subject: subjectLabel(agent.tags, agent.skills),
    capabilities: [...new Set([...agent.skills, ...agent.tags])].slice(0, 4),
    owner: agent.owner,
    updatedAt: agent.publishedAt,
    releaseNumber: agent.releaseNumber,
    rating: agent.rating,
    ratingCount: agent.ratingCount,
    publicAgent: agent,
  };
}

function installedCard(agent: SpectraInstalledAgent): LibraryCard {
  return {
    ...publicCard(agent),
    section: "installed",
    updatedAt: agent.installedAt,
    installedRelease: agent.releaseNumber,
  };
}

function LibrarySectionBlock({
  title,
  description,
  cards,
  limit,
  onViewAll,
  children,
}: {
  title: string;
  description: string;
  cards: LibraryCard[];
  limit: number;
  onViewAll: () => void;
  children: (card: LibraryCard) => ReactNode;
}) {
  // A section with nothing in it says nothing; the page's own empty state speaks.
  if (!cards.length) return null;
  return (
    <section
      className="mt-7"
      aria-labelledby={`agent-section-${title.replaceAll(" ", "-").toLowerCase()}`}
    >
      <header className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2
            id={`agent-section-${title.replaceAll(" ", "-").toLowerCase()}`}
            className="font-display text-heading font-semibold text-[var(--text-primary)]"
          >
            {title}
          </h2>
          <p className="mt-0.5 text-micro text-[var(--text-secondary)]">
            {description}
          </p>
        </div>
        {cards.length > limit ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onViewAll}>
            View all ({cards.length})
          </Button>
        ) : null}
      </header>
      <ul className="agent-roster">{cards.slice(0, limit).map(children)}</ul>
    </section>
  );
}

export function AgentLibraryShell({
  initialAgentId,
}: { initialAgentId?: string } = {}) {
  const searchParams = useSearchParams();
  const requestedAgentId = initialAgentId ?? searchParams.get("agentId");
  const agentCatalog = useAgentCatalog();
  const { key: catalogKey, refresh: refreshCatalog } = agentCatalog;
  const [hydrated, setHydrated] = useState<Record<string, SpectraArtifact>>({});
  const artifacts = useMemo(() => {
    const rows = new Map(agentCatalog.items.map(item => [item._id, item]));
    for (const artifact of Object.values(hydrated)) rows.set(artifact._id, artifact);
    return [...rows.values()];
  }, [agentCatalog.items, hydrated]);
  const [publicSources, setPublicSources] = useState<{ key: string | null; public: SpectraPublicAgent[]; installed: SpectraInstalledAgent[] }>({ key: null, public: [], installed: [] });
  const publicAgents = useMemo(() => publicSources.key === catalogKey ? publicSources.public : [], [catalogKey, publicSources]);
  const installedAgents = useMemo(() => publicSources.key === catalogKey ? publicSources.installed : [], [catalogKey, publicSources]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [publicError, setPublicError] = useState<string | null>(null);
  const publicRequest = useRef<{ key: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const currentScope = useRef(catalogKey);
  currentScope.current = catalogKey;
  const loading = !agentCatalog.unavailable && (publicLoading || ((agentCatalog.status === "idle" || agentCatalog.status === "loading") && artifacts.length === 0));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("all");
  const [capability, setCapability] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("relevance");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<LibrarySection>>(
    () => new Set(),
  );
  const [placementTarget, setPlacementTarget] =
    useState<SpectraArtifact | null>(null);
  const workspaceCatalog = useWorkspaceCatalog(undefined, Boolean(placementTarget));
  const workspaces = workspaceCatalog.items;
  const [shareTarget, setShareTarget] = useState<SpectraArtifact | null>(null);
  const [publicPreview, setPublicPreview] = useState<SpectraPublicAgent | null>(
    null,
  );
  const [panelWidth, setPanelWidth] = useState(780);
  const openedQueryRef = useRef<string | null>(null);
  const studio = useArtifactStudioState(
    "spectra.agentLibrary.studio",
    Object.values(hydrated),
  );
  const [openLoader] = useState(() => createLatestStudioLoad((id, signal) => getSpectraArtifact(id, { signal }).then(result => result.artifact)));
  const opening = useRef(0);
  const { openSplit } = studio;
  const openAgent = useCallback(async (id: string, choosePlacement = false) => {
    const request = ++opening.current;
    try {
      const artifact = await openLoader.load(id);
      if (!artifact || request !== opening.current) return;
      if (artifact.blueprintKey !== "agent" || artifact.content === undefined) throw new Error("Agent detail is unavailable.");
      const detail = { ...artifact, placementsComplete: true };
      if (choosePlacement && detail.ownership === "shared" && !detail.placements?.length) setPlacementTarget(detail);
      else {
        setHydrated(current => ({ ...current, [id]: detail }));
        openSplit(detail);
      }
    } catch (error) {
      if (request === opening.current) toast.error(error instanceof Error ? error.message : "Could not open this agent.");
    }
  }, [openLoader, openSplit]);
  const closeStudio = () => { opening.current++; openLoader.cancel(); studio.closeStudio(); };
  const openObjects = useSpectraContextStore(state => state.openObjects);
  useEffect(() => {
    const openIds = new Set(openObjects.filter(item => item.type === "artifact").map(item => item.id));
    setHydrated(current => {
      const kept = Object.entries(current).filter(([id]) => openIds.has(id));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [openObjects]);
  useEffect(() => {
    // A request counter, not a DOM node: cleanup must invalidate the same ref.
    const requests = opening;
    currentScope.current = catalogKey;
    setHydrated({});
    setPlacementTarget(null);
    openedQueryRef.current = null;
    requests.current++;
    openLoader.cancel();
    return () => {
      currentScope.current = null;
      publicRequest.current?.controller.abort();
      publicRequest.current = null;
      requests.current++;
      openLoader.cancel();
    };
  }, [catalogKey, openLoader]);
  const missingRestored = JSON.stringify(openObjects.filter(item => item.type === "artifact" && item.id !== requestedAgentId &&
    !hydrated[item.id] && agentCatalog.items.some(artifact => artifact._id === item.id)).map(item => item.id));
  useEffect(() => {
    const ids = JSON.parse(missingRestored) as string[];
    if (!catalogKey || !ids.length) return;
    const controller = new AbortController();
    void Promise.all(ids.map(id => getSpectraArtifact(id, { signal: controller.signal }).catch(() => null))).then(results => {
      if (controller.signal.aborted) return;
      const details = results.flatMap(result => result?.artifact.blueprintKey === "agent" && result.artifact.content !== undefined
        ? [[result.artifact._id, { ...result.artifact, placementsComplete: true }] as const] : []);
      setHydrated(current => ({ ...current, ...Object.fromEntries(details) }));
    });
    return () => controller.abort();
  }, [catalogKey, missingRestored]);
  const activeAgentArtifact = studio.activeArtifact;
  const activeAgentArtifactId = activeAgentArtifact?._id;
  const openAgentPointers = useMemo(
    () =>
      activeAgentArtifact
        ? [{ id: activeAgentArtifact._id, type: activeAgentArtifact.blueprintKey, title: activeAgentArtifact.title }]
        : undefined,
    [activeAgentArtifact],
  );
  const runEngine = useSpectraRun({
    surface: activeAgentArtifact ? "artifact" : "chat",
    artifactId: activeAgentArtifactId,
    open: openAgentPointers,
    currentView: activeAgentArtifact ? "agent-editor" : "agent-library",
  });
  // The island writes through this page's engine, so an open agent is what
  // Spectra is asked about; the run arrives as a tab, and the page stays.
  useProvideIslandEngine(useMemo(() => ({ engine: runEngine }), [runEngine]));

  /* A change made on this page rereads everything (`changed`). Coming back to
     the tab rereads the published agents, which are one request, and leaves the
     catalog to its own freshness: rescanning it is the expensive part, and it
     was being forced every few seconds, which emptied the page each time. */
  const load = useCallback(async (changed = false) => {
    if (!catalogKey) { setPublicLoading(false); return; }
    const catalogRefresh = refreshCatalog(changed);
    if (publicRequest.current?.key !== catalogKey) {
      if (publicSources.key !== catalogKey) setPublicLoading(true);
      const controller = new AbortController();
      const promise = Promise.all([getSpectraPublicAgents({ limit: 100, signal: controller.signal }), getSpectraInstalledAgents({ signal: controller.signal })])
        .then(([published, installed]) => {
          if (currentScope.current !== catalogKey) return;
          setPublicSources({ key: catalogKey, public: published.agents, installed: installed.agents });
          setPublicError(null);
        }).catch((error) => {
          if (currentScope.current === catalogKey) setPublicError(error instanceof Error ? error.message : "Could not load published agents.");
        }).finally(() => {
          if (publicRequest.current?.promise === promise) publicRequest.current = null;
          if (currentScope.current === catalogKey) setPublicLoading(false);
        });
      publicRequest.current = { key: catalogKey, controller, promise };
    }
    await Promise.all([catalogRefresh, publicRequest.current.promise]);
  }, [catalogKey, publicSources.key, refreshCatalog]);
  const reload = useCallback(() => load(true), [load]);

  const firstLoad = useRef<string | null>(null);
  useEffect(() => {
    if (!catalogKey || firstLoad.current === catalogKey) return;
    firstLoad.current = catalogKey;
    void load();
  }, [catalogKey, load]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!requestedAgentId || openedQueryRef.current === requestedAgentId)
      return;
    if (!catalogKey) return;
    openedQueryRef.current = requestedAgentId;
    void openAgent(requestedAgentId);
  }, [catalogKey, openAgent, requestedAgentId]);

  const cards = useMemo(() => {
    // An agent you built stays in Yours even if you also follow it; an agent
    // you installed from Discover appears once, under Installed.
    const ownedIds = new Set(
      artifacts
        .filter((artifact) => artifact.ownership !== "shared")
        .map((artifact) => artifact._id),
    );
    const installed = installedAgents.filter(
      (agent) => !agent.ownedByViewer && !ownedIds.has(agent.agentId),
    );
    const installedIds = new Set(installed.map((agent) => agent.agentId));

    const accessible = artifacts
      .filter((artifact) => !installedIds.has(artifact._id))
      .map(accessibleCard);
    const accountedFor = new Set([
      ...artifacts.map((artifact) => artifact._id),
      ...installedIds,
    ]);

    return [
      ...accessible,
      ...installed.map(installedCard),
      ...publicAgents
        .filter((agent) => !accountedFor.has(agent.agentId))
        .map(publicCard),
    ];
  }, [artifacts, installedAgents, publicAgents]);

  const subjects = useMemo(
    () =>
      [
        ...new Set(
          cards
            .map((card) => card.subject)
            .filter((value) => value && value !== "General"),
        ),
      ].sort(),
    [cards],
  );
  const capabilities = useMemo(
    () =>
      [
        ...new Set(cards.flatMap((card) => card.capabilities).filter(Boolean)),
      ].sort(),
    [cards],
  );

  const visibleCards = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cards
      .filter((card) => subject === "all" || card.subject === subject)
      .filter(
        (card) =>
          capability === "all" || card.capabilities.includes(capability),
      )
      .filter(
        (card) =>
          !needle ||
          `${card.title}\n${card.summary}\n${card.subject}\n${card.capabilities.join(" ")}\n${card.owner.name}`
            .toLowerCase()
            .includes(needle),
      )
      .sort((left, right) => {
        if (sortMode === "title") return left.title.localeCompare(right.title);
        return right.updatedAt - left.updatedAt;
      });
  }, [capability, cards, search, sortMode, subject]);

  const discover = visibleCards.filter((card) => card.section === "discover");
  const installed = visibleCards.filter((card) => card.section === "installed");
  const yours = visibleCards.filter((card) => card.section === "yours");
  const shared = visibleCards.filter((card) => card.section === "shared");

  /** A blank draft, or one written from a starter (agent-starters.tsx). */
  async function createAgent(starter?: AgentStarter) {
    const payload = createDefaultArtifactPayload("agent");
    if (starter) {
      const content = payload.content as AgentContent;
      payload.title = starter.title;
      payload.summary = starter.summary;
      payload.content = {
        ...content,
        profile: { ...content.profile, purpose: starter.summary },
        instructions: { ...content.instructions, text: starter.instructions },
        routing: { ...content.routing, description: starter.summary },
      };
    }
    setBusyKey("create");
    // Dots gather where it was asked for; the agent's studio grows out of them.
    const creation = beginCreation();
    try {
      const result = await postSpectra<{ artifactId: string }>({
        action: "createArtifact",
        blueprintKey: "agent",
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        tags: payload.tags,
      });
      await reload();
      creation.land();
      await openAgent(result.artifactId);
      toast.success("Agent draft created.");
    } catch (error) {
      creation.cancel();
      toast.error(
        error instanceof Error ? error.message : "Could not create the agent.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  /**
   * Installing grants access to the published release and records the install.
   * The agent is referenced, never copied, so its owner keeps control of it.
   */
  async function installAgent(agent: SpectraPublicAgent) {
    setBusyKey(`public:${agent.agentId}`);
    try {
      await addSpectraPublicAgent(agent.agentId);
      await setSpectraAgentInstalled(agent.agentId, true);
      setPublicPreview(null);
      await reload();
      toast.success(`${agent.title} is installed.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not install this agent.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function uninstallAgent(card: LibraryCard) {
    setBusyKey(`public:${card.id}`);
    try {
      await setSpectraAgentInstalled(card.id, false);
      await reload();
      toast.success(`${card.title} is uninstalled.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not uninstall this agent.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function placeAgent(
    artifact: SpectraArtifact,
    workspace: SpectraWorkspace,
  ) {
    setBusyKey(`place:${artifact._id}`);
    try {
      await postSpectra({
        action: "addArtifactToWorkspace",
        artifactId: artifact._id,
        workspaceId: workspace._id,
      });
      setPlacementTarget(null);
      await reload();
      toast.success(`${artifact.title} was added to ${workspace.title}.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not add this agent to the workspace.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function archiveAgent(artifact: SpectraArtifact) {
    setBusyKey(`archive:${artifact._id}`);
    try {
      await postSpectra({
        action: "archiveArtifact",
        artifactId: artifact._id,
      });
      studio.closeStudio();
      await reload();
      toast.success("Agent archived.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not archive the agent.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  function openCard(card: LibraryCard) {
    if (card.artifact) void openAgent(card.artifact._id);
    else if (card.publicAgent) setPublicPreview(card.publicAgent);
  }

  function primaryAction(card: LibraryCard) {
    if (card.section === "installed") {
      void uninstallAgent(card);
      return;
    }
    if (card.publicAgent) {
      void installAgent(card.publicAgent);
      return;
    }
    if (!card.artifact) return;
    void openAgent(card.artifact._id, card.section === "shared");
  }

  function closeTab(artifactId: string) {
    if (studio.dirtyIds.has(artifactId)) {
      toast.message(
        "Wait for this agent draft to synchronize before closing it.",
      );
      return;
    }
    studio.closeTab(artifactId);
  }

  const renderCard = (card: LibraryCard) => (
    <AgentLibraryEntry
      key={card.id}
      card={card}
      busy={busyKey === `public:${card.id}` || busyKey === `place:${card.id}`}
      onOpen={() => openCard(card)}
      onPrimary={() => primaryAction(card)}
    />
  );

  if (studio.mode === "tab" && studio.activeArtifact) {
    return (
      <div className="relative h-full min-h-0">
        <ArtifactStudio
          mode="tab"
          artifact={studio.activeArtifact}
          artifacts={artifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          sourceLabel="Agent Library"
          onClose={closeStudio}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeTab}
          onArchive={archiveAgent}
          onShare={(artifact) => setShareTarget(artifact)}
          onDirtyChange={studio.setDirty}
        />
      </div>
    );
  }

  const filtered = subject !== "all" || capability !== "all" || sortMode !== "relevance";
  const agentCommands: BarCommand[] = [
    {
      id: "new",
      icon: "add",
      label: busyKey === "create" ? "Making…" : "New agent",
      pinned: true,
      disabled: busyKey === "create",
      onSelect: () => void createAgent(),
    },
    {
      id: "filter",
      icon: "filter",
      label: filtered ? "Filters on" : "Filter and sort",
      active: filtersOpen || filtered,
      onSelect: () => setFiltersOpen((value) => !value),
    },
  ];
  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <PageBody className="max-w-[1460px]">
          <PageHeader
            title="Agents"
            commands={agentCommands}
            plan={AGENT_BAR_PLAN}
            barLabel="Agents commands"
            description="Find, make and add agents for the work they are good at."
          />

          {/* Nothing to search until there is an agent; the starters below lead instead. */}
          {cards.length || search ? (
            <div className="mt-6 flex items-center gap-2.5">
              <label className="agent-library-filter min-w-0 flex-1">
                <Search className="size-4 shrink-0 text-[var(--text-tertiary)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search agents by name, subject, or capability…"
                  className="min-w-0 flex-1 bg-transparent text-micro outline-none placeholder:text-[var(--text-tertiary)]"
                />
                {search ? <IconButton icon="close" label="Clear search" size="compact" onClick={() => setSearch("")} /> : null}
              </label>
            </div>
          ) : null}
          {filtersOpen ? (
            <div className="mt-2 flex flex-wrap gap-2.5">
              <SelectField
                ariaLabel="Subject"
                value={subject}
                onChange={setSubject}
                options={[
                  { value: "all", label: "All subjects" },
                  ...subjects.map((value) => ({ value, label: value })),
                ]}
                size="lg"
                triggerClassName="min-w-[180px] bg-[var(--bg-elevated)]"
              />
              <SelectField
                ariaLabel="Capability"
                value={capability}
                onChange={setCapability}
                options={[
                  { value: "all", label: "Everything Spectra can read" },
                  ...capabilities.map((value) => ({ value, label: value })),
                ]}
                size="lg"
                triggerClassName="min-w-[200px] bg-[var(--bg-elevated)]"
              />
              <SelectField
                ariaLabel="Sort agents"
                value={sortMode}
                onChange={(next) => setSortMode(next as SortMode)}
                options={[
                  { value: "relevance", label: "Relevance" },
                  { value: "recent", label: "Recently updated" },
                  { value: "title", label: "Name" },
                ]}
                size="lg"
                triggerClassName="min-w-[160px] bg-[var(--bg-elevated)]"
              />
              {subject !== "all" || capability !== "all" || sortMode !== "relevance" ? (
                <Button variant="ghost" size="lg" onClick={() => { setSubject("all"); setCapability("all"); setSortMode("relevance"); }}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : null}

          {loading ? (
            <LoadingRows label="Loading agents" count={6} className="mt-8" />
          ) : (
            <>
              <CatalogProgress catalog={agentCatalog} label="agents" />
              {!agentCatalog.isDone && agentCatalog.items.length > 0 ? <p role="status" className="text-micro text-[var(--text-secondary)]">More agents and filter choices are loading.</p> : null}
              {publicError ? (
                <ProblemState
                  compact
                  title="Published agents couldn't load"
                  detail="Your own and shared agents are still here."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => void reload()}>
                      Try again
                    </Button>
                  }
                />
              ) : null}
              {!publicError && !discover.length && !installed.length && !yours.length && !shared.length && !search && subject === "all" && capability === "all" ? (
                <AgentStarters busy={busyKey === "create"} onStart={(starter) => void createAgent(starter)} />
              ) : !publicError && !discover.length && !installed.length && !yours.length && !shared.length ? (
                <EmptyState
                  icon="agent"
                  title="No agents match"
                  detail="Try other words or clear the filters."
                  action={
                    <Button variant="primary" size="sm" disabled={busyKey === "create"} onClick={() => void createAgent()}>
                      New agent
                    </Button>
                  }
                />
              ) : null}
              <LibrarySectionBlock
                title="Discover"
                description="Published agents whose owners opened them to your school. Installing references their release; it does not copy the agent."
                cards={discover}
                limit={expanded.has("discover") ? discover.length : 4}
                onViewAll={() =>
                  setExpanded((current) => new Set(current).add("discover"))
                }
              >
                {renderCard}
              </LibrarySectionBlock>
              <LibrarySectionBlock
                title="Installed"
                description="Agents you installed from Discover. They stay on the release their owner published, and you can uninstall at any time."
                cards={installed}
                limit={expanded.has("installed") ? installed.length : 4}
                onViewAll={() =>
                  setExpanded((current) => new Set(current).add("installed"))
                }
              >
                {renderCard}
              </LibrarySectionBlock>
              <LibrarySectionBlock
                title="Yours"
                description="Agents you built. Their skills, evidence and releases live in Agent Foundry."
                cards={yours}
                limit={expanded.has("yours") ? yours.length : 4}
                onViewAll={() =>
                  setExpanded((current) => new Set(current).add("yours"))
                }
              >
                {renderCard}
              </LibrarySectionBlock>
              <LibrarySectionBlock
                title="Shared"
                description="Agents shared with you directly, read-only or with edit access. Add them to any workspace you can modify."
                cards={shared}
                limit={expanded.has("shared") ? shared.length : 4}
                onViewAll={() =>
                  setExpanded((current) => new Set(current).add("shared"))
                }
              >
                {renderCard}
              </LibrarySectionBlock>
            </>
          )}
        </PageBody>
      </div>

      {studio.mode === "split" && studio.activeArtifact ? (
        <ArtifactStudio
          mode="split"
          artifact={studio.activeArtifact}
          artifacts={artifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          panelWidth={panelWidth}
          sourceLabel="Agent Library"
          onPanelWidthChange={setPanelWidth}
          onClose={closeStudio}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeTab}
          onArchive={archiveAgent}
          onShare={(artifact) => setShareTarget(artifact)}
          onDirtyChange={studio.setDirty}
        />
      ) : null}
      <Dialog
        open={Boolean(placementTarget)}
        onOpenChange={(next) => {
          if (!next) setPlacementTarget(null);
        }}
      >
        {placementTarget ? (
          <DialogContent layer="composer-dock" className="max-w-[460px] gap-0 p-5">
            <DialogHeader className="pr-8">
              <DialogTitle className="font-display text-metric">Add to a workspace</DialogTitle>
              <DialogDescription className="text-caption leading-5">
                Choose where {placementTarget.title} should appear. This
                personal placement does not re-share it with the workspace.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 max-h-[340px] space-y-1 overflow-y-auto">
              {workspaces.map((workspace) => {
                const alreadyPlaced = placementTarget.placements?.some(
                  (placement) => placement.workspaceId === workspace._id,
                );
                return (
                  <button
                    key={workspace._id}
                    type="button"
                    disabled={
                      alreadyPlaced ||
                      busyKey === `place:${placementTarget._id}`
                    }
                    onClick={() => void placeAgent(placementTarget, workspace)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-card px-3 text-left hover:bg-[var(--bg-hover)] disabled:opacity-45"
                  >
                    <span className="grid size-8 place-items-center rounded-control bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                      <Grid3X3 className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption font-semibold">
                        {workspace.title}
                      </span>
                      <span className="text-micro text-[var(--text-tertiary)]">
                        {alreadyPlaced
                          ? "Already added"
                          : workspace.ownership === "shared"
                            ? "Shared workspace"
                            : "Your workspace"}
                      </span>
                    </span>
                    {alreadyPlaced ? (
                      <CheckCircle2 className="size-4 text-[var(--success)]" />
                    ) : null}
                  </button>
                );
              })}
              <CatalogProgress catalog={workspaceCatalog} />
              {!workspaces.length && workspaceCatalog.status === "ready" && workspaceCatalog.isDone ? (
                <div className="rounded-card border border-dashed border-[var(--border-default)] p-6 text-center text-caption text-[var(--text-secondary)]">
                  Create a workspace before placing this agent.
                </div>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(publicPreview)}
        onOpenChange={(next) => {
          if (!next) setPublicPreview(null);
        }}
      >
        {publicPreview ? (
          <DialogContent layer="composer-dock" className="max-w-[560px] gap-0 p-5">
            <header className="flex items-start gap-3 pr-8">
              <span className="grid size-10 shrink-0 place-items-center rounded-card bg-[color-mix(in_oklab,var(--accent-mint)_10%,var(--bg-primary))] text-[var(--accent-mint)]">
                <Bot className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate font-display text-metric">
                  {publicPreview.title}
                </DialogTitle>
                <DialogDescription className="mt-1 text-micro">
                  Published release {publicPreview.releaseNumber} by{" "}
                  {publicPreview.owner.name}
                </DialogDescription>
              </div>
            </header>
            <p className="mt-5 text-ui leading-6 text-[var(--text-secondary)]">
              {publicPreview.summary || publicPreview.purpose}
            </p>
            <div className="mt-4 rounded-card bg-[var(--bg-secondary)] p-4">
              <div className="flex items-center gap-2 text-micro font-semibold">
                <ShieldCheck className="size-4 text-[var(--success)]" />
                What adding loads
              </div>
              <p className="mt-2 text-micro leading-5 text-[var(--text-secondary)]">
                Only this immutable published release, its allowed skills and
                tools, and permissioned resource bindings. The creator cannot
                see your prompts, memory, threads, or outputs.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {[...publicPreview.skills, ...publicPreview.tags]
                .slice(0, 8)
                .map((item) => (
                  <span
                    key={item}
                    className="rounded-chip bg-[var(--bg-secondary)] px-2.5 py-1 text-micro text-[var(--text-secondary)]"
                  >
                    {item}
                  </span>
                ))}
            </div>
            <DialogFooter className="mt-6 border-t border-[var(--border-subtle)] pt-4">
              <Button variant="ghost" size="sm" onClick={() => setPublicPreview(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busyKey === `public:${publicPreview.agentId}`}
                onClick={() => void installAgent(publicPreview)}
              >
                {busyKey === `public:${publicPreview.agentId}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Install agent
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {shareTarget ? (
        <ShareDialog
          open
          resourceType="agent"
          resourceId={shareTarget._id}
          title={shareTarget.title}
          onClose={() => setShareTarget(null)}
          onChanged={async () => {
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}
