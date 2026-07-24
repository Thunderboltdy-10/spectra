"use client";

import {
  Beaker,
  Bot,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FilePenLine,
  FlaskConical,
  GraduationCap,
  Grid3X3,
  LibraryBig,
  Loader2,
  MessageCircleQuestion,
  Plus,
  Search,
  ShieldCheck,
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
import { toast } from "sonner";
import { createDefaultArtifactPayload } from "../components/artifact-blueprint-sheet";
import {
  ArtifactStudio,
  useArtifactStudioState,
} from "../components/artifact-studio";
import { CommandBar } from "../components/command-bar";
import { ShareDialog } from "../components/share-dialog";
import { normalizeAgentContent } from "../agents/model";
import {
  addSpectraPublicAgent,
  getSpectraArtifacts,
  getSpectraPublicAgents,
  getSpectraWorkspaces,
  postSpectra,
  type SpectraArtifact,
  type SpectraPublicAgent,
  type SpectraWorkspace,
} from "../data/api";
import { formatRelativeTime } from "../components/spectra-view-model";

type SortMode = "relevance" | "recent" | "title";
type LibrarySection = "owned" | "shared" | "public";

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
  { color: "#139b72", soft: "#e8f7f1" },
  { color: "#ed7a2c", soft: "#fff1e7" },
  { color: "#6d55ea", soft: "#eeeaff" },
  { color: "#168bc5", soft: "#e7f5fb" },
  { color: "#bf5c7e", soft: "#faedf2" },
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
  return candidate?.trim() || "All subjects";
}

