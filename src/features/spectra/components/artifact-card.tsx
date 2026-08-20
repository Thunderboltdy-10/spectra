import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Bot,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Check,
  Code2,
  FileText,
  HelpCircle,
  MessageSquare,
  MoreHorizontal,
  Presentation,
  Share2,
  Sparkles,
  Table2,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactTypeKey } from "../artifacts/types";
import { useArtifactAiActivity } from "../collaboration/artifact-ai-activity";
import { getWorkDefinition } from "../work/registry";
import {
  CardTypeIcon,
  SpectraCard,
  type SpectraCardState,
} from "./card-system";
import { previewText } from "./preview-text";

const AI_EDITED_FLASH_FALLBACK_MS = 90_000;

function resolveCardAiState(
  aiState: ArtifactCardView["aiState"] | undefined,
  updatedAt: number | undefined,
  now: number,
  expiresAt?: number,
): ArtifactCardView["aiState"] | undefined {
  if (aiState === "failed") return aiState;
  if (aiState === "creating" || aiState === "updating") {
    // Convex can leave working states after a failed/settled run. Without a
    // fresh update window the card must stop the infinite working sweep.
    const fresh = typeof updatedAt === "number" && now - updatedAt < 45_000;
    return fresh ? aiState : undefined;
  }
  if (aiState === "edited" || aiState === "generated") {
    const expiry =
      expiresAt ??
      (updatedAt ? updatedAt + AI_EDITED_FLASH_FALLBACK_MS : undefined);
    if (expiry && expiry > now) return "edited";
    return undefined;
  }
  return aiState;
}

export type ArtifactCardView = {
  id: string;
  title: string;
  blueprintKey: ArtifactTypeKey | "thread_reference";
  summary: string;
  meta: string;
  placement: "inbox" | "shared" | "workspace";
  /**
   * What the card's footer says instead of its placement. A surface that already
   * shows where a work lives — the board shows the folder path in `meta` — would
   * otherwise repeat itself, and "In workspace" under a card filed at the top
   * level is simply untrue.
   */
  footer?: string;
  shared?: boolean;
  accessLevel?: "read" | "modify";
  accessExplanation?: string;
  updatedAt?: number;
  aiStateExpiresAt?: number;
  pinned?: boolean;
  variant?: string;
  metrics?: Record<string, string | number>;
  aiState?: "generated" | "edited" | "creating" | "updating" | "failed";
  aiProgress?: number;
};

/**
 * The visual identity of each type: an icon and a colour.
 *
 * Names are deliberately absent. A type is named once, in `work/registry`, and
 * every surface reads it from there. This map used to carry its own labels and
 * they had drifted from the registry: a plan read as "Task", a calendar as
 * "Timetable", a board as "Whiteboard" and flashcards as "Deck", so the same
 * work answered to two different names depending on whether you were looking at
 * a card or at the studio that opens it.
 */
const blueprintIdentity: Record<
  ArtifactCardView["blueprintKey"],
  { icon: LucideIcon; color: string; soft: string }
> = {
  document: {
    icon: FileText,
    color: "var(--mode-document)",
    soft: "color-mix(in oklab, var(--mode-document) 9%, var(--bg-elevated))",
  },
  thread_reference: {
    icon: MessageSquare,
    color: "#8b6ff0",
    soft: "color-mix(in oklab, #8b6ff0 10%, var(--bg-elevated))",
  },
  flashcard_deck: {
    icon: BookOpen,
    color: "var(--mode-document)",
    soft: "color-mix(in oklab, var(--mode-document) 9%, var(--bg-elevated))",
  },
  quiz: {
    icon: HelpCircle,
    color: "var(--mode-quiz)",
    soft: "color-mix(in oklab, var(--mode-quiz) 9%, var(--bg-elevated))",
  },
  planner_task: {
    icon: CalendarCheck2,
    color: "#d47a16",
    soft: "color-mix(in oklab, #d47a16 10%, var(--bg-elevated))",
  },
  agent: {
    icon: Bot,
    color: "#1785a5",
    soft: "color-mix(in oklab, #1785a5 9%, var(--bg-elevated))",
  },
  timetable: {
    icon: CalendarDays,
    color: "#16735d",
    soft: "color-mix(in oklab, #16735d 9%, var(--bg-elevated))",
  },
  presentation: {
    icon: Presentation,
    color: "#cf6d48",
    soft: "color-mix(in oklab, #cf6d48 9%, var(--bg-elevated))",
  },
  sheets: {
    icon: Table2,
    color: "#2f855a",
    soft: "color-mix(in oklab, #2f855a 9%, var(--bg-elevated))",
  },
  code: {
    icon: Code2,
    color: "#5166a8",
    soft: "color-mix(in oklab, #5166a8 9%, var(--bg-elevated))",
  },
  whiteboard: {
    icon: Workflow,
    color: "#9a6a39",
    soft: "color-mix(in oklab, #9a6a39 9%, var(--bg-elevated))",
  },
};

