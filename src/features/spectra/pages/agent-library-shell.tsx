"use client";

import dynamic from "next/dynamic";
import {
  Beaker,
  Bot,
  BookOpen,
  CheckCircle2,
  FilePenLine,
  FlaskConical,
  GraduationCap,
  Grid3X3,
  Loader2,
  MessageCircleQuestion,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { toast } from "sonner";
import { createDefaultArtifactPayload } from "../components/artifact-blueprint-sheet";
import {
  StudioSplitPlaceholder,
  useArtifactStudioState,
} from "../components/artifact-studio-shell";
import { CommandBar } from "../components/command-bar";
import {
  ContextFocusControl,
  type ComposerFocusMode,
} from "../components/context-controls";
import { ShareDialog } from "../components/share-dialog";
import { ProductPageHeader } from "../components/product-page-header";
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
import { formatRelativeTime } from "../components/spectra-view-model";
import { WorkbenchLiveStack } from "./workbench-live-stack";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { useAgentCatalog, useWorkspaceCatalog } from "../data/use-catalog-pages";
import { CatalogProgress } from "../components/catalog-progress";
import { createLatestStudioLoad } from "../components/latest-studio-load";
import { useSpectraContextStore } from "@/stores/spectra-context-store";

const ArtifactStudio = dynamic(
  () =>
    import("../components/artifact-studio").then(
      (module) => module.ArtifactStudio,
    ),
  { loading: () => <StudioSplitPlaceholder /> },
);

type SortMode = "relevance" | "recent" | "title";
type LibrarySection = "discover" | "installed" | "yours" | "shared";

type LibraryCard = {
  id: string;
  section: LibrarySection;
  title: string;
  summary: string;
  subject: string;
  capabilities: string[];
  owner: { name: string; avatarUrl?: string };
  updatedAt: number;
  releaseNumber?: number;
  rating?: number | null;
  ratingCount?: number;
  artifact?: SpectraArtifact;
  publicAgent?: SpectraPublicAgent;
  /** Installed agents reference a published release rather than copying it. */
  installedRelease?: number;
};

const cardIcons: LucideIcon[] = [
  FlaskConical,
  FilePenLine,
  BookOpen,
  WandSparkles,
  GraduationCap,
  Beaker,
  MessageCircleQuestion,
  ShieldCheck,
];
const cardTones = [
  { color: "var(--accent-mint)", soft: "color-mix(in oklab, var(--accent-mint) 10%, var(--bg-primary))" },
  { color: "var(--accent-orange)", soft: "#fff1e7" },
  { color: "var(--brand-primary)", soft: "#eeeaff" },
  { color: "var(--accent-cyan)", soft: "#e7f5fb" },
  { color: "var(--accent-coral)", soft: "#faedf2" },
];

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1)
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  return result;
}

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
    summary:
      artifact.summary?.trim() ||
      "Configure this specialist agent for a focused learning workflow.",
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

function avatarFallback(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "S"
  );
}

function LibraryAvatar({ owner }: { owner: LibraryCard["owner"] }) {
  return owner.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={owner.avatarUrl}
      alt=""
      className="size-5 rounded-full object-cover"
    />
  ) : (
    <span className="grid size-5 place-items-center rounded-full bg-[var(--bg-secondary)] text-micro font-bold text-[var(--text-secondary)]">
      {avatarFallback(owner.name)}
    </span>
  );
}