function accessibleCard(artifact: SpectraArtifact): LibraryCard {
  const content = normalizeAgentContent(artifact.content);
  const skills = content.skills
    .filter((skill) => skill.enabled)
    .map((skill) => skill.name)
    .filter(Boolean);
  const capabilities = [...new Set([...skills, ...artifact.tags])].slice(0, 4);
  return {
    id: artifact._id,
    section: artifact.ownership === "shared" ? "shared" : "owned",
    title: artifact.title,
    summary:
      artifact.summary?.trim() ||
      content.profile.purpose.trim() ||
      "Configure this specialist agent for a focused learning workflow.",
    subject: subjectLabel(artifact.tags, skills),
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
    section: "public",
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
    <span className="grid size-5 place-items-center rounded-full bg-[var(--bg-secondary)] text-[8px] font-bold text-[var(--text-secondary)]">
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
    card.section === "owned"
      ? card.artifact?.placements?.length
        ? "Open agent"
        : "Added"
      : card.section === "public"
        ? "Add agent"
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
          <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--agent-soft)] text-[var(--agent-color)] transition-transform duration-300 group-hover:-rotate-2 group-hover:scale-[1.04]">
            <Icon className="size-[19px]" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                {card.title}
              </span>
              {card.section === "owned" && card.releaseNumber ? (
                <CheckCircle2
                  className="size-3.5 shrink-0 text-[var(--success)]"
                  aria-label="Published"
                />
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-[var(--text-tertiary)]">
              {card.subject}
            </span>
          </span>
        </span>
        <span className="mt-4 line-clamp-2 min-h-10 text-left text-[11px] leading-5 text-[var(--text-secondary)]">
          {card.summary}
        </span>
        <span className="mt-4 flex items-center gap-2 text-[9.5px] text-[var(--text-tertiary)]">
          <LibraryAvatar owner={card.owner} />
          <span className="min-w-0 truncate font-medium text-[var(--text-secondary)]">
            {card.owner.name}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">
            {card.section === "owned"
              ? "Updated"
              : card.section === "shared"
                ? "Shared"
                : "Published"}{" "}
            {formatRelativeTime(card.updatedAt)}
          </span>
          {card.section === "public" && typeof card.rating === "number" ? (
            <span className="ml-auto shrink-0 font-semibold text-[#b87618]">
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
                className="max-w-[42%] truncate rounded-full bg-[var(--bg-secondary)] px-2 py-1 text-[8.5px] text-[var(--text-secondary)]"
              >
                {capability}
              </span>
            ))}
        </span>
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onPrimary}
        className={`agent-library-card__action${card.section === "owned" ? " is-added" : ""}`}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : card.section === "owned" ? (
          <CheckCircle2 className="size-3.5" />
        ) : card.section === "public" ||
          (card.section === "shared" && !placed) ? (
          <Plus className="size-3.5" />
        ) : (
          <Bot className="size-3.5" />
        )}
        {primaryLabel}
      </button>
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
            className="font-display text-[19px] font-semibold text-[var(--text-primary)]"
          >
            {title}
          </h2>
          <p className="mt-0.5 text-[10.5px] text-[var(--text-secondary)]">
            {description}
          </p>
        </div>
        {cards.length > limit ? (
          <button
            type="button"
            onClick={onViewAll}
            className="shrink-0 text-[10px] font-semibold text-[var(--brand-primary)] hover:underline"
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
        <div className="flex min-h-28 items-center gap-3 rounded-[10px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_55%,transparent)] px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="text-[12px] font-semibold text-[var(--text-primary)]">
              Nothing here yet
            </p>
            <p className="mt-0.5 text-[10.5px] text-[var(--text-secondary)]">
              Create, accept, or explicitly add an agent to build this
              collection.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function AgentLibraryShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedAgentId = searchParams.get("agentId");
  const [artifacts, setArtifacts] = useState<SpectraArtifact[]>([]);
  const [publicAgents, setPublicAgents] = useState<SpectraPublicAgent[]>([]);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("all");
  const [capability, setCapability] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("relevance");
  const [expanded, setExpanded] = useState<Set<LibrarySection>>(
    () => new Set(),
  );
  const [placementTarget, setPlacementTarget] =
    useState<SpectraArtifact | null>(null);
  const [shareTarget, setShareTarget] = useState<SpectraArtifact | null>(null);
  const [publicPreview, setPublicPreview] = useState<SpectraPublicAgent | null>(
    null,
  );
  const [panelWidth, setPanelWidth] = useState(780);
  const openedQueryRef = useRef<string | null>(null);
  const studio = useArtifactStudioState(
    "spectra.agentLibrary.studio",
    artifacts,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [artifactResult, publicResult, workspaceResult] = await Promise.all(
        [
          getSpectraArtifacts({ blueprintKey: "agent", placement: "all" }),
          getSpectraPublicAgents({ limit: 100 }),
          getSpectraWorkspaces(),
        ],
      );
      setArtifacts(artifactResult.artifacts);
      setPublicAgents(publicResult.agents);
      setWorkspaces(
        workspaceResult.filter((workspace) => workspace.status === "active"),
      );
      return artifactResult.artifacts;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not load the Agent Library.",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!requestedAgentId || openedQueryRef.current === requestedAgentId)
      return;
    const artifact = artifacts.find(
      (candidate) => candidate._id === requestedAgentId,
    );
    if (!artifact) return;
    openedQueryRef.current = requestedAgentId;
    studio.openSplit(artifact);
  }, [artifacts, requestedAgentId, studio]);

  const cards = useMemo(() => {
    const accessible = artifacts.map(accessibleCard);
    const accessibleIds = new Set(artifacts.map((artifact) => artifact._id));
    return [
      ...accessible,
      ...publicAgents
        .filter((agent) => !accessibleIds.has(agent.agentId))
        .map(publicCard),
    ];
  }, [artifacts, publicAgents]);

  const subjects = useMemo(
    () =>
      [...new Set(cards.map((card) => card.subject).filter(Boolean))].sort(),
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

  const owned = visibleCards.filter((card) => card.section === "owned");
  const shared = visibleCards.filter((card) => card.section === "shared");
  const discover = visibleCards.filter((card) => card.section === "public");

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
      const next = await load();
      const created = next.find(
        (artifact) => artifact._id === result.artifactId,
      );
      if (created) studio.openTab(created);
      toast.success("Agent draft created.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the agent.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function addPublic(agent: SpectraPublicAgent) {
    setBusyKey(`public:${agent.agentId}`);
    try {
      await addSpectraPublicAgent(agent.agentId);
      setPublicPreview(null);
      await load();
      toast.success(`${agent.title} was added to your Agent Library.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add this agent.",
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
    if (card.artifact) studio.openSplit(card.artifact);
    else if (card.publicAgent) setPublicPreview(card.publicAgent);
  }

  function primaryAction(card: LibraryCard) {
    if (card.publicAgent) {
      void addPublic(card.publicAgent);
      return;
    }
    if (!card.artifact) return;
    if (card.section === "shared" && !card.artifact.placements?.length) {
      setPlacementTarget(card.artifact);
      return;
    }
    studio.openSplit(card.artifact);
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

  if (studio.mode === "tab" && studio.activeArtifact) {
    return (
      <ArtifactStudio
        mode="tab"
        artifact={studio.activeArtifact}
        artifacts={artifacts}
        tabs={studio.tabs}
        dirtyIds={studio.dirtyIds}
        sourceLabel="Agent Library"
        onClose={studio.closeStudio}
        onExpand={studio.openTab}
        onActivateTab={studio.activateTab}
        onCloseTab={closeTab}
        onArchive={archiveAgent}
        onShare={(artifact) => setShareTarget(artifact)}
        onDirtyChange={studio.setDirty}
      />
    );
  }

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
      <div className="min-w-0 flex-1 overflow-y-auto pb-32">
        <div className="agent-library-topbar">
          <span className="flex items-center gap-2">
            <Grid3X3 className="size-3.5" />
            Home
          </span>
          <ChevronDown className="size-3 -rotate-90 text-[var(--text-tertiary)]" />
          <span>Agents</span>
          <ChevronDown className="size-3 -rotate-90 text-[var(--text-tertiary)]" />
          <strong className="font-semibold text-[var(--text-primary)]">
            Agent Library
          </strong>
          <span className="ml-auto hidden items-center gap-1.5 text-[10px] text-[var(--success)] sm:flex">
            <CheckCircle2 className="size-3.5" />
            Live collection
          </span>
          <button
            type="button"
            disabled={busyKey === "create"}
            onClick={() => void createAgent()}
            className="agent-library-create"
          >
            {busyKey === "create" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            New agent
          </button>
        </div>

        <main className="mx-auto w-full max-w-[1460px] px-5 py-6 sm:px-8 lg:px-10">
          <header className="flex items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#e8f7f1] text-[#149a72]">
              <LibraryBig className="size-5" />
            </span>
            <div className="min-w-0">
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                Agent library
              </span>
              <h1 className="mt-1 font-display text-[31px] font-semibold leading-none text-[var(--text-primary)]">
                Agent Library
              </h1>
              <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
                Discover, create, and add specialised agents without loading
                every specialist into every conversation.
              </p>
            </div>
          </header>

          <div className="mt-6 grid gap-2.5 lg:grid-cols-[minmax(320px,1fr)_190px_210px_160px]">
            <label className="agent-library-filter min-w-0">
              <Search className="size-4 shrink-0 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search agents by name, subject, or capability…"
                className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[var(--text-tertiary)]"
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
            <label className="agent-library-filter">
              <span className="sr-only">Subject</span>
              <select
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="w-full appearance-none bg-transparent pr-6 text-[13px] outline-none"
              >
                <option value="all">All subjects</option>
                {subjects.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none size-3.5 text-[var(--text-tertiary)]" />
            </label>
            <label className="agent-library-filter">
              <span className="sr-only">Capability</span>
              <select
                value={capability}
                onChange={(event) => setCapability(event.target.value)}
                className="w-full appearance-none bg-transparent pr-6 text-[13px] outline-none"
              >
                <option value="all">All capabilities</option>
                {capabilities.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none size-3.5 text-[var(--text-tertiary)]" />
            </label>
            <label className="agent-library-filter">
              <span className="sr-only">Sort agents</span>
              <select
                value={sortMode}
                onChange={(event) =>
                  setSortMode(event.target.value as SortMode)
                }
                className="w-full appearance-none bg-transparent pr-6 text-[13px] outline-none"
              >
                <option value="relevance">Sort: Relevance</option>
                <option value="recent">Sort: Recent</option>
                <option value="title">Sort: Name</option>
              </select>
              <ChevronDown className="pointer-events-none size-3.5 text-[var(--text-tertiary)]" />
            </label>
          </div>

          {loading ? (
            <div className="mt-7 space-y-8">
              {[0, 1, 2].map((section) => (
                <div key={section}>
                  <div className="mb-3 h-9 w-48 animate-pulse rounded-[7px] bg-[var(--bg-secondary)]" />
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {[0, 1, 2, 3].map((card) => (
                      <div
                        key={card}
                        className="h-[236px] animate-pulse rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <LibrarySectionBlock
                title="My agents"
                description="Agents you own and can train, publish, share, and use."
                cards={owned}
                limit={expanded.has("owned") ? owned.length : 4}
                onViewAll={() =>
                  setExpanded((current) => new Set(current).add("owned"))
                }
              >
                {renderCard}
              </LibrarySectionBlock>
              <LibrarySectionBlock
                title="Shared with me"
                description="Accepted agents from members of your school; add them to any workspace you can modify."
                cards={shared}
                limit={expanded.has("shared") ? shared.length : 4}
                onViewAll={() =>
                  setExpanded((current) => new Set(current).add("shared"))
                }
              >
                {renderCard}
              </LibrarySectionBlock>
              <LibrarySectionBlock
                title="Discover"
                description="Published agents whose owners explicitly enabled public access for your school context."
                cards={discover}
                limit={expanded.has("public") ? discover.length : 4}
                onViewAll={() =>
                  setExpanded((current) => new Set(current).add("public"))
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
          onClose={studio.closeStudio}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeTab}
          onArchive={archiveAgent}
          onShare={(artifact) => setShareTarget(artifact)}
          onDirtyChange={studio.setDirty}
        />
      ) : null}

      {!studio.activeArtifact ? (
        <div className="agent-library-composer pointer-events-none">
          <div className="pointer-events-auto w-full">
            <CommandBar
              className="w-full"
              placeholder="Ask Spectra anything about agents…"
              onSubmit={(prompt) => {
                router.push(`/chat?prompt=${encodeURIComponent(prompt)}`);
                return true;
              }}
              context={
                <span className="flex h-full min-w-[88px] items-center gap-2 px-3 text-[11px] font-semibold text-[var(--text-primary)]">
                  <Bot className="size-4 shrink-0 text-[var(--brand-primary)]" />
                  Agents
                </span>
              }
              menu={
                <button
                  type="button"
                  onClick={() => void createAgent()}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Plus className="h-4 w-4" />
                  New agent
                </button>
              }
            />
          </div>
        </div>
      ) : null}

      {placementTarget ? (
        <div
          className="agent-library-overlay"
          onPointerDown={() => setPlacementTarget(null)}
        >
          <section
            className="agent-library-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            aria-modal="true"
            role="dialog"
            aria-labelledby="agent-place-title"
          >
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="agent-place-title"
                  className="font-display text-[22px] font-semibold"
                >
                  Add to a workspace
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Choose where {placementTarget.title} should appear. This
                  personal placement does not re-share it with the workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlacementTarget(null)}
                className="grid size-8 place-items-center rounded-[8px] hover:bg-[var(--bg-hover)]"
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
                    className="flex min-h-12 w-full items-center gap-3 rounded-[9px] px-3 text-left hover:bg-[var(--bg-hover)] disabled:opacity-45"
                  >
                    <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                      <Grid3X3 className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">
                        {workspace.title}
                      </span>
                      <span className="text-[10px] text-[var(--text-tertiary)]">
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
              {!workspaces.length ? (
                <div className="rounded-[9px] border border-dashed border-[var(--border-default)] p-6 text-center text-[12px] text-[var(--text-secondary)]">
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
            onPointerDown={(event) => event.stopPropagation()}
            aria-modal="true"
            role="dialog"
            aria-labelledby="public-agent-title"
          >
            <header className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#e8f7f1] text-[#149a72]">
                <Bot className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  id="public-agent-title"
                  className="truncate font-display text-[23px] font-semibold"
                >
                  {publicPreview.title}
                </h2>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  Published release {publicPreview.releaseNumber} by{" "}
                  {publicPreview.owner.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPublicPreview(null)}
                className="grid size-8 place-items-center rounded-[8px] hover:bg-[var(--bg-hover)]"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </header>
            <p className="mt-5 text-[13px] leading-6 text-[var(--text-secondary)]">
              {publicPreview.summary || publicPreview.purpose}
            </p>
            <div className="mt-4 rounded-[10px] bg-[var(--bg-secondary)] p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold">
                <ShieldCheck className="size-4 text-[var(--success)]" />
                What adding loads
              </div>
              <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
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
                    className="rounded-full bg-[var(--bg-secondary)] px-2.5 py-1 text-[9.5px] text-[var(--text-secondary)]"
                  >
                    {item}
                  </span>
                ))}
            </div>
            <footer className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
              <button
                type="button"
                onClick={() => setPublicPreview(null)}
                className="h-9 rounded-[8px] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyKey === `public:${publicPreview.agentId}`}
                onClick={() => void addPublic(publicPreview)}
                className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-4 text-[12px] font-semibold text-[var(--bg-primary)] disabled:opacity-45"
              >
                {busyKey === `public:${publicPreview.agentId}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Add agent
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