export const blueprintMeta = Object.freeze(
  Object.fromEntries(
    Object.entries(blueprintIdentity).map(([key, identity]) => [
      key,
      {
        ...identity,
        // A thread is a conversation, not a work type, so it is the one label
        // the registry does not own.
        label:
          key === "thread_reference"
            ? "Thread"
            : getWorkDefinition(key as ArtifactTypeKey).userFacingName,
      },
    ]),
  ),
) as Record<
  ArtifactCardView["blueprintKey"],
  { label: string; icon: LucideIcon; color: string; soft: string }
>;

export function ArtifactCard({
  artifact,
  selected = false,
  actions,
  onSelect,
  className,
  size = "normal",
  quiet = false,
  selectionMode = false,
  contextSelected = false,
  onToggleContext,
}: {
  artifact: ArtifactCardView;
  selected?: boolean;
  actions?: ReactNode;
  onSelect?: () => void;
  className?: string;
  size?: "compact" | "normal" | "large";
  quiet?: boolean;
  selectionMode?: boolean;
  contextSelected?: boolean;
  onToggleContext?: () => void;
}) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const interactive = Boolean(onSelect);
  const metrics = Object.entries(artifact.metrics ?? {}).slice(
    0,
    size === "compact" ? 0 : 4,
  );
  const [aiClock, setAiClock] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!actionsOpen) return;
    const close = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node))
        setActionsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [actionsOpen]);
  useEffect(() => {
    setAiClock(Date.now());
  }, []);
  useEffect(() => {
    if (!aiClock) return;
    const resolved = resolveCardAiState(
      artifact.aiState,
      artifact.updatedAt,
      aiClock,
      artifact.aiStateExpiresAt,
    );
    if (
      resolved !== "edited" &&
      resolved !== "generated" &&
      resolved !== "creating" &&
      resolved !== "updating"
    )
      return;
    const expiry =
      resolved === "creating" || resolved === "updating"
        ? (artifact.updatedAt ?? aiClock) + 45_000
        : (artifact.aiStateExpiresAt ??
          (artifact.updatedAt
            ? artifact.updatedAt + AI_EDITED_FLASH_FALLBACK_MS
            : undefined));
    if (!expiry || expiry <= aiClock) return;
    const timer = window.setTimeout(
      () => setAiClock(Date.now()),
      Math.max(16, expiry - Date.now() + 24),
    );
    return () => window.clearTimeout(timer);
  }, [
    aiClock,
    artifact.aiState,
    artifact.aiStateExpiresAt,
    artifact.updatedAt,
  ]);
  const liveAiState = resolveCardAiState(
    artifact.aiState,
    artifact.updatedAt,
    aiClock,
    artifact.aiStateExpiresAt,
  );
  const liveAiActivity = useArtifactAiActivity(artifact.id);
  const cardState: SpectraCardState = contextSelected
    ? selectionMode
      ? "multi-selected"
      : "context"
    : selected
      ? "focused"
      : liveAiActivity
        ? "updating"
        : liveAiState === "updating"
          ? "updating"
          : liveAiState === "creating"
            ? "creating"
            : liveAiState === "edited" || liveAiState === "generated"
              ? "edited"
              : "normal";

  return (
    <SpectraCard
      variant={
        artifact.pinned
          ? "pinned"
          : artifact.placement === "inbox"
            ? "inbox"
            : "artifact"
      }
      state={cardState}
      accent={artifact.pinned ? "var(--card-pinned)" : meta.color}
      className={cn(
        "spectra-artifact-card min-w-0 overflow-hidden text-left",
        size === "large"
          ? "min-h-[216px] rounded-[9px] p-4"
          : "rounded-[8px] p-3.5",
        interactive ? "cursor-pointer" : "",
        quiet ? "shadow-none" : "shadow-[0_1px_2px_rgba(27,20,12,0.03)]",
        className,
      )}
      onClick={(event) => {
        if (
          onToggleContext &&
          (selectionMode || event.metaKey || event.ctrlKey)
        ) {
          onToggleContext();
          return;
        }
        onSelect?.();
      }}
      data-interactive={interactive ? "true" : undefined}
      data-ai-state={liveAiActivity ? "updating" : liveAiState}
      data-context-state={
        contextSelected ? "selected" : selected ? "focused" : "normal"
      }
    >
      {selectionMode ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleContext?.();
          }}
          className={`absolute right-2.5 top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-[6px] border transition-all duration-200 ${contextSelected ? "scale-100 border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-transparent hover:border-[var(--text-primary)]"}`}
          aria-label={
            contextSelected ? "Remove from selection" : "Add to selection"
          }
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="relative z-[1] flex min-w-0 items-start gap-2.5">
        <CardTypeIcon icon={Icon} color={meta.color} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden pr-4">
            <span className="shrink-0 text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              {meta.label}
            </span>
            {/* The generic chip is only for work we cannot yet describe. Once a
                semantic frame arrives, the activity line below says what is
                actually happening and this would just repeat it less precisely. */}
            {!liveAiActivity?.detail &&
            (liveAiActivity ||
              liveAiState === "creating" ||
              liveAiState === "updating") ? (
              <span className="spectra-card-ai-activity inline-flex shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))] px-1.5 py-0.5 text-micro font-semibold text-[var(--accent-cyan)]">
                <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                AI {liveAiState === "creating" ? "building" : "editing"}
              </span>
            ) : null}
            {artifact.shared ? (
              <span
                className="inline-flex items-center text-[var(--text-tertiary)]"
                title={
                  artifact.accessLevel === "read"
                    ? "Shared with read-only access"
                    : "Shared work"
                }
                aria-label={
                  artifact.accessLevel === "read"
                    ? "Shared with read-only access"
                    : "Shared work"
                }
              >
                <Share2 className="h-3 w-3" aria-hidden="true" />
              </span>
            ) : null}
            {/* No meta, no separator. A surface that has nothing to add beyond
                the type — a board column that already named the folder — would
                otherwise leave a bullet pointing at nothing. */}
            {artifact.meta ? (
              <>
                <span className="spectra-artifact-card-meta shrink-0 text-micro text-[var(--text-tertiary)]">
                  •
                </span>
                <span className="spectra-artifact-card-meta min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">
                  {artifact.meta}
                </span>
              </>
            ) : null}
          </div>
          {interactive ? (
            <button
              type="button"
              title={artifact.title}
              onClick={(event) => {
                event.stopPropagation();
                if (selectionMode && onToggleContext) onToggleContext();
                else onSelect?.();
              }}
              className={cn(
                "mt-2 block max-w-full rounded-[4px] text-left text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]",
                size === "large"
                  ? "line-clamp-2 break-words text-[20px] font-semibold leading-[1.12] font-display"
                  : "line-clamp-2 break-words text-[14px] font-semibold leading-[1.25]",
              )}
            >
              {artifact.title}
            </button>
          ) : (
            <h3
              title={artifact.title}
              className={cn(
                "mt-2 text-[var(--text-primary)]",
                size === "large"
                  ? "line-clamp-2 break-words text-[20px] font-semibold leading-[1.12] font-display"
                  : "line-clamp-2 break-words text-[14px] font-semibold leading-[1.25]",
              )}
            >
              {artifact.title}
            </h3>
          )}
          <p
            className={cn(
              "mt-1.5 text-[11px] leading-4 text-[var(--text-secondary)]",
              size === "large" ? "line-clamp-3" : "line-clamp-2",
            )}
          >
            {previewText(artifact.summary)}
          </p>
          {artifact.accessExplanation ? (
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-micro text-[var(--text-tertiary)]">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate" title={artifact.accessExplanation}>{artifact.accessExplanation}</span>
            </div>
          ) : null}
          {liveAiActivity?.detail ? (
            <div
              className="spectra-card-activity"
              data-act={liveAiActivity.kind}
              role="status"
              aria-live="polite"
            >
              <Sparkles className="spectra-card-activity-spark" />
              <span className="spectra-card-activity-text">
                {liveAiActivity.label ? (
                  <strong>{liveAiActivity.label}</strong>
                ) : null}
                {liveAiActivity.detail}
              </span>
            </div>
          ) : null}
          {artifact.aiState === "creating" &&
          typeof artifact.aiProgress === "number" ? (
            <div
              className="mt-3 h-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))]"
              role="progressbar"
              aria-label={`Creating ${artifact.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(artifact.aiProgress * 100)}
            >
              <span
                className="block h-full rounded-full bg-[var(--accent-cyan)] transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${Math.max(4, artifact.aiProgress * 100)}%` }}
              />
            </div>
          ) : null}
          {metrics.length > 0 ? (
            <div className="spectra-artifact-card-metrics mt-4 grid min-w-0 grid-cols-3 gap-1.5">
              {metrics.slice(0, 3).map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 overflow-hidden border-l border-[var(--card-border-soft)] px-2 py-0.5 first:border-l-0 first:pl-0"
                >
                  <div className="truncate font-sans text-[12px] font-normal text-[var(--text-primary)]" title={String(value)}>
                    {value}
                  </div>
                  <div className="truncate text-micro text-[var(--text-tertiary)]" title={label}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-2.5 flex min-h-7 min-w-0 items-end justify-between gap-2">
            <div className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">
              {artifact.footer ??
                (artifact.placement === "workspace" ? "In workspace" : "General")}
            </div>
            {actions ? (
              <div
                ref={actionsRef}
                className="relative shrink-0"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  aria-label={`More actions for ${artifact.title}`}
                  aria-expanded={actionsOpen}
                  onClick={() => setActionsOpen((open) => !open)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {actionsOpen ? (
                  <div className="absolute bottom-[calc(100%+6px)] right-0 z-40 flex items-center gap-1 rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">
                    {actions}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </SpectraCard>
  );
}
