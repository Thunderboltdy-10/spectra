import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Check, MoreHorizontal, Share2, Building2, Loader2 } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import type { ArtifactTypeKey } from "../artifacts/types";
import { useArtifactAiActivity } from "../collaboration/artifact-ai-activity";
import { workTypeMeta } from "../artifacts/presentation";
export { workTypeMeta } from "../artifacts/presentation";
import {
  CardTypeIcon,
  SpectraCard,
  type SpectraCardState,
} from "./card-system";
import { previewText } from "./preview-text";
import { formatByteCount } from "../../../../shared/human-format";

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

/** How long after it was made a card still arrives, rather than simply being there. */
const ARRIVAL_WINDOW_MS = 30_000;

/**
 * Who a card is arriving from, when it is new: Spectra's work travels from the
 * prism; the user's own forms where they acted. Anything older is content.
 */
export function cardArrival(
  artifact: Pick<ArtifactCardView, "createdAt">,
  aiState: ArtifactCardView["aiState"] | undefined,
  now: number,
): "ai" | "human" | undefined {
  if (aiState === "creating") return "ai";
  if (!artifact.createdAt || now - artifact.createdAt > ARRIVAL_WINDOW_MS) return undefined;
  return aiState === "generated" ? "ai" : "human";
}

export type ArtifactCardView = {
  id: string;
  title: string;
  blueprintKey: ArtifactTypeKey | "thread_reference" | "resource";
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
  /** When it came to be: a card new since the page opened forms in the field (LIFE.md). */
  createdAt?: number;
  aiStateExpiresAt?: number;
  pinned?: boolean;
  variant?: string;
  metrics?: Record<string, string | number>;
  aiState?: "generated" | "edited" | "creating" | "updating" | "failed";
  aiProgress?: number;
};

export function ArtifactCard({
  artifact,
  selected = false,
  active = false,
  actions,
  onSelect,
  className,
  size = "normal",
  quiet = false,
  selectionMode = false,
  contextSelected = false,
  onToggleContext,
  onContextMenu,
  onBeginDrag,
}: {
  artifact: ArtifactCardView;
  selected?: boolean;
  /** This work is open in the adjacent studio. Distinct from picker context. */
  active?: boolean;
  actions?: ReactNode;
  onSelect?: () => void;
  className?: string;
  size?: "compact" | "normal" | "large";
  quiet?: boolean;
  selectionMode?: boolean;
  contextSelected?: boolean;
  onToggleContext?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  onBeginDrag?: (event: PointerEvent) => void;
}) {
  const meta = workTypeMeta[artifact.blueprintKey];
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
    const close = (event: globalThis.PointerEvent) => {
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
    : active
      ? "selected"
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

  const arrival = cardArrival(artifact, liveAiState, aiClock);

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
      lifeKey={`artifact:${artifact.id}`}
      arrival={arrival}
      accent={artifact.pinned ? "var(--card-pinned)" : meta.color}
      className={cn(
        "spectra-artifact-card min-w-0 overflow-hidden text-left",
        size === "large"
          ? "min-h-[216px] rounded-card p-4"
          : "rounded-control p-3.5",
        interactive ? "cursor-pointer" : "",
        quiet ? "shadow-none" : "shadow-[var(--shadow-sm)]",
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
      onContextMenu={onContextMenu}
      onPointerDown={onBeginDrag}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (event: KeyboardEvent<HTMLElement>) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelect?.();
            }
          : undefined
      }
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
          className={`absolute right-2.5 top-2.5 z-chrome flex h-6 w-6 items-center justify-center rounded-chip border transition-[background-color,border-color,color,transform] duration-[var(--motion-fast)] ease-standard ${contextSelected ? "scale-100 border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-transparent hover:border-[var(--text-primary)]"}`}
          aria-label={
            contextSelected ? "Remove from selection" : "Add to selection"
          }
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="relative z-base flex min-w-0 items-start gap-2.5">
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
                <Loader2 className="h-2.5 w-2.5" aria-hidden="true" />
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
                <span className="spectra-artifact-card-meta min-w-0 truncate text-micro text-[var(--text-tertiary)]">
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
                "mt-2 block max-w-full rounded-chip text-left text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]",
                size === "large"
                  ? "line-clamp-2 break-words text-heading font-semibold leading-[1.12] font-display"
                  : "line-clamp-2 break-words text-body font-semibold leading-[1.25]",
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
                  ? "line-clamp-2 break-words text-heading font-semibold leading-[1.12] font-display"
                  : "line-clamp-2 break-words text-body font-semibold leading-[1.25]",
              )}
            >
              {artifact.title}
            </h3>
          )}
          <p
            className={cn(
              "mt-1.5 text-micro leading-4 text-[var(--text-secondary)]",
              size === "large" ? "line-clamp-3" : "line-clamp-2",
            )}
          >
            {previewText(
              artifact.summary.replace(/^(\d+) bytes$/i, (_, value: string) =>
                formatByteCount(Number(value)),
              ),
            )}
          </p>
          {artifact.accessExplanation ? (
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-micro text-[var(--text-tertiary)]">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate" title={artifact.accessExplanation}>
                {artifact.accessExplanation}
              </span>
            </div>
          ) : null}
          {liveAiActivity?.detail ? (
            <div
              className="spectra-card-activity"
              data-act={liveAiActivity.kind}
              role="status"
              aria-live="polite"
            >
              <Loader2 className="spectra-card-activity-spark" />
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
                className="block h-full rounded-full bg-[var(--accent-cyan)] transition-[width] duration-[var(--motion-slow)] ease-standard motion-reduce:transition-none"
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
                  <div
                    className="truncate font-sans text-caption font-normal text-[var(--text-primary)]"
                    title={String(value)}
                  >
                    {value}
                  </div>
                  <div
                    className="truncate text-micro text-[var(--text-tertiary)]"
                    title={label}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-2.5 flex min-h-7 min-w-0 items-end justify-between gap-2">
            <div className="min-w-0 truncate text-micro text-[var(--text-tertiary)]">
              {artifact.footer ??
                (artifact.placement === "workspace"
                  ? "In workspace"
                  : "General")}
            </div>
            {actions ? (
              <div
                ref={actionsRef}
                className="relative shrink-0"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-control text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  aria-label={`More actions for ${artifact.title}`}
                  aria-expanded={actionsOpen}
                  onClick={() => setActionsOpen((open) => !open)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {actionsOpen ? (
                  <div className="absolute bottom-[calc(100%+6px)] right-0 z-chrome flex items-center gap-1 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-card">
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