function AgentCard({
  card,
  busy,
  onOpen,
  onPrimary,
}: {
  card: LibraryCard;
  busy: boolean;
  onOpen: () => void;
  onPrimary: () => void;
}) {
  const signature = hash(card.id);
  const Icon = cardIcons[signature % cardIcons.length]!;
  const tone = cardTones[signature % cardTones.length]!;
  const placed = Boolean(card.artifact?.placements?.length);
  const primaryLabel =
    card.section === "yours"
      ? "Open agent"
      : card.section === "discover"
        ? "Install"
        : card.section === "installed"
          ? "Uninstall"
          : card.artifact?.placementsComplete === false
            ? "Use agent"
            : placed
            ? "Open agent"
            : "Add to workspace";
  return (
    <article
      className="agent-library-card group"
      style={
        {
          "--agent-color": tone.color,
          "--agent-soft": tone.soft,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="agent-library-card__body"
        onClick={onOpen}
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-card bg-[var(--agent-soft)] text-[var(--agent-color)] transition-transform duration-[var(--motion-base)] ease-standard group-hover:-rotate-2 group-hover:scale-[1.04]">
            <Icon className="size-[19px]" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="flex items-center gap-2">
              <span className="truncate text-ui font-semibold text-[var(--text-primary)]">
                {card.title}
              </span>
              {card.section === "yours" && card.releaseNumber ? (
                <CheckCircle2
                  className="size-3.5 shrink-0 text-[var(--success)]"
                  aria-label="Published"
                />
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-micro text-[var(--text-tertiary)]">
              {card.subject}
            </span>
          </span>
        </span>
        <span className="mt-4 line-clamp-2 min-h-10 text-left text-micro leading-5 text-[var(--text-secondary)]">
          {card.summary}
        </span>
        <span className="mt-4 flex items-center gap-2 text-micro text-[var(--text-tertiary)]">
          <LibraryAvatar owner={card.owner} />
          <span className="min-w-0 truncate font-medium text-[var(--text-secondary)]">
            {card.owner.name}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">
            {card.section === "yours"
              ? "Updated"
              : card.section === "shared"
                ? "Shared"
                : card.section === "installed"
                  ? "Installed"
                  : "Published"}{" "}
            {formatRelativeTime(card.updatedAt)}
          </span>
          {card.section === "discover" && typeof card.rating === "number" ? (
            <span className="ml-auto shrink-0 font-semibold text-[var(--accent-gold)]">
              ★ {card.rating.toFixed(1)} ({card.ratingCount})
            </span>
          ) : null}
        </span>
        <span className="mt-3 flex min-h-[22px] flex-wrap gap-1.5 overflow-hidden">
          {(card.capabilities.length ? card.capabilities : ["Specialist"])
            .slice(0, 3)
            .map((capability) => (
              <span
                key={capability}
                className="max-w-[42%] truncate rounded-full bg-[var(--bg-secondary)] px-2 py-1 text-micro text-[var(--text-secondary)]"
              >
                {capability}
              </span>
            ))}
        </span>
      </button>
      {/* One action treatment. This used to be tinted with `--agent-color`, a
          decorative tone picked by hashing the card id, so the same action was
          rose on one card and cyan on the next and "Open agent" read as
          destructive. The card's colour stays on the icon tile, where it is
          identity rather than instruction. */}
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={onPrimary}
        className="mx-2.5 mb-2.5 w-[calc(100%-20px)]"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : card.section === "installed" ? (
          <CheckCircle2 className="size-3.5" />
        ) : card.section === "discover" ||
          (card.section === "shared" && !placed) ? (
          <Plus className="size-3.5" />
        ) : (
          <Bot className="size-3.5" />
        )}
        {primaryLabel}
      </Button>
    </article>
  );
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
          <button
            type="button"
            onClick={onViewAll}
            className="shrink-0 text-micro font-semibold text-[var(--brand-primary)] hover:underline"
          >
            View all ({cards.length})
          </button>
        ) : null}
      </header>
      {cards.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {cards.slice(0, limit).map(children)}
        </div>
      ) : (
        <p className="flex items-center gap-2 py-4 text-caption text-[var(--text-secondary)]"><Sparkles className="size-4 text-[var(--text-tertiary)]" />No agents in this collection yet.</p>
      )}
    </section>
  );
}

export function AgentLibraryShell({
  initialAgentId,
}: { initialAgentId?: string } = {}) {
  const router = useRouter();
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
  const placementDialogRef = useRef<HTMLElement>(null);
  const publicPreviewDialogRef = useRef<HTMLElement>(null);
  useModalFocus(placementDialogRef, {
    open: Boolean(placementTarget),
    onClose: () => setPlacementTarget(null),
  });
  useModalFocus(publicPreviewDialogRef, {
    open: Boolean(publicPreview),
    onClose: () => setPublicPreview(null),
  });
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
  const [focusMode, setFocusMode] = useState<ComposerFocusMode>(
    activeAgentArtifact ? "artifact" : "global",
  );
  const runEngine = useSpectraRun({
    surface: activeAgentArtifact ? "artifact" : "chat",
    artifactId: activeAgentArtifactId,
    focusMode,
    selectedArtifactIds: activeAgentArtifact ? [activeAgentArtifact._id] : [],
    currentView: activeAgentArtifact ? "agent-editor" : "agent-library",
    onThreadReady: (threadId) => {
      router.push(`/chat?threadId=${encodeURIComponent(threadId)}`);
    },
  });

  useEffect(() => {
    setFocusMode(activeAgentArtifactId ? "artifact" : "global");
  }, [activeAgentArtifactId]);

  const load = useCallback(async (quiet = false) => {
    if (!catalogKey) { setPublicLoading(false); return; }
    const catalogRefresh = refreshCatalog(quiet);
    if (publicRequest.current?.key !== catalogKey) {
      if (!quiet) setPublicLoading(true);
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
  }, [catalogKey, refreshCatalog]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = window.setInterval(refreshVisible, 8_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
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

  async function createAgent() {
    const payload = createDefaultArtifactPayload("agent");
    setBusyKey("create");
    try {
      const result = await postSpectra<{ artifactId: string }>({
        action: "createArtifact",
        blueprintKey: "agent",
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        tags: payload.tags,
      });
      await load();
      await openAgent(result.artifactId);
      toast.success("Agent draft created.");
    } catch (error) {
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
      await load();
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
      await load();
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
      await load();
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
      await load();
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
    <AgentCard
      key={card.id}
      card={card}
      busy={busyKey === `public:${card.id}` || busyKey === `place:${card.id}`}
      onOpen={() => openCard(card)}
      onPrimary={() => primaryAction(card)}
    />
  );
  const artifactQuickChat = activeAgentArtifact ? (
    <CommandBar
          className="w-full"
          placeholder={`Ask Spectra anything about ${activeAgentArtifact.title}…`}
          allowAttachments
          busy={runEngine.submitting}
          onStop={runEngine.stop}
          onSubmit={(prompt, attachments) => runEngine.run(prompt, attachments)}
          context={
            <ContextFocusControl
              mode={focusMode}
              onModeChange={setFocusMode}
              artifact={activeAgentArtifact}
              selectedCount={1}
            />
          }
    />
  ) : null;

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
        <WorkbenchLiveStack>
          {artifactQuickChat}
        </WorkbenchLiveStack>
      </div>
    );
  }

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
      <div className="min-w-0 flex-1 overflow-y-auto pb-32">
        <main className="mx-auto w-full max-w-[1460px] px-5 py-6 sm:px-8 lg:px-10">
          <ProductPageHeader
            title="Agent library"
            description="Discover, create, and add specialised agents without loading every specialist into every conversation."
            actions={
              <button type="button" disabled={busyKey === "create"} onClick={() => void createAgent()} className="agent-library-create">
                {busyKey === "create" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                New agent
              </button>
            }
          />

          <div className="mt-6 flex items-center gap-2.5">
            <label className="agent-library-filter min-w-0 flex-1">
              <Search className="size-4 shrink-0 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search agents by name, subject, or capability…"
                className="min-w-0 flex-1 bg-transparent text-micro outline-none placeholder:text-[var(--text-tertiary)]"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X className="size-3.5 text-[var(--text-tertiary)]" />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              className={`relative grid size-10 shrink-0 place-items-center rounded-control border transition ${filtersOpen ? "border-[var(--text-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
              onClick={() => setFiltersOpen((value) => !value)}
              aria-label="Filter and sort agents"
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal className="size-4" />
              {subject !== "all" || capability !== "all" || sortMode !== "relevance" ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--brand-primary)]" /> : null}
            </button>
          </div>
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
                  { value: "all", label: "All capabilities" },
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
                <button type="button" className="h-10 px-2 text-micro font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => { setSubject("all"); setCapability("all"); setSortMode("relevance"); }}>
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-8 flex items-center gap-2 text-caption text-[var(--text-secondary)]"><Loader2 className="size-4 animate-spin" /> Loading agents…</div>
          ) : (
            <>
              <CatalogProgress catalog={agentCatalog} label="agents" />
              {!agentCatalog.isDone && agentCatalog.items.length > 0 ? <p role="status" className="text-micro text-[var(--text-secondary)]">More agents and filter choices are loading.</p> : null}
              {publicError ? <button type="button" onClick={() => void load()} className="text-micro text-[var(--text-secondary)]">Published agents could not be loaded. Retry</button> : null}
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
        </main>
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
      {studio.mode === "split" ? (
        <WorkbenchLiveStack>
          {artifactQuickChat}
        </WorkbenchLiveStack>
      ) : null}

      {!studio.activeArtifact ? (
        <WorkbenchLiveStack>
            <CommandBar
              className="w-full"
              placeholder="Ask Spectra anything about agents…"
              allowAttachments
              busy={runEngine.submitting}
              onStop={runEngine.stop}
              onSubmit={(prompt, attachments) =>
                runEngine.run(prompt, attachments)
              }
              context={
                <ContextFocusControl
                  mode={focusMode}
                  onModeChange={setFocusMode}
                />
              }
              menu={
                <button
                  type="button"
                  onClick={() => void createAgent()}
                  className="flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-left text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Plus className="h-4 w-4" />
                  New agent
                </button>
              }
            />
        </WorkbenchLiveStack>
      ) : null}

      {placementTarget ? (
        <div
          className="agent-library-overlay"
          onPointerDown={() => setPlacementTarget(null)}
        >
          <section
            className="agent-library-dialog"
            ref={placementDialogRef}
            tabIndex={-1}
            onPointerDown={(event) => event.stopPropagation()}
            aria-modal="true"
            role="dialog"
            aria-labelledby="agent-place-title"
          >
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="agent-place-title"
                  className="font-display text-metric font-semibold"
                >
                  Add to a workspace
                </h2>
                <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">
                  Choose where {placementTarget.title} should appear. This
                  personal placement does not re-share it with the workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlacementTarget(null)}
                className="grid size-8 place-items-center rounded-control hover:bg-[var(--bg-hover)]"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </header>
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
          </section>
        </div>
      ) : null}

      {publicPreview ? (
        <div
          className="agent-library-overlay"
          onPointerDown={() => setPublicPreview(null)}
        >
          <section
            className="agent-library-dialog max-w-[560px]"
            ref={publicPreviewDialogRef}
            tabIndex={-1}
            onPointerDown={(event) => event.stopPropagation()}
            aria-modal="true"
            role="dialog"
            aria-labelledby="public-agent-title"
          >
            <header className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-card bg-[color-mix(in_oklab,var(--accent-mint)_10%,var(--bg-primary))] text-[var(--accent-mint)]">
                <Bot className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  id="public-agent-title"
                  className="truncate font-display text-metric font-semibold"
                >
                  {publicPreview.title}
                </h2>
                <p className="mt-1 text-micro text-[var(--text-secondary)]">
                  Published release {publicPreview.releaseNumber} by{" "}
                  {publicPreview.owner.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPublicPreview(null)}
                className="grid size-8 place-items-center rounded-control hover:bg-[var(--bg-hover)]"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
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
                    className="rounded-full bg-[var(--bg-secondary)] px-2.5 py-1 text-micro text-[var(--text-secondary)]"
                  >
                    {item}
                  </span>
                ))}
            </div>
            <footer className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
              <button
                type="button"
                onClick={() => setPublicPreview(null)}
                className="h-9 rounded-control px-3 text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyKey === `public:${publicPreview.agentId}`}
                onClick={() => void installAgent(publicPreview)}
                className="inline-flex h-9 items-center gap-2 rounded-control bg-[var(--text-primary)] px-4 text-caption font-semibold text-[var(--bg-primary)] disabled:opacity-45"
              >
                {busyKey === `public:${publicPreview.agentId}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Install agent
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {shareTarget ? (
        <ShareDialog
          open
          resourceType="agent"
          resourceId={shareTarget._id}
          title={shareTarget.title}
          onClose={() => setShareTarget(null)}
          onChanged={async () => {
            await load();
          }}
        />
      ) : null}
    </div>
  );
}
