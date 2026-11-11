"use client";

import { distinctHubTabs, hubTabsWithoutWorkspace, workSetLabel, type WorkspaceHubTab } from "./hub-tabs";
import { takeFullViewRequest } from "../components/full-view-origin";
import { subscribeShellWorkAvailability } from "../components/use-work-availability";
import { retireShellArtifactLocation } from "./shell-location";

import { Loader2, CheckCircle2, ExternalLink, Plus, School, Trash2, X, type GlyphIcon } from "@/components/icons/glyph-icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import dynamic from "next/dynamic";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import {
  ProductEmptyState,
  ProductErrorState,
} from "@/features/spectra/components/product-state";
import Link from "next/link";
import { useSpectraContextStore, type SpectraOpenObject } from "@/stores/spectra-context-store";
import { useSpectraRun } from "../ai/use-spectra-run";
import { useSpectraContext } from "../hooks/use-spectra-context";
import {
  createDefaultArtifactPayload,
} from "../components/artifact-blueprint-sheet";
import { workTypeMeta } from "../components/artifact-card";
import {
  StudioSplitPlaceholder,
  StudioTabRail,
  useArtifactStudioState,
} from "../components/artifact-studio-shell";
import { ArtifactTileSurface } from "../components/artifact-tile-surface";
import { useShellArtifactOpen } from "../components/use-shell-artifact-open";
import { useShellArtifactContent } from "../components/use-shell-artifact-content";
import { mergeShellArtifactContent } from "../components/shell-artifact-content";
import { createShellArtifactAccess } from "../components/shell-artifact-access";
import { SelectionActionBar } from "../components/context-controls";
import { InvitationStrip } from "../components/invitation-strip";
import { WorkbenchInspectorTabs } from "../components/workbench-inspector-tabs";
import { RunDetailPanel } from "../components/run-detail-panel";
import { LiveThreadPanel } from "../components/live-thread-panel";
import { ChatBrowserPanel } from "../components/chat-browser-panel";
import { LibraryHeader, WorkspaceHeader } from "./library-header";
import { useProvideIslandEngine } from "../island/engine";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import { applyPreferencePatch } from "../settings/schema";
import { useSpectraPreferences } from "../settings/preference-store";
import {
  disengageFollowAi,
  isProgrammaticOpen,
} from "../collaboration/follow-ai";
import {
  registerInPageNavigation,
  type NavigationShow,
} from "../collaboration/follow-navigation";
import {
  disengageFollow,
  isProgrammaticFollowOpen,
} from "../collaboration/follow";
import { ShareDialog } from "../components/share-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  ArtifactDeleteDialog,
  WorkspaceDeleteDialog,
  WorkspaceColorPicker,
  WorkspaceEditDialog,
  workspaceIconChoices,
} from "../components/shell-dialogs";
import { LibraryOrganizer } from "../organization/library-organizer";
import { WORKSPACE_INKS, workspaceInk } from "../organization/node-identity";
import { LibraryShelfSkeleton } from "../organization/library-shelf";
import { LoadingRows } from "@/components/ui/page-state";
import {
  useLiveOrgIdentities,
  useTreePlacement,
} from "../organization/tree-client";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import {
  acknowledgeViewportReady,
  requestViewportAction,
} from "../viewport-readiness";
import {
  syncSpectraManageBac,
  selectSpectraManageBacClasses,
  importSpectraManageBacResource,
  rememberSpectraMemory,
  correctSpectraMemory,
  workspaceIsClass,
} from "../data/api";
import { LIBRARY_TAB_LABEL, parseWorkspaceHubTabs } from "../components/workspace-tab-state";
import { previewText } from "../components/preview-text";
import {
  formatRelativeTime,
  formatShortDate,
  artifactPlacements,
  linkedArtifacts,
  sortSpectraWorkspaces,
  workspaceItemToCard,
} from "../components/spectra-view-model";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  exportSpectraWorkspaceManifest,
  getSpectraOverview,
  getSpectraRunDetail,
  getSpectraThread,
  peekSpectraWorkspace,
  getSpectraWorkspace,
  postSpectra,
  uploadArtifactImportOriginal,
  type SpectraArtifact,
  type SpectraOverview,
  type SpectraRun,
  type SpectraThread,
  type SpectraWorkspace,
  type SpectraWorkspaceItem,
} from "../data/api";
import type { ArtifactTypeKey } from "../artifacts/types";
import { isArtifactTypeKey } from "../artifacts/registry";
import { openSpectraPackage } from "../lenses/spectra-package";
import {
  LIBRARY_IMPORT_ACCEPT,
  classifyLibraryImport,
  importLibraryResourceFile,
  isOfficeNativeImportFile,
  projectDocxImportWithDurableImages,
  projectOfficeImportWithLens,
  projectLibraryImportContent,
} from "../organization/library-import";
import { getWorkDefinition } from "../work/registry";
import {
  allocateWorkbenchPanes,
  resolveSidebarRail,
  resolveWorkbenchPanes,
  SIDE_PANEL_FLOOR_PX,
  SIDEBAR_EXPANDED_PX,
  SIDEBAR_RAILED_PX,
  WORKBENCH_CONTENT_RESERVE_PX,
  stageMinimumFor,
  type WorkbenchPaneSpec,
} from "../components/split-presentation";
import {
  readSharedWorkbenchSession,
  updateWorkbenchSurface,
  writeSharedWorkbenchSession,
} from "../workbench";
import { onLibraryHandoff, takeLibraryHandoffs } from "../workbench/library-handoff";
import {
  artifactIdFromSpectraLocation,
  artifactIdFromSpectraPath,
  spectraShellHref,
  workspaceIdFromSpectraPath,
} from "./shell-location";
import { beginCreation } from "../life/use-life";
import { expectLanding, type WorkRegion } from "../anchors/open-anchor";
import { useShareInvitations } from "./use-share-invitations";
import { downloadDocumentBlob } from "../components/artifact-studio-file-utils";

type OverviewLoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };
type Selection =
  | { type: "artifact"; itemId: string; artifactId: string }
  | { type: "thread"; itemId: string; threadId: string }
  | { type: "run"; runId: string }
  | null;
/**
 * One step of the shell's own Back and Forward. A hub step that names a
 * `nodeId` is a folder within it (null is the top), so walking into folders
 * can be walked back out of; one without leaves the folder where it is.
 */
type ShellNavEntry = {
  kind: "hub" | "artifact-split" | "artifact-tab";
  hubTabId: string | null;
  workspaceId?: string;
  artifactId?: string;
  nodeId?: string | null;
};
type WorkspaceEntry = {
  item: SpectraWorkspaceItem;
  artifact?: SpectraArtifact;
  thread?: SpectraThread;
  card?: NonNullable<ReturnType<typeof workspaceItemToCard>>;
};
const EMPTY_ARTIFACTS: SpectraArtifact[] = [];

const AI_EDITED_FLASH_FALLBACK_MS = 90_000;

function liveAiIsActive(
  artifact?:
    | Pick<SpectraArtifact, "aiState" | "aiEffects">
    | Pick<SpectraWorkspace, "aiState">
    | null,
) {
  if (!artifact) return false;
  if (artifact.aiState === "creating" || artifact.aiState === "updating")
    return true;
  return (
    "aiEffects" in artifact &&
    (artifact.aiEffects ?? []).some((effect) => effect.state === "active")
  );
}

function aiEditedExpiresAt(
  artifact?: Pick<
    SpectraArtifact,
    "aiState" | "aiStateExpiresAt" | "updatedAt"
  > | null,
) {
  if (!artifact || artifact.aiState !== "edited") return undefined;
  if (artifact.aiStateExpiresAt) return artifact.aiStateExpiresAt;
  if (artifact.updatedAt)
    return artifact.updatedAt + AI_EDITED_FLASH_FALLBACK_MS;
  return undefined;
}

const ArtifactStudio = dynamic(
  () => import("../components/artifact-studio").then((module) => module.ArtifactStudio),
  { loading: () => <StudioSplitPlaceholder /> },
);

function expireLiveAiChrome<T extends SpectraArtifact>(
  artifact: T,
  now = Date.now(),
): T {
  const effects = (artifact.aiEffects ?? []).filter(
    (effect) => !effect.expiresAt || effect.expiresAt > now,
  );
  const activeEffects = effects.filter((effect) => effect.state === "active");
  const working =
    artifact.aiState === "creating" || artifact.aiState === "updating";
  // Failed / abandoned runs must not leave cards and studios pulsing forever.
  // Promote leftover settling ink to a quiet edited flash, or clear entirely.
  // Stuck creating/updating with an orphan aiRunId (no live effects) also clears —
  // otherwise list cards keep the infinite cyan sweep after the run already stopped.
  if (working && activeEffects.length === 0) {
    if (effects.length > 0) {
      const expiresAt =
        effects
          .map((effect) => effect.expiresAt)
          .filter((value): value is number => typeof value === "number")
          .sort((left, right) => left - right)[0] ??
        now + AI_EDITED_FLASH_FALLBACK_MS;
      return {
        ...artifact,
        aiState: "edited",
        aiProgress: undefined,
        aiStateExpiresAt: expiresAt,
        aiEffects: effects,
      };
    }
    return {
      ...artifact,
      aiState: undefined,
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiProgress: undefined,
      aiPreview: undefined,
      aiStateExpiresAt: undefined,
      aiEffects: undefined,
    };
  }
  const editedExpiry = aiEditedExpiresAt(artifact);
  const editedExpired =
    artifact.aiState === "edited" && (!editedExpiry || editedExpiry <= now);
  if (!editedExpired && effects.length === (artifact.aiEffects ?? []).length)
    return artifact;
  return {
    ...artifact,
    ...(editedExpired
      ? {
          aiState: undefined,
          aiProgress: undefined,
          aiPreview: undefined,
          aiStateExpiresAt: undefined,
        }
      : {}),
    aiEffects: effects.length ? effects : undefined,
  };
}

function mergeLiveAiArtifact(
  previous: SpectraArtifact | undefined,
  next: SpectraArtifact,
): SpectraArtifact {
  const now = Date.now();
  const settledNext = expireLiveAiChrome(next, now);
  if (!previous || previous._id !== settledNext._id) return settledNext;
  const settledPrevious = expireLiveAiChrome(previous, now);
  if (
    !liveAiIsActive(settledNext) &&
    settledNext.aiState !== "edited" &&
    (settledNext.updatedAt ?? 0) > (settledPrevious.updatedAt ?? 0)
  ) {
    // A strictly newer server revision without AI chrome means the write
    // finished (or never started on the server). Same-timestamp overview
    // polls must not wipe optimistic focused-edit SSE chrome — otherwise
    // mid-edit studios lose aiState=updating and data-ai-region stays 0.
    return settledNext;
  }
  if (
    !liveAiIsActive(settledNext) &&
    settledNext.aiState !== "edited" &&
    typeof settledNext.summary === "string" &&
    settledNext.summary.includes("Incomplete draft preserved")
  ) {
    return settledNext;
  }
  if (liveAiIsActive(settledNext)) return settledNext;
  if (!liveAiIsActive(settledPrevious)) return settledNext;
  if ((settledNext.updatedAt ?? 0) > (settledPrevious.updatedAt ?? 0))
    return settledNext;
  if (
    settledPrevious.aiStateExpiresAt &&
    settledPrevious.aiStateExpiresAt <= now
  ) {
    return settledNext;
  }
  // Overview/poll snapshots lag the live SSE patch stream. Keep the client's
  // active AI chrome until the server reports the same working state.
  return {
    ...settledNext,
    aiState: settledPrevious.aiState,
    aiProgress: settledPrevious.aiProgress ?? settledNext.aiProgress,
    aiEffects: settledPrevious.aiEffects ?? settledNext.aiEffects,
    aiPreview: settledPrevious.aiPreview ?? settledNext.aiPreview,
    aiStateExpiresAt:
      settledPrevious.aiStateExpiresAt ?? settledNext.aiStateExpiresAt,
    ...(settledPrevious.aiState === "creating"
      ? {
          title: settledPrevious.title || settledNext.title,
          summary: settledPrevious.summary ?? settledNext.summary,
          content: settledPrevious.content ?? settledNext.content,
        }
      : {}),
  };
}

function mergeLiveAiArtifacts(
  previous: SpectraArtifact[] | undefined,
  next: SpectraArtifact[],
) {
  if (!previous?.length) return next;
  const previousById = new Map(
    previous.map((artifact) => [artifact._id, artifact]),
  );
  return next.map((artifact) =>
    mergeLiveAiArtifact(previousById.get(artifact._id), artifact),
  );
}

function mergeLiveAiWorkspaceBundle(
  previous:
    | {
        workspace: SpectraWorkspace;
        items: SpectraWorkspaceItem[];
      }
    | null
    | undefined,
  next:
    | {
        workspace: SpectraWorkspace;
        items: SpectraWorkspaceItem[];
      }
    | null
    | undefined,
) {
  if (!next) return next;
  if (!previous) return next;
  const previousWorkspace = previous.workspace;
  const nextWorkspace = next.workspace;
  const preserveWorkspaceAi =
    liveAiIsActive(previousWorkspace) && !liveAiIsActive(nextWorkspace);
  return {
    workspace: preserveWorkspaceAi
      ? {
          ...nextWorkspace,
          aiState: previousWorkspace.aiState,
          aiPreview: previousWorkspace.aiPreview ?? nextWorkspace.aiPreview,
        }
      : nextWorkspace,
    items: next.items.map((item) => {
      if (!item.artifact) return item;
      const prior =
        previous.items.find(
          (candidate) => candidate.artifact?._id === item.artifact?._id,
        )?.artifact ?? undefined;
      const merged = mergeLiveAiArtifact(prior, item.artifact);
      return merged === item.artifact ? item : { ...item, artifact: merged };
    }),
  };
}

function mergeLiveAiOverview(
  previous: SpectraOverview | null | undefined,
  next: SpectraOverview,
): SpectraOverview {
  if (!previous) return next;
  return {
    ...next,
    artifacts: mergeLiveAiArtifacts(previous.artifacts, next.artifacts),
    workspace:
      mergeLiveAiWorkspaceBundle(previous.workspace, next.workspace) ?? null,
  };
}

function workspaceHubTab(
  label = LIBRARY_TAB_LABEL,
  workspaceId?: string,
): WorkspaceHubTab {
  return {
    id: `workspace-hub-${crypto.randomUUID()}`,
    label,
    workspaceId,
  };
}

function useOutsideClick<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: globalThis.PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose, open]);
  return ref;
}

/**
 * The Library on its way, laid out as it will stand: its command bar, then the
 * shelf at its top or rows inside a folder, so the ghosts hand over in place.
 */
function WorkspaceContentSkeleton({ shelf }: { shelf: boolean }) {
  return (
    <>
      <div aria-hidden className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border-default)] px-5">
        <div data-life-ghost className="h-8 w-[240px] animate-pulse rounded-control bg-[var(--bg-secondary)]" />
        <div data-life-ghost className="ml-auto h-8 w-[min(560px,50%)] animate-pulse rounded-control bg-[var(--bg-secondary)]" />
      </div>
      {shelf ? (
        <section className="min-w-0 flex-1 overflow-hidden px-8 pt-6">
          <LibraryShelfSkeleton />
        </section>
      ) : (
        <LoadingRows count={8} label="Opening the Library" className="px-3 pt-2" />
      )}
    </>
  );
}

function applyPreviewContentPatch(source: unknown, patch: unknown) {
  if (
    !patch ||
    typeof patch !== "object" ||
    !Array.isArray((patch as { changes?: unknown }).changes)
  )
    return undefined;
  let root: unknown =
    source && typeof source === "object" ? structuredClone(source) : {};
  for (const raw of (patch as { changes: unknown[] }).changes) {
    if (!raw || typeof raw !== "object") continue;
    const { path, value } = raw as { path?: unknown; value?: unknown };
    if (typeof path !== "string" || !path.startsWith("/")) continue;
    const segments = path
      .split("/")
      .slice(1)
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (segments.length === 0) {
      root = structuredClone(value);
      continue;
    }
    let cursor = root as Record<string, unknown>;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      const nextSegment = segments[index + 1]!;
      if (!cursor[segment] || typeof cursor[segment] !== "object")
        cursor[segment] = /^\d+$/.test(nextSegment) ? [] : {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments.at(-1)!] = structuredClone(value);
  }
  return root;
}

function Inspector({
  artifacts,
  selectedArtifact,
  selectedRun,
  onClose,
  onHide,
  onOpenArtifact,
}: {
  artifacts: SpectraArtifact[];
  selectedArtifact: SpectraArtifact | null;
  selectedRun: SpectraRun | null;
  onClose: () => void;
  onHide: () => void;
  onOpenArtifact: (artifact: SpectraArtifact) => void;
}) {
  const [inline, setInline] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => setInline(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  // D7: a specific workspace has no permanent right details/activity column.
  // This panel is selection-driven only — it appears for a selected run or a
  // selected work item, and closing it returns the full width to the work.
  if (!selectedRun && !selectedArtifact) return null;
  if (inline === null) return null;

  if (selectedRun) {
    const affected =
      artifacts.find((artifact) => artifact._id === selectedRun.artifactId) ??
      null;
    return (
      <InspectorSurface inline={inline} title="Selected run" onClose={onClose}>
        <div className="mt-5 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="flex items-center justify-between text-caption text-[var(--text-secondary)]">
            <span>{formatShortDate(selectedRun.createdAt)}</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
              {selectedRun.status}
            </span>
          </div>
          <h2 className="mt-5 font-display text-heading font-semibold leading-tight text-[var(--text-primary)]">
            {selectedRun.userPrompt}
          </h2>
          <p className="mt-4 text-ui leading-6 text-[var(--text-secondary)]">
            {selectedRun.finalSummary}
          </p>
        </div>
        {affected ? (
          <InspectorSection title="Affected objects">
            <InspectorObject artifact={affected} />
          </InspectorSection>
        ) : null}
      </InspectorSurface>
    );
  }

  if (selectedArtifact) {
    const meta = workTypeMeta[selectedArtifact.blueprintKey];
    const Icon = meta.icon;
    const links = linkedArtifacts(selectedArtifact, artifacts);
    const selectedPlacements = artifactPlacements(selectedArtifact);
    return (
      <InspectorSurface inline={inline} title="Selected work" onClose={onClose}>
        <WorkbenchInspectorTabs
          work={selectedArtifact}
          overview={
            <div>
              <div className="mt-5">
                <Icon
                  className="h-8 w-8 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5"
                  style={{ color: meta.color }}
                />
                <div className="mt-3 text-micro font-semibold text-[var(--text-tertiary)]">
                  {meta.label} · {selectedArtifact.status}
                </div>
                <h2 className="mt-2 font-display text-metric font-semibold leading-tight text-[var(--text-primary)]">
                  {selectedArtifact.title}
                </h2>
                <div className="mt-2 text-caption text-[var(--text-secondary)]">
                  Updated {formatRelativeTime(selectedArtifact.updatedAt)}
                </div>
              </div>
              <InspectorSection title="Description">
                <p className="text-ui leading-6 text-[var(--text-secondary)]">
                  {previewText(selectedArtifact.summary, "No description yet.")}
                </p>
              </InspectorSection>
              <InspectorSection title="People and access">
                <MetricRow
                  label="Owner"
                  value={selectedArtifact.owner?.name ?? "You"}
                />
                <MetricRow
                  label="Access"
                  value={
                    selectedArtifact.accessLevel === "read"
                      ? "Read-only"
                      : "Edit"
                  }
                />
                <MetricRow
                  label="Collaborators"
                  value={String(selectedArtifact.sharedWithCount ?? 0)}
                />
                <MetricRow
                  label="Sharing"
                  value={selectedArtifact.isShared ? "Shared" : "Private"}
                />
              </InspectorSection>
              <InspectorSection title="Workspace placement">
                <div className="space-y-2">
                  {selectedPlacements.map((placement) => (
                    <div
                      key={placement.workspaceId}
                      className="rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-caption font-medium text-[var(--text-primary)]"
                    >
                      {placement.workspaceTitle}
                    </div>
                  ))}
                  {selectedPlacements.length === 0 ? (
                    <div className="rounded-control border border-dashed border-[var(--border-default)] p-3 text-micro leading-5 text-[var(--text-secondary)]">
                      This work is in General. Move it into a workspace when it
                      belongs with a project or subject.
                    </div>
                  ) : null}
                </div>
              </InspectorSection>
              <InspectorSection title="References and backlinks">
                <div className="space-y-2">
                  {links.slice(0, 5).map(({ artifact }) => (
                    <InspectorObject key={artifact._id} artifact={artifact} />
                  ))}
                  {links.length === 0 ? (
                    <div className="text-ui text-[var(--text-secondary)]">
                      No references yet.
                    </div>
                  ) : null}
                </div>
              </InspectorSection>
              <InspectorSection title="Where this came from">
                <p className="text-micro leading-5 text-[var(--text-secondary)]">
                  {selectedArtifact.createdFrom?.source
                    ? `Created from ${selectedArtifact.createdFrom.source.replaceAll("_", " ")}${selectedArtifact.createdFrom.sourceAttachmentNames?.length ? ` with ${selectedArtifact.createdFrom.sourceAttachmentNames.length} source file${selectedArtifact.createdFrom.sourceAttachmentNames.length === 1 ? "" : "s"}` : ""}.`
                    : "This wasn't brought in from anywhere else."}
                </p>
              </InspectorSection>
              <InspectorSection title="Actions">
                <ActionRow
                  icon={ExternalLink}
                  label="Open work"
                  onClick={() => onOpenArtifact(selectedArtifact)}
                />
                <Button variant="destructive" size="sm" onClick={onHide}>
                  <Trash2 className="h-4 w-4" />
                  Remove from workspace
                </Button>
              </InspectorSection>
            </div>
          }
        />
      </InspectorSurface>
    );
  }

  return null;
}

function WorkspaceHeaderSkeleton() {
  return (
    <div
      className="border-b border-[var(--border-default)] px-5 pb-4 pt-4"
      aria-label="Loading workspace overview"
    >
      <div data-life-ghost className="flex items-start gap-4">
        <div data-life-ghost-bar className="size-14 animate-pulse rounded-card bg-[var(--bg-secondary)]" />
        <div className="min-w-0 flex-1 pt-1">
          <div data-life-ghost-bar className="h-7 w-52 max-w-full animate-pulse rounded-control bg-[var(--bg-secondary)]" />
          <div data-life-ghost-bar className="mt-3 h-4 w-80 max-w-full animate-pulse rounded-control bg-[var(--bg-secondary)]" />
        </div>
      </div>
    </div>
  );
}

function OverviewLoadFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-12">
      <ProductErrorState
        title="Spectra did not load"
        detail={message}
        action={
          <Button variant="primary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </main>
  );
}

function NeedsSchoolEmpty() {
  return (
    <main className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-12">
      <ProductEmptyState
        icon={School}
        title="Join your school to open Spectra"
        detail="You are signed in. Accept the invitation for this school, then your workspace will load."
        action={
          <Button variant="primary" size="sm" asChild>
            <Link href="/join">Open invitation</Link>
          </Button>
        }
      />
    </main>
  );
}

function InspectorSurface({
  inline,
  title,
  onClose,
  children,
}: {
  inline: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (inline)
    return (
      <aside className="w-[318px] shrink-0 overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6">
        <InspectorTitle title={title} onClose={onClose} />
        {children}
      </aside>
    );
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent aria-describedby={undefined}>
        <header className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-5 pr-14">
          <SheetTitle className="text-heading font-semibold text-[var(--text-primary)]">
            {title}
          </SheetTitle>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InspectorTitle({
  title,
  onClose,
  trailing,
}: {
  title: string;
  onClose: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-body font-semibold text-[var(--text-primary)]">
        {title}
      </h2>
      <div className="flex items-center gap-1">
        {trailing}
        <button
          type="button"
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 border-t border-[var(--border-default)] pt-5">
      <h3 className="mb-3 text-ui font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function InspectorObject({ artifact }: { artifact: SpectraArtifact }) {
  const meta = workTypeMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5">
      <Icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-caption font-medium text-[var(--text-primary)]">
          {artifact.title}
        </div>
        <div className="text-micro text-[var(--text-secondary)]">
          {meta.label}
        </div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
    </div>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: GlyphIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-10 w-full items-center gap-3 rounded-control text-left text-ui font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:text-[var(--text-tertiary)] disabled:hover:bg-transparent"
      onClick={onClick}
    >
      <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
      {label}
    </button>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <strong className="font-sans font-normal text-[var(--text-primary)]">
        {value}
      </strong>
    </div>
  );
}

export function SpectraShell({
  surface = "workspace",
  initialArtifactId,
  initialWorkspaceId,
}: {
  /**
   * Which door the reader came through. It changes what the account-level
   * header calls itself and how an open work names its origin — nothing else,
   * because there is nothing else to change: /library and /workspace are the
   * same surface at the same scope (D32).
   */
  surface?: "library" | "workspace";
  initialArtifactId?: string;
  initialWorkspaceId?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathnameWorkspaceId = workspaceIdFromSpectraPath(pathname);
  const requestedWorkspaceId =
    pathnameWorkspaceId ??
    (pathname.startsWith("/workspace/") ? initialWorkspaceId : undefined) ??
    searchParams.get("workspaceId") ??
    undefined;
  const pathnameArtifactId = artifactIdFromSpectraPath(pathname);
  const requestedArtifactId =
    pathnameArtifactId ??
    (pathname.startsWith("/library/") ? initialArtifactId : undefined) ??
    searchParams.get("artifactId") ??
    undefined;
  const { preferences, replace: replacePreferences } = useSpectraPreferences();
  const patchItemSyncPolicies = useMutation(api.syncPolicy.patchItems);
  /* A deep link into a folder. Absent means the top of whatever is open. */
  const requestedNodeId = searchParams.get("nodeId");
  const surfaceLabel = surface === "library" ? "Library" : "Workspace";
  useEffect(() => {
    const session = readSharedWorkbenchSession(window.localStorage);
    writeSharedWorkbenchSession(
      window.localStorage,
      updateWorkbenchSurface(
        session,
        requestedWorkspaceId
          ? { workspaceId: requestedWorkspaceId }
          : "library",
      ),
    );
  }, [requestedWorkspaceId]);
  const requestedThreadId = searchParams.get("threadId") ?? undefined;
  const requestedHome = searchParams.get("home") === "1";
  const openObjects = useSpectraContextStore((state) => state.openObjects);
  const [artifactAccess] = useState(createShellArtifactAccess);
  const {
    pending: pendingArtifactOpen,
    loadingId: openingArtifactId,
    open: loadArtifactForOpen,
    cancel: cancelArtifactOpen,
  } = useShellArtifactOpen(artifactAccess.read);
  const { overview, setOverview, hydratedArtifacts, setHydratedArtifacts, revokeArtifact } = useShellArtifactContent(
    openObjects.filter((object) => object.type === "artifact").map((object) => object.id),
    pendingArtifactOpen?.artifact._id,
  );
  const [overviewLoadState, setOverviewLoadState] = useState<OverviewLoadState>(
    { status: "loading" },
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<
    string | undefined
  >();
  const [selection, setSelection] = useState<Selection>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  /* The AI needs the Library location the reader is actually viewing, not only
     the route's entry node. It is kept out of the organizer's key so ordinary
     breadcrumb/folder navigation does not remount the organizer. */
  const [currentLibraryNodeId, setCurrentLibraryNodeId] = useState<
    string | null
  >(requestedNodeId);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceCreateParentNodeId, setWorkspaceCreateParentNodeId] =
    useState<string | null>(null);
  const [newWorkspaceTitle, setNewWorkspaceTitle] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [newWorkspaceIcon, setNewWorkspaceIcon] = useState("Sparkles");
  const [newWorkspaceColor, setNewWorkspaceColor] = useState<string>(WORKSPACE_INKS[0][0]);
  const [workspaceEditOpen, setWorkspaceEditOpen] = useState(false);
  const [workspaceEditTitle, setWorkspaceEditTitle] = useState("");
  const [workspaceEditDescription, setWorkspaceEditDescription] = useState("");
  const [workspaceEditIcon, setWorkspaceEditIcon] = useState("Sparkles");
  const [workspaceEditColor, setWorkspaceEditColor] = useState<string>(WORKSPACE_INKS[0][0]);
  const [workspaceEditClass, setWorkspaceEditClass] = useState(false);
  const [hubTabs, setHubTabs] = useState<WorkspaceHubTab[]>(() => [
    { id: "workspace-home-default", label: LIBRARY_TAB_LABEL },
  ]);
  const [activeHubTabId, setActiveHubTabId] = useState<string | null>(
    "workspace-home-default",
  );
  const [hubTabsRestored, setHubTabsRestored] = useState(false);
  const activeWorkSetTab = hubTabs.find((tab) => tab.id === activeHubTabId && tab.workSet);
  // However a place came to be opened twice (a restored session, a tab
  // retargeted onto a place another tab shows), the rail shows it once.
  useEffect(() => {
    const next = distinctHubTabs(hubTabs, activeHubTabId);
    if (next.tabs.length === hubTabs.length) return;
    setHubTabs(next.tabs);
    setActiveHubTabId(next.activeId);
  }, [activeHubTabId, hubTabs]);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [navCursor, setNavCursor] = useState(-1);
  const navStackRef = useRef<ShellNavEntry[]>([]);
  const restoringNavRef = useRef(false);
  /** The deep-linked work this shell has already acted on, opened or reported. */
  const openedDeepLinkRef = useRef<string | null>(null);
  const previousRequestedArtifactIdRef = useRef<string | undefined>(
    requestedArtifactId,
  );
  const [studioPanelWidth, setStudioPanelWidth] = useState(720);
  /* Room the open work's own pane (comments, history, references) needs
     beside its page; the work's floor and width grow by it while it is open. */
  const [studioPaneRoom, setStudioPaneRoom] = useState(0);
  const [liveThreadPanelWidth, setLiveThreadPanelWidth] = useState(480);
  const [runPanelWidth, setRunPanelWidth] = useState(680);
  const [chatBrowserOpen, setChatBrowserOpen] = useState(false);
  const [chatBrowserWidth, setChatBrowserWidth] = useState(440);
  /* One budget for the whole workbench row (CANON D44): sidebar, library,
     open work, thread and run panel all draw from the same pixels, so one
     pure resolver (`split-presentation.ts`) decides who stays in flow and
     who overlays the content column — and when the sidebar should rail
     itself to buy the row back. The width states above are *intents*; the
     allocator turns intents into actual widths in one pass, so panels can
     never oscillate or sum over budget. */
  const workbenchRowRef = useRef<HTMLDivElement | null>(null);
  const [workbenchRowWidth, setWorkbenchRowWidth] = useState(0);
  const [workbenchWindowWidth, setWorkbenchWindowWidth] = useState(0);
  const [paneOverlay, setPaneOverlay] = useState<Record<string, boolean>>({});
  const paneOverlayRef = useRef<Record<string, boolean>>({});
  const paneRecencyRef = useRef<Record<string, number>>({});
  const [sidebarRailed, setSidebarRailed] = useState(false);
  const sidebarRailedRef = useRef(false);
  /** A drag sets the intent and outranks default priority in the allocator. */
  const notePaneIntent = useCallback(
    (pane: "studio" | "thread" | "run" | "chat-browser", width: number) => {
      paneRecencyRef.current[pane] = Date.now();
      if (pane === "studio") setStudioPanelWidth(width);
      else if (pane === "thread") setLiveThreadPanelWidth(width);
      else if (pane === "run") setRunPanelWidth(width);
      else setChatBrowserWidth(width);
    },
    [],
  );
  const [workspaceDeleteOpen, setWorkspaceDeleteOpen] = useState(false);
  const [workspaceShareOpen, setWorkspaceShareOpen] = useState(false);
  const [artifactDeletePending, setArtifactDeletePending] =
    useState<SpectraArtifact | null>(null);
  const [artifactShareTarget, setShareDialogTarget] =
    useState<SpectraArtifact | null>(null);
  const setArtifactShareTarget = setShareDialogTarget;
  /* Others can't reach this computer, so a work kept on it moves online with
     the first invitation or link, never just because Share was opened (F18). */
  const moveShareTargetOnline = async () => {
    const artifact = artifactShareTarget;
    if (artifact?.storageHome !== "device") return;
    try {
      const { moveWorkToCloud } = await import("../bridge/device-works");
      await moveWorkToCloud(artifact._id);
    } catch {
      throw new Error("Open Spectra Bridge on the computer that holds this work to share it.");
    }
    toast.info("Moved online so the people you share with can open it.");
    spectraBus.emit("workspace.refreshRequested", {});
    setShareDialogTarget({ ...artifact, storageHome: undefined, storageStoreId: undefined });
  };
  const invitationCollection = searchParams.get("collection") === "invitations";
  const {
    shareInvitations,
    invitationsOpen,
    setInvitationsOpen,
    refreshInvitations,
  } = useShareInvitations(invitationCollection);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  // Files another page handed over ("Copy into Library" on School) import here.
  const importLibraryFileRef = useRef<((file: File, parentNodeId?: string | null) => Promise<void>) | null>(null);
  useEffect(() => {
    importLibraryFileRef.current = importLibraryFile;
  });
  useEffect(() => {
    const drain = () => {
      for (const file of takeLibraryHandoffs()) void importLibraryFileRef.current?.(file, null);
    };
    drain();
    return onLibraryHandoff(drain);
  }, []);

  /**
   * Favorites used to live in this browser's localStorage, which meant they
   * were invisible on every other device. They are now `pinned` on the tree
   * node. Carry the old list over once, then stop reading it — the key is
   * removed so this can never re-pin something the reader has since unpinned.
   */
  const pinSources = useMutation(api.orgTree.pinSources);
  useEffect(() => {
    const raw = window.localStorage.getItem("spectra.library.favorites.v1");
    if (raw === null) return;
    let ids: string[] = [];
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value))
        ids = value.filter((id): id is string => typeof id === "string");
    } catch {
      ids = [];
    }
    if (ids.length === 0) {
      window.localStorage.removeItem("spectra.library.favorites.v1");
      return;
    }
    void pinSources({ kind: "work", sourceIds: ids.slice(0, 500) })
      .then((result) => {
        window.localStorage.removeItem("spectra.library.favorites.v1");
        if (result.pinned > 0)
          toast.success(
            `${result.pinned} favorite${result.pinned === 1 ? "" : "s"} moved into your Library.`,
          );
      })
      .catch(() => {
        /* Leave the key in place so the next load tries again. */
      });
  }, [pinSources]);

  const [workspaceDeleteConfirmation, setWorkspaceDeleteConfirmation] =
    useState("");
  const workspaceCreateRef = useOutsideClick<HTMLDivElement>(
    workspaceCreateOpen,
    () => {
      setWorkspaceCreateOpen(false);
      setWorkspaceCreateParentNodeId(null);
    },
  );
  const workspaceRequestSequence = useRef(0);
  const overviewRequestSequence = useRef(0);
  const workspaceImportInputRef = useRef<HTMLInputElement | null>(null);
  const setObjectAvailability = useSpectraContextStore(
    (state) => state.setObjectAvailability,
  );
  useEffect(() => subscribeShellWorkAvailability(artifactAccess), [artifactAccess]);
  useEffect(() => artifactAccess.subscribe((artifactId) => {
    const wasOpen = useSpectraContextStore.getState().openObjects.some((object) => object.type === "artifact" && object.id === artifactId);
    const wasOpening = cancelArtifactOpen(artifactId);
    revokeArtifact(artifactId);
    setObjectAvailability("artifact", artifactId);
    const href = retireShellArtifactLocation(window.location.pathname, window.location.search, artifactId);
    if (href) window.history.replaceState(window.history.state, "", href);
    if (wasOpen || wasOpening) toast.error("That work is no longer available.");
  }), [artifactAccess, cancelArtifactOpen, revokeArtifact, setObjectAvailability]);
  const liveIdentitySources = useMemo(() => {
    const seen = new Set<string>();
    const sources: Array<{
      kind: "work" | "thread" | "workspace";
      sourceId: string;
    }> = [];
    const add = (kind: "work" | "thread" | "workspace", sourceId?: string) => {
      if (!sourceId) return;
      const key = `${kind}:${sourceId}`;
      if (seen.has(key)) return;
      seen.add(key);
      sources.push({ kind, sourceId });
    };
    for (const object of openObjects) {
      if (object.type === "artifact") add("work", object.id);
      else if (object.type === "thread") add("thread", object.id);
      else if (object.type === "workspace") add("workspace", object.id);
    }
    add("workspace", selectedWorkspaceId);
    return sources;
  }, [openObjects, selectedWorkspaceId]);
  const liveIdentities = useLiveOrgIdentities(liveIdentitySources);
  const liveIdentityByKey = useMemo(
    () =>
      new Map(
        liveIdentities.map((identity) => [
          `${identity.kind}:${identity.sourceId}`,
          identity,
        ]),
      ),
    [liveIdentities],
  );
  useEffect(() => {
    const openByKey = new Map(
      openObjects.map((object) => [
        `${object.type === "artifact" ? "work" : object.type}:${object.id}`,
        object,
      ]),
    );
    for (const identity of liveIdentities) {
      const object = openByKey.get(`${identity.kind}:${identity.sourceId}`);
      if (!object || object.label === identity.name) continue;
      setObjectAvailability(
        identity.kind === "work" ? "artifact" : identity.kind,
        identity.sourceId,
        { label: identity.name },
      );
    }
  }, [liveIdentities, openObjects, setObjectAvailability]);
  const tileArtifactIds = useSpectraContextStore(
    (state) => state.tileArtifactIds,
  );
  const workSetIsolated = useSpectraContextStore(
    (state) => state.tilesIsolated,
  );
  const openObject = useSpectraContextStore((state) => state.openObject);
  const closePresentation = useSpectraContextStore(
    (state) => state.closePresentation,
  );
  const setTileObjects = useSpectraContextStore(
    (state) => state.setTileObjects,
  );
  const addTileObject = useSpectraContextStore((state) => state.addTileObject);
  const removeTileObject = useSpectraContextStore(
    (state) => state.removeTileObject,
  );
  const clearTiles = useSpectraContextStore((state) => state.clearTiles);
  const setWorkSetIsolated = useSpectraContextStore(
    (state) => state.setTilesIsolated,
  );
  const activeRunPanelId =
    openObjects.find(
      (object) => object.type === "run" && object.presentation === "run-panel",
    )?.id ?? null;
  const threadPanelObject =
    openObjects.find(
      (object) =>
        object.type === "thread" && object.presentation === "thread-panel",
    ) ?? null;
  const liveThread = useMemo(
    () =>
      threadPanelObject
        ? { id: threadPanelObject.id, title: threadPanelObject.label }
        : null,
    [threadPanelObject],
  );
  const loadOverview = useCallback(
    async (workspaceId?: string, quiet = false) => {
      const sequence = ++overviewRequestSequence.current;
      const accessRefresh = quiet ? artifactAccess.beginListRefresh() : null;
      if (!quiet) setOverviewLoadState({ status: "loading" });
      try {
        const next = await getSpectraOverview(workspaceId, quiet);
        if (sequence !== overviewRequestSequence.current) return null;
        accessRefresh?.reconcile([
          ...next.artifacts,
          ...(next.workspace?.items.flatMap((item) => item.artifact ? [item.artifact] : []) ?? []),
        ]);
        setOverview((current) => mergeLiveAiOverview(current, next));
        setOverviewLoadState({ status: "ready" });
        setSelectedWorkspaceId(
          next.workspace
            ? (next.selectedWorkspaceId ?? workspaceId)
            : undefined,
        );
        return next;
      } catch (error) {
        if (sequence !== overviewRequestSequence.current) return null;
        const message = describeFailure(error, {
          fallback:
            "Check your connection, then try loading your workspace again.",
        }).message;
        if (workspaceId) {
          setSelectedWorkspaceId(undefined);
          setSelection(null);
          const fallback = await getSpectraOverview().catch(() => null);
          if (fallback && sequence === overviewRequestSequence.current) {
            setOverview(fallback);
            setOverviewLoadState({ status: "ready" });
            toast.message(
              "That workspace could not be loaded. Opened workspace home instead.",
            );
          } else if (!quiet) {
            setOverviewLoadState({ status: "error", message });
          }
        } else if (!quiet) {
          setOverviewLoadState({ status: "error", message });
        } else {
          toast.error("Spectra could not refresh this view. Try again.");
        }
        return null;
      } finally {
        accessRefresh?.finish();
      }
    },
    [artifactAccess, setOverview],
  );

  const loadWorkspace = useCallback(
    async (workspaceId: string, force = false) => {
      const sequence = ++workspaceRequestSequence.current;
      const cached = !force ? peekSpectraWorkspace(workspaceId) : null;
      if (cached) {
        if (sequence !== workspaceRequestSequence.current) return;
        setWorkspaceLoading(false);
        setSelectedWorkspaceId(workspaceId);
        setOverview((current) =>
          current
            ? {
                ...current,
                selectedWorkspaceId: workspaceId,
                workspace:
                  mergeLiveAiWorkspaceBundle(current.workspace, cached) ??
                  cached,
              }
            : current,
        );
        return;
      }
      setWorkspaceLoading(true);
      const accessRefresh = force ? artifactAccess.beginListRefresh() : null;
      try {
        const result = await getSpectraWorkspace(workspaceId, force);
        if (sequence !== workspaceRequestSequence.current) return;
        accessRefresh?.reconcile(result.workspace?.items.flatMap((item) => item.artifact ? [item.artifact] : []) ?? []);
        setSelectedWorkspaceId(workspaceId);
        setOverview((current) =>
          current
            ? {
                ...current,
                selectedWorkspaceId: workspaceId,
                workspace:
                  mergeLiveAiWorkspaceBundle(
                    current.workspace,
                    result.workspace,
                  ) ?? result.workspace,
              }
            : {
                workspaces: [],
                selectedWorkspaceId: workspaceId,
                workspace: result.workspace,
                artifacts: [],
                runs: [],
                resultCards: [],
              },
        );
      } catch (error) {
        if (sequence !== workspaceRequestSequence.current) return;
        setSelectedWorkspaceId(undefined);
        setSelection(null);
        const message = describeFailure(error, {
          fallback: "Could not load workspace.",
        }).message;
        toast.error(
          message.includes("Workspace not found")
            ? "That workspace is no longer available. Refreshed workspace home."
            : message,
        );
        const fallback = await getSpectraOverview().catch(() => null);
        if (fallback && sequence === workspaceRequestSequence.current)
          setOverview(fallback);
      } finally {
        accessRefresh?.finish();
        if (sequence === workspaceRequestSequence.current)
          setWorkspaceLoading(false);
      }
    },
    [artifactAccess, setOverview],
  );

  useEffect(() => {
    void loadOverview(requestedWorkspaceId).then((next) => {
      // Null is a load another one overtook, not a missing workspace.
      if (!requestedWorkspaceId || !next || next.workspace) return;
      router.replace("/library");
      toast.message("That workspace is gone. Here is your Library.");
    });
  }, [loadOverview, requestedWorkspaceId, router]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    setWorkspaceCreateOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("create");
    const query = next.toString();
    router.replace(query ? `/workspace?${query}` : "/workspace", {
      scroll: false,
    });
  }, [router, searchParams]);

  useEffect(() => {
    try {
      const saved = parseWorkspaceHubTabs(
        JSON.parse(
          window.localStorage.getItem("spectra.workspace.hubTabs.v1") ?? "null",
        ),
      );
      if (saved.tabs.length) {
        setHubTabs(saved.tabs);
        setActiveHubTabId(saved.activeId);
      }
    } catch {
      window.localStorage.removeItem("spectra.workspace.hubTabs.v1");
    }
    setHubTabsRestored(true);
  }, []);
  useEffect(() => {
    if (!hubTabsRestored || navStackRef.current.length > 0) return;
    const seed: ShellNavEntry = {
      kind: "hub",
      hubTabId: activeHubTabId,
      workspaceId: selectedWorkspaceId,
      nodeId: requestedNodeId,
    };
    navStackRef.current = [seed];
    setNavCursor(0);
  }, [activeHubTabId, hubTabsRestored, requestedNodeId, selectedWorkspaceId]);
  useEffect(() => {
    if (!hubTabsRestored || restoringNavRef.current) return;
    const matches = (entry: ShellNavEntry | undefined) =>
      requestedArtifactId
        ? entry?.artifactId === requestedArtifactId
        : entry?.kind === "hub" && entry.workspaceId === requestedWorkspaceId;
    /* The step Back or Forward landed on already matches the address; only a
       move the stack did not make (the browser's own Back) re-seats it. */
    if (matches(navStackRef.current[navCursor])) return;
    let matchingIndex = -1;
    for (let index = 0; index < navStackRef.current.length; index += 1) {
      if (matches(navStackRef.current[index])) matchingIndex = index;
    }
    if (matchingIndex >= 0 && matchingIndex !== navCursor)
      setNavCursor(matchingIndex);
  }, [hubTabsRestored, navCursor, requestedArtifactId, requestedWorkspaceId]);
  useEffect(() => {
    try {
      setInspectorCollapsed(
        window.localStorage.getItem("spectra.workspace.inspector.collapsed") ===
          "true",
      );
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem(
      "spectra.workspace.inspector.collapsed",
      String(inspectorCollapsed),
    );
  }, [inspectorCollapsed]);
  useEffect(() => {
    if (hubTabsRestored)
      window.localStorage.setItem(
        "spectra.workspace.hubTabs.v1",
        JSON.stringify({ tabs: hubTabs, activeId: activeHubTabId }),
      );
  }, [activeHubTabId, hubTabs, hubTabsRestored]);
  useEffect(() => {
    if (!hubTabsRestored || !overview || selectedWorkspaceId) return;
    const validWorkspaceIds = new Set(
      overview.workspaces.map((item) => item._id),
    );
    const sanitized = parseWorkspaceHubTabs(
      { tabs: hubTabs, activeId: activeHubTabId },
      validWorkspaceIds,
    );
    if (
      sanitized.tabs.length !== hubTabs.length ||
      sanitized.activeId !== activeHubTabId
    ) {
      const fallback = sanitized.tabs.length
        ? sanitized.tabs
        : [{ id: "workspace-home-recovered", label: LIBRARY_TAB_LABEL }];
      setHubTabs(fallback);
      setActiveHubTabId(sanitized.activeId ?? fallback[0]!.id);
      return;
    }
    const active = sanitized.tabs.find((tab) => tab.id === sanitized.activeId);
    if (active?.workspaceId) void loadWorkspace(active.workspaceId);
  }, [
    activeHubTabId,
    hubTabs,
    hubTabsRestored,
    loadWorkspace,
    overview,
    selectedWorkspaceId,
  ]);

  const workspace =
    selectedWorkspaceId &&
    overview?.workspace?.workspace?._id === selectedWorkspaceId
      ? overview.workspace.workspace
      : null;

  /**
   * The workspace's own node. The reader picked a workspace, but the tree is
   * addressed by node, and both new surfaces are scoped by node — so the hub
   * waits for this rather than briefly showing the whole account inside a
   * workspace.
   */
  const workspacePlacement = useTreePlacement("workspace", workspace?._id);
  const workspaceNodeId = workspacePlacement?.node.nodeId ?? null;

  /**
   * One surface, two scopes. With no workspace open the scope is the whole
   * account — that is what "Workspace" means at the root — and with one open it
   * is that workspace's subtree. Everything below is the same code either way,
   * because it is the same world (D32).
   */
  const atRoot = !selectedWorkspaceId;
  const scopeNodeId = atRoot ? null : workspaceNodeId;
  const scopeReady = atRoot || Boolean(workspace && workspaceNodeId);
  useEffect(() => {
    setCurrentLibraryNodeId(requestedNodeId ?? scopeNodeId);
  }, [requestedNodeId, scopeNodeId]);
  const snapshotArtifacts = overview?.artifacts ?? EMPTY_ARTIFACTS;
  const firstRun =
    overviewLoadState.status === "ready" &&
    atRoot &&
    snapshotArtifacts.length === 0;
  const allArtifacts = useMemo(
    () => {
      const listedIds = new Set(snapshotArtifacts.map((artifact) => artifact._id));
      const listed = snapshotArtifacts.map((artifact) => {
        const hydrated = hydratedArtifacts[artifact._id];
        const base = mergeShellArtifactContent(artifact, hydrated);
        const live = liveIdentityByKey.get(`work:${artifact._id}`);
        if (!live) return base;
        const placements = live.workspaceContextId
          ? [
              {
                workspaceId: live.workspaceContextId,
                workspaceTitle:
                  live.workspaceTitle ??
                  artifact.placements?.[0]?.workspaceTitle ??
                  "Workspace",
                nodeId: live.nodeId,
                pinned: live.pinned,
              },
            ]
          : [];
        return {
          ...base,
          title: live.name,
          summary: live.summary ?? base.summary,
          updatedAt: live.activityAt,
          placements,
          placementStatus: placements.length
            ? ("workspace" as const)
            : base.placementStatus,
        };
      });
      return [
        ...listed,
        ...Object.values(hydratedArtifacts).filter(
          (artifact) => !listedIds.has(artifact._id),
        ),
      ];
    },
    [hydratedArtifacts, liveIdentityByKey, snapshotArtifacts],
  );
  const missingOpenArtifactIds = JSON.stringify(openObjects
    .filter((object) => object.type === "artifact" &&
      object.id !== requestedArtifactId && object.id !== openingArtifactId &&
      object.id !== pendingArtifactOpen?.artifact._id &&
      !allArtifacts.some((artifact) => artifact._id === object.id && artifact.content !== undefined))
    .map((object) => object.id));
  const hasOverview = Boolean(overview && overview.needsSchool !== true);
  useEffect(() => {
    const missing = JSON.parse(missingOpenArtifactIds) as string[];
    if (!hasOverview || missing.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    void Promise.all(
      missing.map((artifactId) =>
        artifactAccess.read(artifactId, { signal: controller.signal })
          .then(({ artifact }) => artifact?.content !== undefined ? artifact : null)
          // A transient error does not establish revocation. Canonical null
          // responses notify the shared access listener above.
          .catch(() => null),
      ),
    ).then((loaded) => {
      if (cancelled) return;
      const artifacts = loaded
        .filter((artifact): artifact is SpectraArtifact => artifact !== null);
      if (artifacts.length > 0)
        setHydratedArtifacts((current) => ({
          ...current,
          ...Object.fromEntries(artifacts.map((artifact) => [artifact._id, artifact])),
        }));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [artifactAccess, hasOverview, missingOpenArtifactIds, setHydratedArtifacts]);
  const runs = overview?.runs ?? [];
  const readyStudioArtifacts = useMemo(
    () => allArtifacts.filter((artifact) => artifact.content !== undefined && artifact.accessLevel !== null && artifact.status !== "deleted"),
    [allArtifacts],
  );
  const studio = useArtifactStudioState(
    "spectra.shared.artifactStudio",
    readyStudioArtifacts,
  );
  const chatBrowserArtifactId = studio.activeArtifactId ?? requestedArtifactId;
  const chatBrowserScope = chatBrowserArtifactId ? "artifact" : selectedWorkspaceId ? "workspace" : "library";
  const applicationCommandDispatcher = useMemo(
    () =>
      createApplicationCommandDispatcher({
        openArtifact: (artifactId, surfaceMode) => {
          const artifact = allArtifacts.find((item) => item._id === artifactId);
          if (!artifact)
            throw new Error(
              `APPLICATION_COMMAND_TARGET_NOT_FOUND: ${artifactId}`,
            );
          return requestViewportAction({
            targetId: artifactId,
            view: "artifact",
            navigate: () => {
              if (surfaceMode === "full") openArtifactTab(artifact);
              else openArtifactPanel(artifact);
            },
          });
        },
        addComment: ({ artifactId, body, regionId }) => postSpectra({
          action: "createArtifactComment",
          artifactId,
          commentBody: body,
          regionId: regionId ?? "artifact:structure",
          fallbackExcerpt: regionId ?? "artifact structure",
        }),
        navigate: (destination, targetId) => {
          if (destination === "calendar") router.push("/calendar");
          else if (destination === "settings")
            router.push(
              targetId
                ? `/settings?section=${encodeURIComponent(targetId)}`
                : "/settings",
            );
          else if (destination === "workspace") {
            if (targetId) goToWorkspaceHub(targetId);
            else goToHomeHub();
          } else goToHomeHub();
        },
        replacePreferences,
        preferences,
      }),
    // These shell handlers are intentionally recreated with the current
    // mounted studio state; the dispatcher must never retain a stale panel
    // callback while a user changes workspace or artifact focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allArtifacts, preferences, replacePreferences, router, studio],
  );

  /* The workbench row is measured once here; every panel's split/overlay
     presentation is derived from that single measurement so panels never
     negotiate against each other independently. */
  useEffect(() => {
    const row = workbenchRowRef.current;
    if (!row) return;
    const measure = () => {
      const next = Math.round(row.getBoundingClientRect().width);
      setWorkbenchRowWidth((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const measure = () => setWorkbenchWindowWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const studioPaneFloor = useMemo(() => {
    const key = studio.activeArtifact?.blueprintKey;
    return key && isArtifactTypeKey(key)
      ? getWorkDefinition(key).responsive.minInlineSize
      : 560;
  }, [studio.activeArtifact?.blueprintKey]);

  const workbenchPanes = useMemo<WorkbenchPaneSpec[]>(() => {
    const panes: WorkbenchPaneSpec[] = [];
    if (studio.mode === "split" && studio.activeArtifact)
      panes.push({
        id: "studio",
        floor: studioPaneFloor + studioPaneRoom,
        priority: 0,
        overlay: false,
      });
    if (liveThread)
      panes.push({
        id: "thread",
        floor: SIDE_PANEL_FLOOR_PX,
        priority: 1,
        overlay: false,
      });
    if (activeRunPanelId)
      panes.push({
        id: "run",
        floor: SIDE_PANEL_FLOOR_PX,
        priority: 2,
        overlay: false,
      });
    if (chatBrowserOpen)
      panes.push({
        id: "chat-browser",
        floor: SIDE_PANEL_FLOOR_PX,
        priority: 3,
        overlay: false,
      });
    return panes;
  }, [
    studio.mode,
    studio.activeArtifact,
    studioPaneFloor,
    studioPaneRoom,
    liveThread,
    activeRunPanelId,
    chatBrowserOpen,
  ]);

  /* The reserve is the page's stage minimum (SHELL.md), so the rail gives way
     before the page does and a panel floats before the page goes under it. In
     tab mode the open work *is* the content column, so the reserve is the
     work's own floor. */
  const workbenchReserve =
    studio.mode === "tab" && studio.activeArtifact
      ? Math.max(WORKBENCH_CONTENT_RESERVE_PX, studioPaneFloor)
      : stageMinimumFor(pathname);

  useEffect(() => {
    const panes = workbenchPanes.map((pane) => ({
      ...pane,
      overlay: paneOverlayRef.current[pane.id] ?? false,
    }));
    const next = resolveWorkbenchPanes({
      hostWidth: workbenchRowWidth,
      contentReserve: workbenchReserve,
      panes,
    });
    const current = paneOverlayRef.current;
    const ids = new Set([...Object.keys(current), ...Object.keys(next)]);
    let changed = false;
    for (const id of ids)
      if ((current[id] ?? false) !== (next[id] ?? false)) changed = true;
    if (changed) {
      paneOverlayRef.current = next;
      setPaneOverlay(next);
    }
  }, [workbenchRowWidth, workbenchPanes, workbenchReserve]);

  /* The sidebar is the first pressure valve: when the expanded chrome would
     force a panel out of the flow that the railed chrome would keep, ask the
     shell to rail it. Decided from the window width (not the row) so the
     rail itself cannot feed back into the decision. */
  useEffect(() => {
    const demand = workbenchPanes.length
      ? workbenchReserve +
        workbenchPanes.reduce((total, pane) => total + pane.floor, 0)
      : 0;
    const next = resolveSidebarRail({
      windowWidth: workbenchWindowWidth,
      expandedWidth: SIDEBAR_EXPANDED_PX,
      railedWidth: SIDEBAR_RAILED_PX,
      demand,
      railed: sidebarRailedRef.current,
    });
    if (next !== sidebarRailedRef.current) {
      sidebarRailedRef.current = next;
      setSidebarRailed(next);
    }
  }, [workbenchWindowWidth, workbenchPanes, workbenchReserve]);

  useEffect(() => {
    spectraBus.emit("shell.sidebarCrowd", { crowded: sidebarRailed });
    return () => {
      if (sidebarRailedRef.current)
        spectraBus.emit("shell.sidebarCrowd", { crowded: false });
    };
  }, [sidebarRailed]);

  /* Actual panel widths come from one allocation pass over the intents —
     never from panels measuring each other. */
  const paneWidths = useMemo(
    () =>
      allocateWorkbenchPanes({
        hostWidth: workbenchRowWidth,
        contentReserve: workbenchReserve,
        panes: workbenchPanes.map((pane) => ({
          ...pane,
          overlay: paneOverlay[pane.id] ?? false,
          intent:
            pane.id === "studio"
              ? studioPanelWidth + studioPaneRoom
              : pane.id === "thread"
                ? liveThreadPanelWidth
                : pane.id === "run"
                  ? runPanelWidth
                  : chatBrowserWidth,
          recency: paneRecencyRef.current[pane.id] ?? 0,
          cap: pane.id === "studio" ? 960 + studioPaneRoom : undefined,
        })),
      }),
    [
      workbenchRowWidth,
      workbenchReserve,
      workbenchPanes,
      paneOverlay,
      studioPanelWidth,
      studioPaneRoom,
      liveThreadPanelWidth,
      runPanelWidth,
      chatBrowserWidth,
    ],
  );
  // The island centres on what is left of the stage (ISLAND.md, "Placement").
  const studioBesideWidth =
    studio.mode === "split" && studio.activeArtifact && !paneOverlay.studio ? (paneWidths.studio ?? studioPanelWidth) : 0;
  useEffect(() => {
    if (!studioBesideWidth) return;
    const root = document.documentElement;
    root.style.setProperty("--spectra-side-width", `${Math.round(studioBesideWidth)}px`);
    return () => void root.style.removeProperty("--spectra-side-width");
  }, [studioBesideWidth]);

  useEffect(() => {
    const removeSettings = spectraBus.handle("settings.change", ({ patch }) => {
      replacePreferences(applyPreferencePatch(preferences, patch));
    });
    const removeSync = spectraBus.handle(
      "sync.policy.change",
      async ({ targetIds, patch }) => {
        if (targetIds.length === 0) throw new Error("SYNC_TARGETS_REQUIRED");
        await patchItemSyncPolicies({
          itemIds: targetIds,
          patch,
          idempotencyKey: crypto.randomUUID(),
        });
      },
    );
    const removeMemory = spectraBus.handle(
      "memory.write",
      async ({ action, content, memoryId }) => {
        if (action === "revise") {
          if (!memoryId) throw new Error("MEMORY_ID_REQUIRED");
          await correctSpectraMemory(memoryId, content);
        } else {
          await rememberSpectraMemory({
            proposition: content,
            scope: "private_global",
            claimType: "inferred_preference",
            captureReason: "AI memory write through the shared command path.",
          });
        }
      },
    );
    const removeSharing = spectraBus.handle("sharing.change", async (input) => {
      if (input.action === "invite") {
        await postSpectra({
          action: "inviteShare",
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          inviteeAccountId: input.subjectId ?? "",
          level: input.level ?? "read",
        });
      } else if (input.action === "change_level") {
        await postSpectra({
          action: "changeShareLevel",
          invitationId: input.invitationId ?? "",
          level: input.level ?? "read",
        });
      } else {
        await postSpectra({
          action: "revokeShareAccess",
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          grantId: input.grantId ?? "",
        });
      }
    });
    const removeManageBac = spectraBus.handle("managebac.sync", async () => {
      await syncSpectraManageBac();
    });
    const removeManageBacSelection = spectraBus.handle(
      "managebac.selectClasses",
      async ({ recordIds, expectedRevision, retention }) => {
        await selectSpectraManageBacClasses({
          recordIds,
          ...(typeof expectedRevision === "number" ? { expectedRevision } : {}),
          ...(retention ? { retention } : {}),
        });
      },
    );
    const removeManageBacResource = spectraBus.handle(
      "managebac.importResource",
      async ({ sourceRecordId, refresh, requestKey }) => {
        const result = await importSpectraManageBacResource({
          sourceRecordId,
          ...(refresh ? { refresh: true } : {}),
          ...(requestKey ? { requestKey } : {}),
        });
        return {
          status: result.status === "update_available" ? "pending" : "completed",
          message:
            result.status === "update_available"
              ? "A newer school resource revision is available; import it explicitly to update your Library copy."
              : result.status === "imported"
                ? "The school resource is saved in Library."
                : "The school resource import is ready to finish.",
          data: result,
        } satisfies SpectraCommandOutcome;
      },
    );
    const removeImport = spectraBus.handle("library.import", ({ kind }) => {
      // The click must happen in this same task, while the command's key or
      // press still counts as the user's own gesture, or no picker opens.
      const input = kind === "file" ? importInputRef.current : workspaceImportInputRef.current;
      if (!input)
        return {
          status: "failed",
          message: "Importing is not available on this page. Open Library and try again.",
        } satisfies SpectraCommandOutcome;
      input.value = "";
      input.click();
      return {
        status: "completed",
        message: kind === "file" ? "Choose a file to import." : "Choose a workspace file to import.",
      } satisfies SpectraCommandOutcome;
    });
    return () => {
      removeSettings();
      removeSync();
      removeMemory();
      removeSharing();
      removeManageBac();
      removeManageBacSelection();
      removeManageBacResource();
      removeImport();
    };
  }, [patchItemSyncPolicies, preferences, replacePreferences, router]);

  useEffect(() => {
    if (!requestedHome) return;
    goToHomeHub();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hub bootstrap once per requestedHome
  }, [requestedHome]);

  useEffect(() => {
    if (
      !hubTabsRestored ||
      !activeHubTabId ||
      selectedWorkspaceId !== requestedWorkspaceId
    )
      return;
    const target = requestedWorkspaceId
      ? overview?.workspaces.find((item) => item._id === requestedWorkspaceId)
      : undefined;
    if (requestedWorkspaceId && !target) return;
    const label = target?.title ?? LIBRARY_TAB_LABEL;
    setHubTabs((current) => {
      const active = current.find((tab) => tab.id === activeHubTabId);
      // A work set's tab is named by its work, not by the page under it.
      if (
        !active ||
        active.workSet ||
        (active.label === label && active.workspaceId === requestedWorkspaceId)
      )
        return current;
      return current.map((tab) =>
        tab.id === activeHubTabId
          ? { ...tab, label, workspaceId: requestedWorkspaceId }
          : tab,
      );
    });
  }, [
    activeHubTabId,
    hubTabsRestored,
    overview?.workspaces,
    requestedWorkspaceId,
    selectedWorkspaceId,
  ]);
  const setActiveRunPanelId = useCallback(
    (runId: string | null, label = "Run details") => {
      if (runId) setChatBrowserOpen(false);
      if (runId)
        openObject({
          type: "run",
          id: runId,
          label,
          presentation: "run-panel",
          workspaceId: selectedWorkspaceId,
        });
      else closePresentation("run-panel");
    },
    [closePresentation, openObject, selectedWorkspaceId],
  );
  const setLiveThread = useCallback(
    (thread: { id: string; title: string } | null) => {
      if (thread) {
        // The Side holds one pane: a conversation takes the chat browser's place.
        setChatBrowserOpen(false);
        openObject({
          type: "thread",
          id: thread.id,
          label: thread.title,
          presentation: "thread-panel",
          workspaceId: selectedWorkspaceId,
        });
      } else closePresentation("thread-panel");
    },
    [closePresentation, openObject, selectedWorkspaceId],
  );
  const tiledArtifacts = useMemo(
    () =>
      tileArtifactIds.flatMap((id) => {
        const artifact = allArtifacts.find((item) => item._id === id);
        return artifact?.content !== undefined && artifact.accessLevel !== null && artifact.status !== "deleted" ? [artifact] : [];
      }),
    [allArtifacts, tileArtifactIds],
  );
  const workspaceRuns = selectedWorkspaceId
    ? runs.filter((run) => run.workspaceId === selectedWorkspaceId)
    : runs;
  const workspaces = useMemo(
    () =>
      sortSpectraWorkspaces(
        (overview?.workspaces ?? []).map((workspace) => {
          const live = liveIdentityByKey.get(`workspace:${workspace._id}`);
          return live ? { ...workspace, title: live.name } : workspace;
        }),
      ),
    [liveIdentityByKey, overview?.workspaces],
  );
  const {
    composerThread,
    setComposerThread,
    selectedContextIds,
    selectedObjectKeys,
    selectionCount,
    open: openPointers,
    setSelectedContextIds,
    clearDraftSelection,
    setVisibleObjects,
    setActiveWorkspaceContext,
  } = useSpectraContext(allArtifacts, workspaces);
  // Opening a chat is intentionally read-only. Continuation is an explicit
  // action from the Live Dock or chat panel, so browsing never hijacks the
  // composer target.
  useEffect(() => {
    if (!requestedThreadId) return;
    void getSpectraThread(requestedThreadId)
      .then((value) => {
        setLiveThread({ id: value.thread._id, title: value.thread.title });
      })
      .catch(() => toast.error("That conversation is no longer available."));
  }, [requestedThreadId, setLiveThread]);
  const workspaceIndexEntry =
    workspaces.find((candidate) => candidate._id === selectedWorkspaceId) ??
    null;
  const workspaceHeader = useMemo(
    () =>
      workspaceIndexEntry &&
      (!workspace || workspaceIndexEntry.updatedAt >= workspace.updatedAt)
        ? { ...workspace, ...workspaceIndexEntry }
        : (workspace ?? workspaceIndexEntry),
    [workspace, workspaceIndexEntry],
  );
  useEffect(() => {
    if (!workspaceIndexEntry) return;
    setHubTabs((current) =>
      current.map((tab) =>
        tab.workspaceId === workspaceIndexEntry._id &&
        tab.label !== workspaceIndexEntry.title
          ? { ...tab, label: workspaceIndexEntry.title }
          : tab,
      ),
    );
  }, [workspaceIndexEntry]);
  useEffect(
    () =>
      setActiveWorkspaceContext(
        workspaceHeader
          ? { id: workspaceHeader._id, title: workspaceHeader.title }
          : null,
      ),
    [setActiveWorkspaceContext, workspaceHeader],
  );
  const entries = useMemo<WorkspaceEntry[]>(
    () =>
      (selectedWorkspaceId &&
      overview?.workspace?.workspace?._id === selectedWorkspaceId
        ? overview.workspace.items
        : []
      ).flatMap((item): WorkspaceEntry[] => {
        const card = workspaceItemToCard(item);
        if (item.artifact && card)
          return [{ item, artifact: item.artifact, card }];
        if (item.kind === "thread" && item.thread)
          return [{ item, thread: item.thread }];
        return [];
      }),
    [overview?.workspace, selectedWorkspaceId],
  );
  const selectedArtifact =
    selection?.type === "artifact"
      ? (entries.find((entry) => entry.item.nodeId === selection.itemId)
          ?.artifact ?? null)
      : null;
  const selectedRun =
    selection?.type === "run"
      ? (runs.find((run) => run._id === selection.runId) ?? null)
      : null;
  const commandFocusArtifact = studio.isOpen
    ? studio.activeArtifact
    : selectedArtifact;
  useEffect(() => {
    const focusedArtifactId = commandFocusArtifact?._id;
    if (!composerThread || !focusedArtifactId) return;
    // Only auto-scope when this conversation already belongs to an artifact.
    // Opening a free-standing thread beside an artifact must not close the panel.
    if (!composerThread.artifactId) return;
    let disposed = false;
    void getSpectraThread(composerThread.id)
      .then(({ thread }) => {
        if (disposed) return;
        if (!thread.artifactId) return;
        if (thread.artifactId === focusedArtifactId) {
          if (composerThread.artifactId !== focusedArtifactId)
            setComposerThread((current) =>
              current?.id === thread._id
                ? { ...current, artifactId: focusedArtifactId }
                : current,
            );
          return;
        }
        // A conversation follows its artifact automatically, but it never
        // silently follows the user into a different artifact.
        setComposerThread(null);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [
    commandFocusArtifact?._id,
    composerThread,
    composerThread?.id,
    composerThread?.artifactId,
    setComposerThread,
  ]);
  useEffect(() => {
    setVisibleObjects([
      ...tiledArtifacts.map((artifact) => ({
        type: "artifact" as const,
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        source: "visible" as const,
        capability: "tile" as const,
      })),
      ...(commandFocusArtifact
        ? [
            {
              type: "artifact" as const,
              id: commandFocusArtifact._id,
              label: commandFocusArtifact.title,
              workspaceId: commandFocusArtifact.placements?.[0]?.workspaceId,
              source: "visible" as const,
              capability: "tile" as const,
            },
          ]
        : []),
      ...(liveThread
        ? [
            {
              type: "thread" as const,
              id: liveThread.id,
              label: liveThread.title,
              workspaceId: selectedWorkspaceId,
              source: "visible" as const,
              capability: "context" as const,
            },
          ]
        : []),
    ]);
  }, [
    commandFocusArtifact,
    liveThread,
    selectedWorkspaceId,
    setVisibleObjects,
    tiledArtifacts,
  ]);
  const initialResultCards = useMemo(
    () =>
      (overview?.resultCards ?? []).filter(
        (card) => card.run?.sourceSurface !== "chat",
      ),
    [overview?.resultCards],
  );
  const refreshRunData = useCallback(async () => {
    const focusedArtifactId = commandFocusArtifact?._id;
    const overviewRefresh = loadOverview(selectedWorkspaceId, true);
    // The workspace overview and the artifact query travel independently. A
    // run can commit between those reads, leaving an open editor and its card
    // one revision behind even though the operation completed successfully.
    // The focused-artifact read is the authoritative reconciliation boundary.
    const focusedRefresh = focusedArtifactId ? artifactAccess.read(focusedArtifactId).then(({ artifact: canonical }) => {
      if (!canonical) return;
      setHydratedArtifacts((current) => current[canonical._id]
        ? { ...current, [canonical._id]: canonical }
        : current);
      setOverview((current) =>
        current
          ? {
              ...current,
              artifacts: current.artifacts.some(
                (item) => item._id === canonical._id,
              )
                ? current.artifacts.map((item) =>
                    item._id === canonical._id
                      ? mergeLiveAiArtifact(item, canonical)
                      : item,
                  )
                : [canonical, ...current.artifacts],
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    items: current.workspace.items.map((item) =>
                      item.artifact?._id === canonical._id
                        ? {
                            ...item,
                            artifact: mergeLiveAiArtifact(
                              item.artifact,
                              canonical,
                            ),
                          }
                        : item,
                    ),
                  }
                : current.workspace,
            }
          : current,
      );
    }).catch(() => undefined) : Promise.resolve();
    const [next] = await Promise.all([overviewRefresh, focusedRefresh]);
    return next;
  }, [artifactAccess, commandFocusArtifact?._id, loadOverview, selectedWorkspaceId, setHydratedArtifacts, setOverview]);
  const applyLiveArtifactPatch = useCallback(
    (artifactId: string, patch: Record<string, unknown>) => {
      const apply = (artifact: SpectraArtifact): SpectraArtifact => {
        if (artifact._id !== artifactId) return artifact;
        if (patch.clearAi === true) {
          return {
            ...artifact,
            aiState: undefined,
            aiEffects: undefined,
            aiPreview: undefined,
            aiProgress: undefined,
            aiStateExpiresAt: undefined,
          };
        }
        const tags = Array.isArray(patch.tags)
          ? patch.tags.filter((tag): tag is string => typeof tag === "string")
          : undefined;
        const patchedContent = applyPreviewContentPatch(
          artifact.content,
          patch.contentPatch,
        );
        const previewContent =
          patchedContent !== undefined
            ? patchedContent
            : patch.content !== undefined && patch.content !== null
              ? patch.content
              : undefined;
        const effectActivity =
          typeof patch.effectActivity === "string" &&
          ["create", "edit", "verify", "other"].includes(patch.effectActivity)
            ? (patch.effectActivity as "create" | "edit" | "verify" | "other")
            : undefined;
        const effectId =
          typeof patch.effectRunId === "string" &&
          typeof patch.effectExecutionId === "string" &&
          typeof patch.effectTitle === "string"
            ? `${patch.effectRunId}:${
                typeof patch.effectOperationIndex === "number"
                  ? patch.effectOperationIndex
                  : `focused:${typeof patch.effectRegionHint === "string" ? patch.effectRegionHint : (effectActivity ?? "other")}`
              }`
            : undefined;
        const existingEffect = effectId
          ? artifact.aiEffects?.find((effect) => effect.effectId === effectId)
          : undefined;
        const patchRegionIds = Array.isArray(patch.regionIds)
          ? patch.regionIds.filter(
              (regionId): regionId is string => typeof regionId === "string",
            )
          : Array.isArray(patch.effectRegionIds)
            ? patch.effectRegionIds.filter(
                (regionId): regionId is string => typeof regionId === "string",
              )
            : undefined;
        const liveEffects = effectId
          ? [
              ...(artifact.aiEffects ?? []).filter(
                (effect) => effect.effectId !== effectId,
              ),
              {
                effectId,
                runId: String(patch.effectRunId),
                executionId: String(patch.effectExecutionId),
                ...(typeof patch.effectOperationIndex === "number"
                  ? { operationIndex: patch.effectOperationIndex }
                  : {}),
                title: String(patch.effectTitle),
                ...(typeof patch.effectDetail === "string"
                  ? { detail: patch.effectDetail }
                  : {}),
                activity: effectActivity ?? "other",
                ...(typeof patch.effectRegionHint === "string"
                  ? { regionHint: patch.effectRegionHint }
                  : {}),
                regionIds: patchRegionIds ?? existingEffect?.regionIds ?? [],
                changedPaths: Array.isArray(patch.changedPaths)
                  ? patch.changedPaths.filter(
                      (path): path is string => typeof path === "string",
                    )
                  : (existingEffect?.changedPaths ?? []),
                state: "active" as const,
                startedAt: existingEffect?.startedAt ?? Date.now(),
                updatedAt: Date.now(),
              },
            ].slice(-24)
          : patchRegionIds && artifact.aiEffects?.length
            ? artifact.aiEffects.map((effect, index, list) =>
                index === list.length - 1
                  ? {
                      ...effect,
                      regionIds: patchRegionIds,
                      updatedAt: Date.now(),
                    }
                  : effect,
              )
            : artifact.aiEffects;
        if (artifact.aiState === "creating") {
          // Creates write content onto the pending shell immediately. Mirror
          // Convex patchPendingContent by keeping aiPreview.changedPaths set so
          // studios can light data-ai-region before the query catch-up arrives.
          const creatingChangedPaths =
            Array.isArray(patch.changedPaths) && patch.changedPaths.length > 0
              ? patch.changedPaths.filter(
                  (path): path is string => typeof path === "string",
                )
              : artifact.aiPreview?.changedPaths?.length
                ? artifact.aiPreview.changedPaths
                : // Sheets stay cell-exact; other creates default to whole-artifact.
                  artifact.blueprintKey === "sheets"
                  ? []
                  : ["/"];
          return {
            ...artifact,
            ...(typeof patch.title === "string" ? { title: patch.title } : {}),
            ...(typeof patch.summary === "string"
              ? { summary: patch.summary }
              : {}),
            ...(previewContent !== undefined
              ? { content: previewContent }
              : {}),
            ...(tags ? { tags } : {}),
            aiProgress:
              typeof patch.progress === "number"
                ? patch.progress
                : artifact.aiProgress,
            aiEffects: liveEffects?.map((effect) =>
              effect.changedPaths.length
                ? effect
                : creatingChangedPaths.length
                  ? { ...effect, changedPaths: creatingChangedPaths }
                  : effect,
            ),
            aiPreview: {
              ...(artifact.aiPreview ?? { startedAt: Date.now() }),
              ...(previewContent !== undefined
                ? { content: previewContent }
                : {}),
              ...(creatingChangedPaths.length
                ? { changedPaths: creatingChangedPaths }
                : artifact.aiPreview?.changedPaths
                  ? {}
                  : { changedPaths: [] }),
              ...(typeof patch.effectTitle === "string"
                ? { effectTitle: patch.effectTitle }
                : {}),
              ...(typeof patch.effectDetail === "string"
                ? { effectDetail: patch.effectDetail }
                : {}),
              ...(typeof patch.effectActivity === "string" &&
              ["create", "edit", "verify", "other"].includes(
                patch.effectActivity,
              )
                ? {
                    effectActivity: patch.effectActivity as
                      "create" | "edit" | "verify" | "other",
                  }
                : {}),
              ...(typeof patch.effectRegionHint === "string"
                ? { effectRegionHint: patch.effectRegionHint }
                : {}),
              ...(typeof patch.effectOperationIndex === "number"
                ? { effectOperationIndex: patch.effectOperationIndex }
                : {}),
            },
          };
        }
        // Existing artifacts keep their canonical baseline stable while the
        // streamed proposal is rendered as a region-scoped overlay. This lets
        // the editor preserve unrelated local typing and prevents a preview from
        // masquerading as a committed revision.
        //
        // An approach/queue frame has no edited region yet. Painting `/` here
        // made every control flash blue before the AI body reached its target,
        // and a resumed operation looked complete before its native gesture
        // began. Preserve an already concrete path, otherwise remain unpainted
        // until the live performer publishes the first real beat.
        const updatingChangedPaths =
          Array.isArray(patch.changedPaths) && patch.changedPaths.length > 0
            ? patch.changedPaths.filter(
                (path): path is string => typeof path === "string",
              )
            : artifact.aiPreview?.changedPaths?.length
              ? artifact.aiPreview.changedPaths
              : [];
        return {
          ...artifact,
          aiState: "updating",
          aiProgress:
            typeof patch.progress === "number"
              ? patch.progress
              : artifact.aiProgress,
          aiEffects: liveEffects?.map((effect) =>
            effect.changedPaths.length
              ? effect
              : updatingChangedPaths.length
                ? { ...effect, changedPaths: updatingChangedPaths }
                : effect,
          ),
          aiPreview: {
            ...(artifact.aiPreview ?? { startedAt: Date.now() }),
            ...(typeof patch.title === "string" ? { title: patch.title } : {}),
            ...(typeof patch.summary === "string"
              ? { summary: patch.summary }
              : {}),
            ...(previewContent !== undefined
              ? { content: previewContent }
              : {}),
            ...(tags ? { tags } : {}),
            ...(updatingChangedPaths.length
              ? { changedPaths: updatingChangedPaths }
              : artifact.aiPreview?.changedPaths
                ? {}
                : Array.isArray(patch.changedPaths)
                  ? { changedPaths: [] }
                  : {}),
            ...(typeof patch.effectTitle === "string"
              ? { effectTitle: patch.effectTitle }
              : {}),
            ...(typeof patch.effectDetail === "string"
              ? { effectDetail: patch.effectDetail }
              : {}),
            ...(typeof patch.effectActivity === "string" &&
            ["create", "edit", "verify", "other"].includes(patch.effectActivity)
              ? {
                  effectActivity: patch.effectActivity as
                    "create" | "edit" | "verify" | "other",
                }
              : {}),
            ...(typeof patch.effectRegionHint === "string"
              ? { effectRegionHint: patch.effectRegionHint }
              : {}),
            ...(typeof patch.effectOperationIndex === "number"
              ? { effectOperationIndex: patch.effectOperationIndex }
              : {}),
          },
        };
      };
      let missing = true;
      setHydratedArtifacts((current) => current[artifactId]
        ? { ...current, [artifactId]: apply(current[artifactId]) }
        : current);
      setOverview((current) => {
        if (!current) return current;
        const exists =
          current.artifacts.some((item) => item._id === artifactId) ||
          Boolean(
            current.workspace?.items.some(
              (item) => item.artifact?._id === artifactId,
            ),
          );
        if (!exists) return current;
        missing = false;
        return {
          ...current,
          artifacts: current.artifacts.map(apply),
          workspace: current.workspace
            ? {
                ...current.workspace,
                items: current.workspace.items.map((item) =>
                  item.artifact?._id === artifactId
                    ? { ...item, artifact: apply(item.artifact) }
                    : item,
                ),
              }
            : current.workspace,
        };
      });
      // Pending creates can stream patches a beat before overview includes the
      // shell. Seed from the canonical artifact endpoint so list/timeline AI
      // states light up instead of silently dropping the patch.
      if (missing) {
        void artifactAccess.read(artifactId)
          .then(({ artifact }) => {
            if (!artifact) return;
            setOverview((current) => {
              if (!current) return current;
              if (
                current.artifacts.some((item) => item._id === artifactId) ||
                current.workspace?.items.some(
                  (item) => item.artifact?._id === artifactId,
                )
              ) {
                return {
                  ...current,
                  artifacts: current.artifacts.map((item) =>
                    item._id === artifactId ? apply(item) : item,
                  ),
                  workspace: current.workspace
                    ? {
                        ...current.workspace,
                        items: current.workspace.items.map((item) =>
                          item.artifact?._id === artifactId
                            ? { ...item, artifact: apply(item.artifact) }
                            : item,
                        ),
                      }
                    : current.workspace,
                };
              }
              return {
                ...current,
                artifacts: [apply(artifact), ...current.artifacts],
              };
            });
          })
          .catch(() => undefined);
      }
    },
    [artifactAccess, setHydratedArtifacts, setOverview],
  );
  const runEngine = useSpectraRun({
    surface: composerThread
      ? "workspace"
      : commandFocusArtifact
        ? "artifact"
        : "workspace",
    workspaceId: selectedWorkspaceId,
    scopeNodeId:
      currentLibraryNodeId ??
      requestedNodeId ??
      scopeNodeId ??
      undefined,
    artifactId: commandFocusArtifact?._id,
    threadId: composerThread?.id,
    open: openPointers,
    initialCards: initialResultCards,
    onThreadReady: (threadId) => {
      setComposerThread((current) =>
        current?.id === threadId
          ? current
          : {
              id: threadId,
              title: "Current conversation",
              ...(commandFocusArtifact
                ? { artifactId: commandFocusArtifact._id }
                : {}),
            },
      );
      setActiveRunPanelId(null);
      spectraBus.emit("threads.changed", {});
    },
    onContinuationConflict: startFreshComposerThread,
    onDataChanged: refreshRunData,
    onArtifactPatch: applyLiveArtifactPatch,
    onOpenArtifact: async (artifactId) => {
      const refreshed = await loadOverview(selectedWorkspaceId, true);
      const artifact = refreshed?.artifacts.find(
        (item) => item._id === artifactId,
      );
      if (artifact) openArtifactPanel(artifact);
    },
  });

  useEffect(() => {
    if (!requestedWorkspaceId || !overview || selectedWorkspaceId !== requestedWorkspaceId) return;
    const frame = requestAnimationFrame(() => acknowledgeViewportReady({
      targetId: requestedWorkspaceId,
      view: "workspace",
    }));
    return () => cancelAnimationFrame(frame);
  }, [overview, requestedWorkspaceId, selectedWorkspaceId]);

  useEffect(() => spectraBus.handle("run.stopRequested", async ({ runId }) => {
    if (runId && runEngine.activeRunId && runEngine.activeRunId !== runId) return;
    await runEngine.stop(runId);
    return {
      status: "completed",
      message: "Stop requested. Committed work remains available.",
    } satisfies SpectraCommandOutcome;
  }), [runEngine]);

  useEffect(() => {
    const exchange = runEngine.liveExchange;
    if (!exchange?.runId || (exchange.status !== "failed" && exchange.status !== "stopped")) return;
    const runId = exchange.runId;
    const clearChrome = (artifact: SpectraArtifact): SpectraArtifact => {
        if (
          artifact.aiRunId !== runId &&
          !(artifact.aiEffects ?? []).some((effect) => effect.runId === runId)
        )
          return artifact;
        if (
          artifact.aiState !== "creating" &&
          artifact.aiState !== "updating" &&
          !(artifact.aiEffects ?? []).some(
            (effect) => effect.state === "active",
          )
        )
          return artifact;
        return {
          ...artifact,
          aiState: undefined,
          aiEffects: undefined,
          aiPreview: undefined,
          aiProgress: undefined,
          aiStateExpiresAt: undefined,
          aiRunId: undefined,
        };
    };
    setHydratedArtifacts((current) => {
      let changed = false;
      const next = Object.fromEntries(Object.entries(current).map(([id, artifact]) => {
        const cleared = clearChrome(artifact);
        changed ||= cleared !== artifact;
        return [id, cleared];
      }));
      return changed ? next : current;
    });
    setOverview((current) => {
      if (!current) return current;
      return {
        ...current,
        artifacts: current.artifacts.map(clearChrome),
        workspace: current.workspace
          ? {
              ...current.workspace,
              items: current.workspace.items.map((item) =>
                item.artifact
                  ? { ...item, artifact: clearChrome(item.artifact) }
                  : item,
              ),
            }
          : current.workspace,
      };
    });
    void loadOverview(selectedWorkspaceId, true);
  }, [
    loadOverview,
    runEngine.liveExchange,
    runEngine.liveExchange?.runId,
    runEngine.liveExchange?.status,
    selectedWorkspaceId,
    setOverview,
    setHydratedArtifacts,
  ]);

  useEffect(() => {
    function onOpenArtifact({ workId: artifactId, region }: { workId: string; region?: WorkRegion }) {
      if (!artifactId) return;
      expectLanding(artifactId, region);
      // Overview cache is not the membership test. Embeds, follow, and
      // calendar can name work that is not in the loaded snapshot yet; a
      // silent miss leaves Open source looking wired and doing nothing.
      openArtifactById(artifactId);
    }
    // The app shell's navigator handles navigation.show on every page; the
    // workbench shows the library and workspaces in its own hub.
    function onAiNavigate(detail: NavigationShow) {
      if (detail.route !== "library" && detail.route !== "workspace") return false;
      if (detail.target) goToWorkspaceHub(detail.target);
      else goToHomeHub();
      return true;
    }
    const refresh = () => {
      void loadOverview(selectedWorkspaceId, true);
    };
    const refreshActivatedArtifact = ({
      artifactId,
    }: {
      artifactId: string;
    }) => {
      if (!artifactId) return;
      void artifactAccess.read(artifactId)
        .then(({ artifact }) => {
          if (!artifact) return;
          setHydratedArtifacts((current) => current[artifact._id]
            ? { ...current, [artifact._id]: artifact }
            : current);
          setOverview((current) => {
            if (!current) return current;
            return {
              ...current,
              artifacts: current.artifacts.map((item) =>
                item._id === artifact._id ? artifact : item,
              ),
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    items: current.workspace.items.map((item) =>
                      item.artifact?._id === artifact._id
                        ? { ...item, artifact }
                        : item,
                    ),
                  }
                : current.workspace,
            };
          });
        })
        .catch(() => {
          // The mutation already succeeded; a later overview refresh can
          // recover the projection if this one-shot read is interrupted.
          void loadOverview(selectedWorkspaceId, true);
        });
    };
    const navigateWorkspaceHome = () => goToHomeHub();
    const shareFromShell = () => {
      if (studio.activeArtifact) return;
      if (selectedWorkspaceId && workspaceHeader) setWorkspaceShareOpen(true);
      else toast.info("Open a workspace to share it with school members.");
    };
    const removeOpenArtifact = spectraBus.handle("work.open", onOpenArtifact);
    const removeOpenConversation = spectraBus.handle(
      "run.openConversation",
      async ({ runId, threadId }) => {
        const resolvedThreadId =
          threadId?.trim() || (await getSpectraRunDetail(runId)).run.threadId;
        if (!resolvedThreadId) throw new Error("RUN_THREAD_NOT_FOUND");
        const thread = await getSpectraThread(resolvedThreadId);
        const readiness = await requestViewportAction({
          targetId: resolvedThreadId,
          view: "conversation",
          navigate: () => setLiveThread({ id: thread.thread._id, title: thread.thread.title }),
        });
        return {
          status: readiness.status === "ready" ? "completed" : "failed",
          message: readiness.status === "ready" ? "Conversation opened." : readiness.reason ?? "Conversation could not be opened.",
          readiness,
        } satisfies SpectraCommandOutcome;
      },
    );
    const removeAiNavigate = registerInPageNavigation(onAiNavigate);
    const removeLensActivated = spectraBus.on(
      "artifact.lensActivated",
      refreshActivatedArtifact,
    );
    const removeRefresh = spectraBus.on("workspace.refreshRequested", refresh);
    const removeStorageMoved = spectraBus.on("artifact.storageMoved", refreshActivatedArtifact);
    const removeNavigateHome = spectraBus.handle(
      "navigation.home",
      navigateWorkspaceHome,
    );
    const removeShare = spectraBus.handle("surface.share", shareFromShell);
    return () => {
      removeOpenArtifact();
      removeOpenConversation();
      removeAiNavigate();
      removeLensActivated();
      removeRefresh();
      removeStorageMoved();
      removeNavigateHome();
      removeShare();
    };
    // Event handlers intentionally read the current shell closures after each render.
  });

  async function _openRunPanel(runId: string, title: string) {
    try {
      await getSpectraRunDetail(runId);
      setActiveRunPanelId(runId, title);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: `Could not open ${title}.` })
          .message,
      );
    }
  }

  // What each picked work is, for work the loaded overview does not hold (picked from the shelf's full tree).
  const pickedWorkRef = useRef(new Map<string, { title: string; type?: string }>());
  function toggleContextArtifact(artifactId: string, work: { title: string; type?: string }) {
    pickedWorkRef.current.set(artifactId, work);
    setMultiSelectMode(true);
    setSelectedContextIds((current) => {
      const next = new Set(current);
      if (next.has(artifactId)) next.delete(artifactId);
      else if (next.size < 24) next.add(artifactId);
      else
        toast.message("You can select up to 24 work items at once.");
      return next;
    }, new Map([[artifactId, work.title]]));
  }

  /**
   * The organizer names a work by its id, because that is what the
   * tree stores. A work made a moment ago is not in the loaded overview yet, so a
   * miss refreshes once instead of failing silently.
   */
  function requestArtifactOpen(
    artifactId: string,
    historyMode: "push" | "replace" | "none" = "push",
    mode: "split" | "tab" = "split",
  ) {
    const mounted = useSpectraContextStore.getState().openObjects.some((object) => object.type === "artifact" && object.id === artifactId)
      ? readyStudioArtifacts.find((artifact) => artifact._id === artifactId)
      : undefined;
    return loadArtifactForOpen(artifactId, historyMode, mode,
      isProgrammaticOpen() || isProgrammaticFollowOpen(), mounted);
  }

  function openArtifactById(artifactId: string) {
    void requestArtifactOpen(artifactId)
      .catch(() => toast.error("That work could not be opened."));
  }

  /**
   * A link straight to one work: /library/<workId>, or ?artifactId=.
   *
   * It cannot be judged until the first overview has arrived, because until then
   * every id is equally absent. Once it has, a link that resolves to nothing has
   * to say so — otherwise the reader lands on an unchanged surface with no
   * explanation of why the thing they followed is not in front of them. Fires
   * once per id, so dismissing the toast does not summon it again.
   */
  useEffect(() => {
    /* A native history write is synchronous, while Next's hook snapshot can
       lag it by one render. Read the browser here so closing A or opening B
       cannot be undone by the stale `artifactId=A` snapshot. */
    const routeArtifactId = artifactIdFromSpectraLocation(
      window.location.pathname,
      window.location.search,
    );
    if (!routeArtifactId) {
      if (previousRequestedArtifactIdRef.current) cancelArtifactOpen();
      if (previousRequestedArtifactIdRef.current && studio.isOpen) {
        studio.closeStudio();
        setSelection(null);
      }
      previousRequestedArtifactIdRef.current = undefined;
      openedDeepLinkRef.current = null;
      return;
    }
    previousRequestedArtifactIdRef.current = routeArtifactId;
    if (openedDeepLinkRef.current === routeArtifactId) return;
    if (!overview) return;
    openedDeepLinkRef.current = routeArtifactId;
    // "Open full" pressed elsewhere arrives here; it opens full on that one press.
    void requestArtifactOpen(routeArtifactId, "replace", takeFullViewRequest(routeArtifactId) ? "tab" : "split")
      .catch(() => {
        if (
          artifactIdFromSpectraLocation(
            window.location.pathname,
            window.location.search,
          ) !== routeArtifactId
        )
          return;
        toast.error("That work could not be loaded. Try again.");
      });
    // openArtifactPanel is a render-local function; the guard ref, not the dep
    // list, is what keeps this to one open per id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allArtifacts,
    overview,
    requestedArtifactId,
    selectedWorkspaceId,
    studio.closeStudio,
    studio.isOpen,
  ]);

  function clearSelection() {
    clearDraftSelection();
  }

  // The picked work goes into the island's message as references, and picking ends: the question is the next step.
  const setWorksShared = useMutation(api.workspaceSharing.setWorksShared);
  function shareSelection(shared: boolean) {
    void setWorksShared({ artifactIds: [...selectedContextIds], shared }).then(
      (result) => {
        const done = result.changed === 1 ? "1 work" : `${result.changed} works`;
        if (result.changed)
          toast.success(shared ? `Shared ${done} with their workspace.` : `Made ${done} private.`);
        else if (!result.skipped) toast.success(shared ? "Already shared." : "Already private.");
        if (result.skipped)
          toast.error(`${result.skipped} stayed as they were: only your own works inside a workspace can be shared with it.`);
      },
      (error) => toast.error(describeFailure(error, { fallback: "The picked works did not change." }).message),
    );
  }

  function askAboutSelection() {
    const references = [...selectedContextIds].flatMap((id) => {
      const loaded = allArtifacts.find((artifact) => artifact._id === id);
      const work = loaded ? { title: loaded.title, type: loaded.blueprintKey } : pickedWorkRef.current.get(id);
      return work ? [{ id, type: work.type ?? "document", title: work.title }] : [];
    });
    if (!references.length) return;
    spectraBus.emit("island.compose", { fresh: true, references });
    clearSelection();
    setMultiSelectMode(false);
  }

  function openSelectedArtifactsInTiles() {
    cancelArtifactOpen();
    const selectedIds = [...selectedContextIds]
      .filter((id) => pickedWorkRef.current.has(id) || allArtifacts.some((artifact) => artifact._id === id))
      .slice(0, 24);
    if (selectedIds.length === 0) {
      toast.message("Select one or more items first.");
      return;
    }
    const objects = selectedIds.flatMap((id) => {
        const artifact = allArtifacts.find((item) => item._id === id);
        const label = artifact?.title ?? pickedWorkRef.current.get(id)?.title;
        return label
          ? [
              {
                type: "artifact" as const,
                id,
                label,
                workspaceId: artifact?.placements?.[0]?.workspaceId,
                presentation: "tile" as const,
              },
            ]
          : [];
      });
    setTileObjects(objects);
    openedDeepLinkRef.current = null;
    studio.closeStudio();
    replaceWorkspaceLocation(selectedWorkspaceId);
    setWorkSetIsolated(true);
    // The picked work gets its own tab in the top rail, so the page it was picked on stays where it was.
    const tab: WorkspaceHubTab = { ...workspaceHubTab(workSetLabel(objects.map((object) => object.label))), workSet: objects };
    setHubTabs((current) => [...current, tab]);
    setActiveHubTabId(tab.id);
    pushShellNav({ kind: "hub", hubTabId: tab.id });
    clearSelection();
    setMultiSelectMode(false);
  }

  /** Leaving a work set's tab for another page takes its tiles down with it; the tab keeps them. */
  function leaveWorkSet() {
    if (activeWorkSetTab) clearTiles();
  }

  /** A work set's tab follows the tiles added to it or closed in it, and goes with the last one. */
  function updateWorkSet(objects: SpectraOpenObject[]) {
    if (!activeWorkSetTab) return;
    if (!objects.length) {
      closeHubTab(activeWorkSetTab.id);
      return;
    }
    setHubTabs((current) =>
      current.map((tab) =>
        tab.id === activeWorkSetTab.id ? { ...tab, label: workSetLabel(objects.map((object) => object.label)), workSet: objects } : tab,
      ),
    );
  }

  function closeTileArtifact(artifactId: string) {
    removeTileObject(artifactId);
    if (activeWorkSetTab?.workSet) updateWorkSet(activeWorkSetTab.workSet.filter((object) => object.id !== artifactId));
  }

  function addArtifactTile(artifactId: string) {
    const artifact = allArtifacts.find((item) => item._id === artifactId);
    if (!artifact) return;
    const tile = {
      type: "artifact" as const,
      id: artifact._id,
      label: artifact.title,
      workspaceId: artifact.placements?.[0]?.workspaceId,
      presentation: "tile" as const,
    };
    addTileObject(tile);
    if (activeWorkSetTab?.workSet && !activeWorkSetTab.workSet.some((object) => object.id === tile.id)) updateWorkSet([...activeWorkSetTab.workSet, tile]);
  }

  function closeTileSet() {
    cancelArtifactOpen();
    if (activeWorkSetTab) closeHubTab(activeWorkSetTab.id);
    else clearTiles();
  }

  function openArtifactPanel(
    artifact: SpectraArtifact,
    historyMode: "push" | "replace" | "none" = "push",
  ) {
    void requestArtifactOpen(artifact._id, historyMode)
      .catch(() => toast.error("That work could not be opened."));
  }

  function openResolvedArtifactPanel(
    artifact: SpectraArtifact,
    historyMode: "push" | "replace" | "none",
    preserveFollow: boolean,
  ) {
    // A user-chosen open ends spectating; a follow-dispatched open does not.
    if (!preserveFollow) {
      disengageFollowAi();
      disengageFollow("user_input");
    }
    if (artifact.blueprintKey === "thread_reference") {
      const content =
        artifact.content && typeof artifact.content === "object"
          ? (artifact.content as Record<string, unknown>)
          : {};
      const threadId =
        typeof content.threadId === "string" ? content.threadId : "";
      if (threadId) {
        setLiveThread({ id: threadId, title: artifact.title });
        requestAnimationFrame(() =>
          acknowledgeViewportReady({
            targetId: artifact._id,
            view: "artifact",
          }),
        );
        return;
      }
    }
    openedDeepLinkRef.current = artifact._id;
    // Open beside existing work by default; expand to full-page via Maximize.
    studio.openSplit(artifact);
    if (historyMode !== "none") pushShellNav(
      {
        kind: "artifact-split",
        hubTabId: activeHubTabId,
        workspaceId: selectedWorkspaceId,
        artifactId: artifact._id,
      },
      historyMode,
    );
    if (artifact.blueprintKey === "thread_reference")
      requestAnimationFrame(() =>
        acknowledgeViewportReady({
          targetId: artifact._id,
          view: "artifact",
        }),
      );
  }

  useEffect(() => {
    if (!pendingArtifactOpen) return;
    const { artifact, historyMode, mode, preserveFollow } = pendingArtifactOpen;
    setHydratedArtifacts((current) => ({ ...current, [artifact._id]: artifact }));
    cancelArtifactOpen();
    if (mode === "tab") openResolvedArtifactTab(artifact, historyMode);
    else openResolvedArtifactPanel(artifact, historyMode, preserveFollow);
  // The pending request carries its own fresh body, never a cached list row.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingArtifactOpen, cancelArtifactOpen]);

  function openArtifactTab(artifact: SpectraArtifact) {
    void requestArtifactOpen(artifact._id, "push", "tab")
      .catch(() => toast.error("That work could not be opened."));
  }

  function openResolvedArtifactTab(artifact: SpectraArtifact, historyMode: "push" | "replace" | "none") {
    openedDeepLinkRef.current = artifact._id;
    studio.openTab(artifact);
    if (historyMode !== "none") pushShellNav({
      kind: "artifact-tab",
      hubTabId: null,
      workspaceId: selectedWorkspaceId,
      artifactId: artifact._id,
    }, historyMode);
  }

  function activateArtifactTab(artifactId: string) {
    cancelArtifactOpen();
    openedDeepLinkRef.current = artifactId;
    studio.activateTab(artifactId);
    pushShellNav({
      kind: "artifact-tab",
      hubTabId: null,
      workspaceId: selectedWorkspaceId,
      artifactId,
    });
  }

  function closeActiveStudio() {
    cancelArtifactOpen();
    openedDeepLinkRef.current = null;
    studio.closeStudio();
    setSelection(null);
    replaceWorkspaceLocation(selectedWorkspaceId);
  }

  function toggleContinuedThread(
    threadId: string,
    title: string,
    runId?: string,
  ) {
    setComposerThread((current) =>
      current?.id === threadId ? null : { id: threadId, title, runId },
    );
  }

  function startFreshComposerThread() {
    setComposerThread(null);
  }

  function writeShellLocation(
    { nodeId: folder, ...location }: { workspaceId?: string; artifactId?: string; nodeId?: string | null },
    mode: "push" | "replace",
  ) {
    // A folder belongs to the place it is in; moving to another drops it.
    const nodeId =
      folder !== undefined
        ? (folder ?? undefined)
        : location.workspaceId === requestedWorkspaceId
          ? (new URLSearchParams(window.location.search).get("nodeId") ?? undefined)
          : undefined;
    const href = spectraShellHref({ surface, nodeId, ...location });
    const current = `${window.location.pathname}${window.location.search}`;
    if (href === current) return;
    // Next integrates native History API writes with usePathname/useSearchParams,
    // so this keeps the long-lived workbench mounted and makes Back meaningful.
    window.history[`${mode}State`](null, "", href);
  }

  function replaceWorkspaceLocation(workspaceId?: string, artifactId?: string) {
    writeShellLocation({ workspaceId, artifactId }, "replace");
  }

  function pushShellNav(
    entry: ShellNavEntry,
    historyMode: "push" | "replace" | "none" = "push",
  ) {
    if (restoringNavRef.current) return;
    const stack = navStackRef.current.slice(0, Math.max(0, navCursor + 1));
    const last = stack[stack.length - 1];
    if (
      last &&
      last.kind === entry.kind &&
      last.hubTabId === entry.hubTabId &&
      last.workspaceId === entry.workspaceId &&
      last.artifactId === entry.artifactId &&
      (entry.nodeId === undefined || (last.nodeId ?? null) === entry.nodeId)
    ) {
      if (historyMode !== "none")
        writeShellLocation(
          { workspaceId: entry.workspaceId, artifactId: entry.artifactId, nodeId: entry.nodeId },
          historyMode,
        );
      return;
    }
    stack.push(entry);
    navStackRef.current = stack.slice(-100);
    setNavCursor(navStackRef.current.length - 1);
    if (historyMode !== "none")
      writeShellLocation(
        { workspaceId: entry.workspaceId, artifactId: entry.artifactId, nodeId: entry.nodeId },
        historyMode,
      );
  }

  /**
   * A folder move inside the open hub is a step of its own. The step it
   * leaves learns which folder it was showing, so Back returns there.
   */
  function pushFolderNav(nodeId: string | null, from: string | null | undefined) {
    if (restoringNavRef.current) return;
    const current = navStackRef.current[navCursor];
    if (current?.kind === "hub" && current.nodeId === undefined && from !== undefined)
      navStackRef.current[navCursor] = { ...current, nodeId: from };
    pushShellNav(
      { kind: "hub", hubTabId: activeHubTabId, workspaceId: selectedWorkspaceId, nodeId },
      "none",
    );
  }

  function applyShellNav(entry: ShellNavEntry) {
    const folder = entry.kind === "hub" ? entry.nodeId : undefined;
    if (folder !== undefined) setCurrentLibraryNodeId(folder);
    cancelArtifactOpen();
    restoringNavRef.current = true;
    try {
      if (
        (entry.kind === "artifact-split" || entry.kind === "artifact-tab") &&
        entry.artifactId
      ) {
        openedDeepLinkRef.current = entry.artifactId;
        if (entry.hubTabId) setActiveHubTabId(entry.hubTabId);
        if (entry.workspaceId) {
          setSelectedWorkspaceId(entry.workspaceId);
          void loadWorkspace(entry.workspaceId);
        }
        replaceWorkspaceLocation(entry.workspaceId, entry.artifactId);
        void requestArtifactOpen(entry.artifactId, "none", entry.kind === "artifact-tab" ? "tab" : "split")
          .catch(() => toast.error("That work could not be opened."));
        return;
      }
      studio.closeStudio();
      setSelection(null);
      if (entry.hubTabId && hubTabs.some((tab) => tab.id === entry.hubTabId)) {
        const tab = hubTabs.find((item) => item.id === entry.hubTabId);
        if (!tab) return;
        // A place tab may have walked on since (into a workspace, or back out); the step names where it stood.
        const workspaceId = tab.workSet ? tab.workspaceId : entry.workspaceId;
        if (workspaceId !== tab.workspaceId) retargetHubTab(tab.id, workspaceId);
        setActiveHubTabId(tab.id);
        writeShellLocation({ workspaceId, nodeId: folder }, "replace");
        if (workspaceId) {
          setSelectedWorkspaceId(workspaceId);
          void loadWorkspace(workspaceId);
        } else {
          setSelectedWorkspaceId(undefined);
        }
        return;
      }
      if (entry.workspaceId) {
        setActiveHubDestination(
          workspaces.find((item) => item._id === entry.workspaceId)?.title ??
            "Workspace",
          entry.workspaceId,
        );
        setSelectedWorkspaceId(entry.workspaceId);
        void loadWorkspace(entry.workspaceId);
        return;
      }
      setActiveHubDestination(LIBRARY_TAB_LABEL);
      setSelectedWorkspaceId(undefined);
    } finally {
      requestAnimationFrame(() => {
        restoringNavRef.current = false;
      });
    }
  }

  function navigateShellBack() {
    if (navCursor <= 0) return;
    const nextIndex = navCursor - 1;
    const entry = navStackRef.current[nextIndex];
    if (!entry) return;
    setNavCursor(nextIndex);
    applyShellNav(entry);
  }

  function navigateShellForward() {
    if (navCursor < 0 || navCursor >= navStackRef.current.length - 1) return;
    const nextIndex = navCursor + 1;
    const entry = navStackRef.current[nextIndex];
    if (!entry) return;
    setNavCursor(nextIndex);
    applyShellNav(entry);
  }

  function setActiveHubDestination(label: string, workspaceId?: string) {
    cancelArtifactOpen();
    studio.closeStudio();
    leaveWorkSet();
    // A work set's tab stays the work set; going somewhere from it opens that place in a tab of its own.
    if (activeHubTabId && !activeWorkSetTab && hubTabs.some((tab) => tab.id === activeHubTabId)) {
      setHubTabs((current) =>
        current.map((tab) =>
          tab.id === activeHubTabId ? { ...tab, label, workspaceId } : tab,
        ),
      );
      pushShellNav({
        kind: "hub",
        hubTabId: activeHubTabId,
        workspaceId,
      });
      return;
    }
    const next = workspaceHubTab(label, workspaceId);
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    pushShellNav({
      kind: "hub",
      hubTabId: next.id,
      workspaceId,
    });
  }

  /** Point a place tab at a workspace, or at the Library's top with none. */
  function retargetHubTab(tabId: string, workspaceId: string | undefined) {
    const label = workspaceId ? (workspaces.find((item) => item._id === workspaceId)?.title ?? "Workspace") : LIBRARY_TAB_LABEL;
    setHubTabs((tabs) => tabs.map((tab) => (tab.id === tabId ? { ...tab, label, workspaceId } : tab)));
  }

  /**
   * Step into a workspace, optionally at a folder inside it. A workspace is a
   * place in the Library: one already open in a tab is switched to, otherwise
   * it opens in the place tab being looked at, the way a folder does.
   */
  function goToWorkspaceHub(workspaceId: string, nodeId?: string) {
    cancelArtifactOpen();
    const current = hubTabs.find((tab) => tab.id === activeHubTabId && !tab.workSet);
    const open = hubTabs.find((tab) => tab.workspaceId === workspaceId);
    const tabId = open?.id ?? current?.id;
    if (!tabId) {
      const created = workspaceHubTab(workspaces.find((item) => item._id === workspaceId)?.title ?? "Workspace", workspaceId);
      setHubTabs((tabs) => [...tabs, created]);
      return enterPlace(created.id, workspaceId, nodeId);
    }
    if (!open) retargetHubTab(tabId, workspaceId);
    enterPlace(tabId, workspaceId, nodeId);
  }

  /** Step out of any workspace to the top of the Library, or to a folder outside every workspace. */
  function goToLibraryTop(nodeId?: string) {
    cancelArtifactOpen();
    const current = hubTabs.find((tab) => tab.id === activeHubTabId && !tab.workSet);
    const tabId = current?.id ?? hubTabs.find((tab) => !tab.workspaceId && !tab.workSet)?.id;
    if (!tabId) return goToHomeHub();
    retargetHubTab(tabId, undefined);
    enterPlace(tabId, undefined, nodeId);
  }

  function enterPlace(tabId: string, workspaceId: string | undefined, nodeId?: string) {
    leaveWorkSet();
    setActiveHubTabId(tabId);
    studio.closeStudio();
    setSelection(null);
    setSelectedWorkspaceId(workspaceId);
    if (workspaceId) void loadWorkspace(workspaceId);
    if (nodeId !== undefined) setCurrentLibraryNodeId(nodeId);
    pushShellNav({ kind: "hub", hubTabId: tabId, workspaceId, nodeId: nodeId ?? null });
  }

  function goToHomeHub() {
    cancelArtifactOpen();
    const home = hubTabs.find((tab) => !tab.workspaceId && !tab.workSet) ?? workspaceHubTab();
    if (!hubTabs.some((tab) => tab.id === home.id))
      setHubTabs((current) => [...current, home]);
    leaveWorkSet();
    setActiveHubTabId(home.id);
    studio.closeStudio();
    setSelection(null);
    setSelectedWorkspaceId(undefined);
    pushShellNav({ kind: "hub", hubTabId: home.id });
  }

  function activateHubTab(tabId: string) {
    cancelArtifactOpen();
    const tab = hubTabs.find((item) => item.id === tabId);
    if (!tab) return;
    if (tab.workSet) {
      if (tab.id !== activeHubTabId) setTileObjects(tab.workSet);
      setWorkSetIsolated(true);
    } else leaveWorkSet();
    setActiveHubTabId(tabId);
    // A work opened full from the side panel goes back beside the page.
    const beside = studio.returnToSide();
    if (!beside) studio.closeStudio();
    setSelection(null);
    if (tab.workspaceId) void loadWorkspace(tab.workspaceId);
    else {
      setSelectedWorkspaceId(undefined);
    }
    if (beside) openedDeepLinkRef.current = beside;
    pushShellNav({
      kind: beside ? "artifact-split" : "hub",
      hubTabId: tabId,
      workspaceId: tab.workspaceId,
      artifactId: beside ?? undefined,
    });
  }

  function addHomeHubTab() {
    cancelArtifactOpen();
    leaveWorkSet();
    // The Library is one tab: asking for a new one opens the one there is.
    const home = hubTabs.find((tab) => !tab.workspaceId && !tab.workSet);
    const next = home ?? workspaceHubTab();
    if (!home) setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    studio.closeStudio();
    setSelection(null);
    setSelectedWorkspaceId(undefined);
    pushShellNav({
      kind: "hub",
      hubTabId: next.id,
    });
  }

  function closeHubTab(tabId: string) {
    const closingIndex = hubTabs.findIndex((tab) => tab.id === tabId);
    const remaining = hubTabs.filter((tab) => tab.id !== tabId);
    setHubTabs(remaining);
    if (activeHubTabId !== tabId) return;
    const fallbackHub =
      remaining[
        Math.min(closingIndex > 0 ? closingIndex - 1 : 0, remaining.length - 1)
      ];
    if (fallbackHub) {
      activateHubTab(fallbackHub.id);
      return;
    }
    const fallbackArtifact = studio.tabs[studio.tabs.length - 1];
    if (fallbackArtifact) {
      setActiveHubTabId(null);
      activateArtifactTab(fallbackArtifact.artifactId);
      return;
    }
    const replacement = workspaceHubTab();
    setHubTabs([replacement]);
    setActiveHubTabId(replacement.id);
    studio.closeStudio();
    setSelectedWorkspaceId(undefined);
    replaceWorkspaceLocation();
    void loadOverview();
  }

  function closeArtifactTab(artifactId: string) {
    cancelArtifactOpen();
    const closesFinalArtifact = studio.tabs.length === 1;
    const fallbackArtifactId =
      studio.activeArtifactId === artifactId
        ? studio.tabs.filter((tab) => tab.artifactId !== artifactId).at(-1)
            ?.artifactId
        : (studio.activeArtifactId ?? undefined);
    studio.closeTab(artifactId);
    replaceWorkspaceLocation(selectedWorkspaceId, fallbackArtifactId);
    if (closesFinalArtifact && hubTabs.length === 0) {
      const replacement = workspaceHubTab();
      setHubTabs([replacement]);
      setActiveHubTabId(replacement.id);
      setSelectedWorkspaceId(undefined);
      void loadOverview();
    }
  }

  function returnToHub() {
    const target =
      hubTabs.find((tab) => tab.id === activeHubTabId) ??
      hubTabs[hubTabs.length - 1];
    if (target) activateHubTab(target.id);
    else addHomeHubTab();
  }

  async function respondToShareInvitation(
    invitationId: string,
    response: "accept" | "decline",
  ) {
    setBusyKey(`invitation:${invitationId}`);
    try {
      await postSpectra({
        action:
          response === "accept"
            ? "acceptShareInvitation"
            : "declineShareInvitation",
        invitationId,
      });
      spectraBus.emit("notifications.changed", {});
      toast.success(
        response === "accept"
          ? "Shared work added to your Library."
          : "Invitation declined.",
      );
      await Promise.all([
        refreshInvitations(),
        loadOverview(selectedWorkspaceId, true),
      ]);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not update the invitation." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  /**
   * Bring a file into the Library, keeping the original bytes.
   *
   * Ordinary files (PDFs, images, unknown types) land as resource citizens
   * (CANON D29) with a cloud payload — not hollow Document JSON. Native work
   * types still project into editable studios, and the import always preserves
   * the uploaded bytes before anything is parsed out of them.
   */
  async function importLibraryFile(
    file: File,
    parentNodeId?: string | null,
  ) {
    const classification = classifyLibraryImport(file);
    let importJobId: string | null = null;
    let pendingOfficeArtifactId: string | null = null;
    setBusyKey("library:import");
    // Dots gather and breathe while the file comes in; the work grows out of them.
    const creation = beginCreation();
    try {
      const titleHint = file.name.replace(/\.[^.]+$/, "") || "Untitled file";
      /* Same parent New uses: only place under a folder when the organizer
         (or another caller) names one. Explicit null means Library/workspace
         root — do not revive a stale currentLibraryNodeId. */
      const placementParentId =
        typeof parentNodeId === "string" && parentNodeId.trim()
          ? parentNodeId.trim()
          : undefined;
      // CANON D29: ordinary files land as Library resource citizens with bytes.
      if (classification.kind === "resource") {
        const imported = await importLibraryResourceFile(file, {
          workspaceId: selectedWorkspaceId || undefined,
          parentNodeId: placementParentId,
          title: titleHint,
        });
        const refreshed = await loadOverview(selectedWorkspaceId, true);
        const resource = refreshed?.artifacts.find(
          (work) => work._id === imported.artifactId,
        );
        if (resource) {
          creation.land();
          openArtifactPanel(resource);
        }
        toast.success(
          selectedWorkspaceId
            ? `${titleHint} imported as a file in this workspace.`
            : `${titleHint} imported as a Library file.`,
        );
        return;
      }
      const originalBuffer = await file.arrayBuffer();
      const portable =
        classification.kind === "portable"
          ? await openSpectraPackage(new Uint8Array(originalBuffer))
          : null;
      const blueprintKey: ArtifactTypeKey = portable
        ? portable.manifest.artifactType
        : classification.blueprintKey ?? "document";
      const fallback = createDefaultArtifactPayload(blueprintKey);
      // Office lens only for OOXML natives. Text/md share the document
      // blueprint but must keep projectLibraryImportContent. Lens failures
      // must toast and abort — never hollow createArtifact fallback.
      const officeImport = !portable && isOfficeNativeImportFile(file);
      const importedContent =
        portable?.content ??
        (officeImport ? fallback.content : await projectLibraryImportContent(file, blueprintKey)) ??
        fallback.content;
      const title = titleHint || fallback.title;
      const importedNativeFormat =
        classification.nativeFormat ||
        undefined;
      const created = await postSpectra<{ artifactId: string }>({
        action: "createArtifact",
        blueprintKey,
        title,
        summary: `Imported from ${file.name}`,
        content: importedContent,
        tags: ["imported"],
        source: "manual",
        workspaceId: selectedWorkspaceId,
        ...(placementParentId ? { parentNodeId: placementParentId } : {}),
        ...(importedNativeFormat
          ? { nativeFormat: importedNativeFormat }
          : {}),
      });
      if (officeImport) pendingOfficeArtifactId = created.artifactId;
      const officeProjection = officeImport
        ? await projectOfficeImportWithLens(file, created.artifactId)
        : null;
      // Prefer the server lens projection. Re-parsing a formal paper in the
      // tab (mammoth + TipTap) after a successful office import previously
      // spiked memory into Chrome Aw Snap 9.
      const canonicalImportedContent =
        !portable &&
        blueprintKey === "document" &&
        file.name.toLowerCase().endsWith(".docx") &&
        !officeProjection
          ? await projectDocxImportWithDurableImages(file, created.artifactId)
          : officeProjection?.content ?? importedContent;
      const digest = await crypto.subtle.digest("SHA-256", originalBuffer);
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const beginning = await beginArtifactImportOriginal({
        artifactId: created.artifactId,
        typeKey: blueprintKey,
        format: classification.nativeFormat || file.type || "binary",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256,
      });
      importJobId = beginning.jobId;
      await uploadArtifactImportOriginal(beginning.jobId, file);
      const completedImport = await completeArtifactImport({
        jobId: beginning.jobId,
        typeKey: blueprintKey,
        status: "imported",
        fidelityReport: officeProjection?.fidelityReport?.length
          ? officeProjection.fidelityReport
          : [
              {
                scope: portable ? "package" : "original",
                level: "exact",
                message: portable
                  ? "Spectra restored the package content and preserved the uploaded package bytes exactly."
                  : "Original file preserved for the work editor import pipeline.",
              },
            ],
        unsupportedFeatures: officeProjection?.unsupportedFeatures ?? [],
        importedContent: canonicalImportedContent,
      });
      if (officeImport && !completedImport.versionId)
        throw new Error("The import has not been saved yet. Please retry the import.");
      pendingOfficeArtifactId = null;
      // complete already attempts commitImport. Skip/soft-fail the redundant
      // version commit so a deferred commit cannot toast false import failure
      // after createArtifact already persisted usable content.
      if (!completedImport.versionId && !completedImport.commitDeferred) {
        await postSpectra({
          action: "createArtifactImportVersion",
          artifactId: created.artifactId,
          importJobId: beginning.jobId,
        }).catch(() => undefined);
      }
      await loadOverview(selectedWorkspaceId, true);
      creation.land();
      // The overview is intentionally summary-only and does not carry the
      // document body. Hydrate the committed artifact before mounting the
      // collaborative editor, otherwise its empty/default document can be
      // checkpointed over the just-imported rich snapshot.
      await requestArtifactOpen(created.artifactId)
        .catch(() => toast.error("The import was saved, but its editor could not be opened. Open it again from Library."));
      if (completedImport.status === "awaiting_commit") {
        toast.warning(
          `${title} is available in ${selectedWorkspaceId ? "this workspace" : "your Library"}; its import history is still being saved.`,
        );
      } else {
        toast.success(
          selectedWorkspaceId
            ? `${title} imported into this workspace.`
            : `${title} imported into your Library.`,
        );
      }
    } catch (error) {
      if (pendingOfficeArtifactId)
        await postSpectra({ action: "deleteArtifact", artifactId: pendingOfficeArtifactId }).catch(() => undefined);
      if (importJobId)
        await abortArtifactImportUpload(
          importJobId,
          "Library import failed",
        ).catch(() => undefined);
      const durableFailed =
        Boolean(
          error &&
            typeof error === "object" &&
            "durableFailed" in error &&
            (error as { durableFailed?: boolean }).durableFailed,
        ) ||
        (error instanceof Error &&
          /IMPORT_SNAPSHOT_TOO_LARGE|too large to open/i.test(error.message));
      toast.error(
        durableFailed
          ? error instanceof Error
            ? error.message
            : "This Office file is too large to import into the editor without crashing the tab."
          : describeFailure(error, { fallback: "Could not import this file." })
              .message,
      );
    } finally {
      // Landed already, or nothing was made: the dots part.
      creation.cancel();
      setBusyKey(null);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function archiveArtifact(artifact: SpectraArtifact) {
    setBusyKey(`artifact:archive:${artifact._id}`);
    try {
      await postSpectra({
        action: "archiveArtifact",
        artifactId: artifact._id,
      });
      toast.success("Work archived.");
      returnToHub();
      await loadOverview(selectedWorkspaceId, true);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not archive this work. Try again." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function permanentlyDeleteArtifact(
    artifact: SpectraArtifact,
    confirmed = false,
  ) {
    if (!confirmed) {
      setArtifactDeletePending(artifact);
      return;
    }
    setBusyKey(`delete:${artifact._id}`);
    try {
      await postSpectra({ action: "deleteArtifact", artifactId: artifact._id });
      toast.success("Work permanently deleted.");
      setArtifactDeletePending(null);
      if (studio.activeArtifact?._id === artifact._id) returnToHub();
      await loadOverview(selectedWorkspaceId, true);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not delete this work. Try again." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  /**
   * Taking something out of a workspace moves it to General. Nothing is hidden
   * and nothing is deleted, so the row leaves this workspace optimistically and
   * reappears in General on the next read.
   */
  async function moveItemToGeneral(nodeId: string) {
    setBusyKey(`hide:${nodeId}`);
    const previousOverview = overview;
    setOverview((current) =>
      current?.workspace
        ? {
            ...current,
            workspace: {
              ...current.workspace,
              items: current.workspace.items.filter(
                (item) => item.nodeId !== nodeId,
              ),
            },
          }
        : current,
    );
    try {
      await postSpectra({ action: "removeFromWorkspace", nodeId });
      toast.success("Moved back to General.");
      setSelection((current) =>
        current?.type === "artifact" && current.itemId === nodeId
          ? null
          : current,
      );
      if (selectedWorkspaceId) await loadWorkspace(selectedWorkspaceId, true);
    } catch (error) {
      setOverview(previousOverview);
      toast.error(
        describeFailure(error, { fallback: "Could not move this out." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function createWorkspace() {
    const title = newWorkspaceTitle.trim();
    if (!title) return;
    setBusyKey("workspace:create");
    const creation = beginCreation();
    try {
      const result = await postSpectra<{ workspaceId: string }>({
        action: "createWorkspace",
        title,
        description: newWorkspaceDescription.trim() || undefined,
        icon: newWorkspaceIcon,
        color: newWorkspaceColor,
        parentNodeId: workspaceCreateParentNodeId ?? undefined,
      });
      toast.success("Workspace created.");
      setWorkspaceCreateOpen(false);
      setWorkspaceCreateParentNodeId(null);
      setNewWorkspaceTitle("");
      setNewWorkspaceDescription("");
      setNewWorkspaceIcon("Sparkles");
      setSelection(null);
        creation.land();
      setActiveHubDestination(title, result.workspaceId);
      await loadOverview(result.workspaceId);
    } catch (error) {
      creation.cancel();
      toast.error(
        describeFailure(error, { fallback: "Could not create workspace." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function importWorkspaceManifest(file: File) {
    if (file.size > 750_000) {
      toast.error("Workspace manifests must be 750 KB or smaller.");
      return;
    }
    setBusyKey("workspace:import");
    try {
      const bytes = await file.arrayBuffer();
      const manifest = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const result = await postSpectra<
        | { status: "quarantined"; reason: string }
        | {
            status: "imported";
            workspaceId: string;
            report: {
              placed: number;
              skipped: number;
              unsupported: string[];
              warnings: string[];
            };
          }
      >({
        action: "importWorkspaceManifest",
        fileName: file.name,
        sha256,
        manifest,
      });
      if (result.status === "quarantined") {
        toast.error(`Import quarantined: ${result.reason}`);
        return;
      }
      const detail = result.report.skipped
        ? `${result.report.placed} placed; ${result.report.skipped} you cannot open were skipped.`
        : `${result.report.placed} work${result.report.placed === 1 ? "" : "s"} placed.`;
      toast.success(`Workspace imported. ${detail}`, {
        description: [
          "Each piece links to the same work in Spectra, not a copy: edits show in both places.",
          ...result.report.warnings,
        ].join(" "),
      });
      setSelection(null);
        const refreshed = await loadOverview(result.workspaceId, true);
      const imported = refreshed?.workspaces.find(
        (item) => item._id === result.workspaceId,
      );
      setActiveHubDestination(
        imported?.title ?? "Imported workspace",
        result.workspaceId,
      );
    } catch (error) {
      toast.error(
        error instanceof SyntaxError
          ? "This file is not valid JSON and has been left unchanged."
          : describeFailure(error, {
              fallback: "Could not import this workspace.",
            }).message,
      );
    } finally {
      setBusyKey(null);
      if (workspaceImportInputRef.current)
        workspaceImportInputRef.current.value = "";
    }
  }

  async function exportWorkspaceManifest() {
    if (!workspaceHeader) return;
    setBusyKey(`workspace:export:${workspaceHeader._id}`);
    try {
      const result = await exportSpectraWorkspaceManifest(workspaceHeader._id);
      const blob = new Blob([JSON.stringify(result.manifest, null, 2)], {
        type: "application/json",
      });
      downloadDocumentBlob(
        `${
          workspaceHeader.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "workspace"
        }.spectra-workspace.json`,
        blob,
      );
      // The file is the workspace's layout: which work sits where, linked
      // back to the work in Spectra. Say so, and say what it left out.
      const notes = [
        ...result.report.warnings,
        ...result.report.unsupported.map((kind) =>
          kind === "thread"
            ? "Threads are not included."
            : kind === "link"
              ? "References to work filed elsewhere are not included."
              : `${kind} items are not included.`,
        ),
      ];
      toast.success("Workspace layout exported.", {
        description: [
          "The file lists each work and its folder, and links back to it in Spectra. It holds no copies of the work.",
          ...notes,
        ].join(" "),
      });
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not export workspace." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  function openWorkspaceEdit() {
    if (!workspaceHeader) return;
    setWorkspaceEditTitle(workspaceHeader.title);
    setWorkspaceEditDescription(workspaceHeader.description ?? "");
    setWorkspaceEditIcon(workspaceHeader.icon ?? "Sparkles");
    setWorkspaceEditColor(workspaceInk(workspaceHeader.color));
    setWorkspaceEditClass(workspaceIsClass(workspaceHeader));
    setWorkspaceEditOpen(true);
  }

  async function updateWorkspaceMetadata() {
    if (!workspaceHeader || !workspaceEditTitle.trim()) return;
    setBusyKey(`workspace:update:${workspaceHeader._id}`);
    try {
      await postSpectra({
        action: "updateWorkspace",
        workspaceId: workspaceHeader._id,
        title: workspaceEditTitle.trim(),
        description: workspaceEditDescription.trim(),
        icon: workspaceEditIcon,
        color: workspaceEditColor,
        ...(workspaceEditClass !== workspaceIsClass(workspaceHeader) ? { isClass: workspaceEditClass } : {}),
      });
      setWorkspaceEditOpen(false);
      await loadOverview(workspaceHeader._id, true);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not update workspace." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function permanentlyDeleteWorkspace() {
    if (!selectedWorkspaceId || !workspace) return;
    const deletedWorkspaceId = selectedWorkspaceId;
    const expected = `Remove ${workspace.title} permanently`;
    if (workspaceDeleteConfirmation !== expected) return;
    setBusyKey(`workspace:delete:${selectedWorkspaceId}`);
    try {
      await postSpectra({
        action: "deleteWorkspace",
        workspaceId: selectedWorkspaceId,
        confirmation: workspaceDeleteConfirmation,
      });
      toast.message(
        "Workspace deletion started. Its contents are moving to General.",
      );
      setWorkspaceDeleteOpen(false);
      setWorkspaceDeleteConfirmation("");
      setSelection(null);
        setActiveHubDestination(LIBRARY_TAB_LABEL);
      // Its tabs close and the address leaves it, so a reload never lands on a workspace that is gone.
      const next = hubTabsWithoutWorkspace(hubTabs, activeHubTabId, deletedWorkspaceId, () => workspaceHubTab());
      setHubTabs(next.tabs);
      setActiveHubTabId(next.activeId);
      setSelectedWorkspaceId(undefined);
      replaceWorkspaceLocation();
      await loadOverview(undefined, true);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not delete workspace." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  const surfaceLoading =
    (overviewLoadState.status === "loading" &&
      (!overview || requestedWorkspaceId !== selectedWorkspaceId)) ||
    Boolean(selectedWorkspaceId && workspaceLoading && !workspace);
  const surfaceFailure =
    overviewLoadState.status === "error" ? overviewLoadState : null;
  const needsSchool = overview?.needsSchool === true;

  // The island is this page's composer: it writes into the thread in focus,
  // and threads open here, in the thread panel, instead of the Side.
  const islandHandlers = useRef({
    startNew: startFreshComposerThread,
    open: (threadId: string, title: string) => {
      setActiveRunPanelId(null);
      setLiveThread({ id: threadId, title });
    },
  });
  islandHandlers.current = {
    startNew: startFreshComposerThread,
    open: (threadId, title) => {
      setActiveRunPanelId(null);
      setLiveThread({ id: threadId, title });
    },
  };
  // It writes into the thread the panel shows, so what it replies to is always in sight; elsewhere it starts one
  // (its rail picks any other).
  const islandFocusId = liveThread?.id ?? null;
  const islandFocusTitle = liveThread?.title ?? "";
  useProvideIslandEngine(
    useMemo(
      () => ({
        engine: runEngine,
        focus: islandFocusId
          ? { threadId: islandFocusId, title: islandFocusTitle }
          : null,
        startNewThread: () => islandHandlers.current.startNew(),
        openThread: (_runId: string, threadId: string, title: string) =>
          islandHandlers.current.open(threadId, title),
      }),
      [islandFocusId, islandFocusTitle, runEngine],
    ),
  );

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0">
      {/* The command bar's "Import a file" lands at the top of the Library. */}
      <input
        ref={importInputRef}
        type="file"
        accept={LIBRARY_IMPORT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importLibraryFile(file);
        }}
      />
      <input
        ref={workspaceImportInputRef}
        type="file"
        accept=".spectra-workspace.json,.json,application/json"
        className="sr-only"
        aria-label="Import a Spectra workspace file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importWorkspaceManifest(file);
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <StudioTabRail
          hubTabs={
            workSetIsolated && activeHubTabId && !activeWorkSetTab
              ? hubTabs.map((tab) =>
                  tab.id === activeHubTabId
                    ? { ...tab, label: workSetLabel(tiledArtifacts.map((artifact) => artifact.title)) }
                    : tab,
                )
              : hubTabs
          }
          activeHubTabId={studio.mode === "tab" ? null : activeHubTabId}
          artifacts={allArtifacts}
          tabs={studio.tabs}
          activeArtifactId={
            studio.mode === "tab" ? studio.activeArtifactId : null
          }
          dirtyIds={studio.dirtyIds}
          onActivateHub={activateHubTab}
          onCloseHub={closeHubTab}
          onAddHub={addHomeHubTab}
          onActivateTab={activateArtifactTab}
          onCloseTab={closeArtifactTab}
          canGoBack={navCursor > 0}
          canGoForward={
            navCursor >= 0 && navCursor < navStackRef.current.length - 1
          }
          onGoBack={navigateShellBack}
          onGoForward={navigateShellForward}
          persistent
        />
        <div className="spectra-workbench-frame relative flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspaceDeleteDialog
            open={workspaceDeleteOpen && !!workspace}
            workspaceTitle={workspace?.title ?? ""}
            confirmation={workspaceDeleteConfirmation}
            onConfirmationChange={setWorkspaceDeleteConfirmation}
            busy={busyKey === `workspace:delete:${selectedWorkspaceId}`}
            onCancel={() => setWorkspaceDeleteOpen(false)}
            onConfirm={() => void permanentlyDeleteWorkspace()}
          />
          {workspaceShareOpen && workspaceHeader ? (
            <ShareDialog
              open
              resourceType="workspace"
              resourceId={workspaceHeader._id}
              title={workspaceHeader.title}
              onClose={() => setWorkspaceShareOpen(false)}
              onChanged={async () => {
                await loadOverview(workspaceHeader._id, true);
              }}
            />
          ) : null}
          {artifactShareTarget ? (
            <ShareDialog
              open
              resourceType={
                artifactShareTarget.blueprintKey === "agent"
                  ? "agent"
                  : "artifact"
              }
              resourceId={artifactShareTarget._id}
              title={artifactShareTarget.title}
              onClose={() => setArtifactShareTarget(null)}
              onChanged={async () => {
                await loadOverview(selectedWorkspaceId, true);
              }}
              beforeShare={artifactShareTarget.storageHome === "device" ? moveShareTargetOnline : undefined}
            />
          ) : null}
          <WorkspaceEditDialog
            open={workspaceEditOpen && !!workspaceHeader}
            icon={workspaceEditIcon}
            onIconChange={setWorkspaceEditIcon}
            color={workspaceEditColor}
            onColorChange={setWorkspaceEditColor}
            title={workspaceEditTitle}
            onTitleChange={setWorkspaceEditTitle}
            description={workspaceEditDescription}
            onDescriptionChange={setWorkspaceEditDescription}
            isClass={workspaceEditClass}
            onIsClassChange={setWorkspaceEditClass}
            busy={busyKey === `workspace:update:${workspaceHeader?._id}`}
            onCancel={() => setWorkspaceEditOpen(false)}
            onSave={() => void updateWorkspaceMetadata()}
          />
          <ArtifactDeleteDialog
            open={artifactDeletePending !== null}
            artifactTitle={artifactDeletePending?.title ?? ""}
            busy={busyKey === `delete:${artifactDeletePending?._id}`}
            onCancel={() => setArtifactDeletePending(null)}
            onConfirm={() => {
              if (!artifactDeletePending) return;
              void permanentlyDeleteArtifact(artifactDeletePending, true);
            }}
          />
          {workspaceCreateOpen ? (
            <div
              ref={workspaceCreateRef}
              className="absolute left-3 top-5 z-dropdown w-[min(330px,calc(100vw-24px))] rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]"
            >
              <div className="mb-3">
                <div className="text-heading font-semibold text-[var(--text-primary)]">
                  New workspace
                </div>
                <div className="mt-1 text-caption text-[var(--text-secondary)]">
                  Create a subject space that stays connected to related work.
                </div>
              </div>
              <Input
                aria-label="Workspace name"
                value={newWorkspaceTitle}
                onChange={(event) => setNewWorkspaceTitle(event.target.value)}
                placeholder="Subject or project name"
              />
              <Textarea
                aria-label="Workspace description"
                value={newWorkspaceDescription}
                onChange={(event) =>
                  setNewWorkspaceDescription(event.target.value)
                }
                placeholder="Short description"
                className="mt-2 min-h-[70px] resize-none placeholder:text-[var(--text-tertiary)]"
              />
              <div className="mt-3">
                <div className="mb-2 text-micro font-semibold text-[var(--text-tertiary)]">
                  Icon
                </div>
                <div
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-label="Workspace icon"
                >
                  {workspaceIconChoices.map(([key, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={newWorkspaceIcon === key}
                      onClick={() => setNewWorkspaceIcon(key)}
                      className={`flex h-9 w-9 items-center justify-center rounded-control border outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] ${newWorkspaceIcon === key ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))] text-[var(--accent-cyan)]" : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)]"}`}
                      aria-label={key}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <WorkspaceColorPicker value={newWorkspaceColor} onChange={setNewWorkspaceColor} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setWorkspaceCreateOpen(false);
                    setWorkspaceCreateParentNodeId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    !newWorkspaceTitle.trim() || busyKey === "workspace:create"
                  }
                  onClick={() => void createWorkspace()}
                >
                  {busyKey === "workspace:create" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create
                </Button>
              </div>
            </div>
          ) : null}
          <div
            ref={workbenchRowRef}
            data-split-host
            className="relative flex min-h-0 min-w-0 flex-1"
          >
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {workSetIsolated && tiledArtifacts.length > 0 ? (
                <ArtifactTileSurface
                  isolated
                  artifacts={tiledArtifacts}
                  allArtifacts={allArtifacts}
                  dirtyIds={studio.dirtyIds}
                  busyArtifactId={
                    busyKey?.startsWith("artifact:update:")
                      ? busyKey.replace("artifact:update:", "")
                      : null
                  }
                  sourceLabel={workspace?.title ?? surfaceLabel}
                  continuedThreadId={composerThread?.id}
                  onCloseArtifact={closeTileArtifact}
                  onCloseAll={closeTileSet}
                  onAddArtifact={addArtifactTile}
                  onFocusSet={() => setWorkSetIsolated(true)}
                  onArchive={archiveArtifact}
                  onDirtyChange={studio.setDirty}
                  onContinueThread={(threadId, title) =>
                    toggleContinuedThread(threadId, title)
                  }
                  onOpenThread={setLiveThread}
                  executeApplicationCommand={applicationCommandDispatcher}
                />
              ) : studio.mode === "tab" && studio.activeArtifact ? (
                <div className="relative flex min-h-0 min-w-0 flex-1">
                <ArtifactStudio
                  key={studio.activeArtifact._id}
                  mode="tab"
                  artifact={studio.activeArtifact}
                  artifacts={allArtifacts}
                  tabs={studio.tabs}
                  dirtyIds={studio.dirtyIds}
                  busy={
                    busyKey === `artifact:update:${studio.activeArtifact._id}`
                  }
                  sourceLabel={workspace?.title ?? surfaceLabel}
                  onClose={returnToHub}
                  onExpand={openArtifactTab}
                  onActivateTab={activateArtifactTab}
                  onCloseTab={closeArtifactTab}
                  onArchive={archiveArtifact}
                  onShare={
                    studio.activeArtifact.ownership !== "shared"
                      ? (artifact) => setArtifactShareTarget(artifact)
                      : undefined
                  }
                  onDirtyChange={studio.setDirty}
                  onOpenThread={setLiveThread}
                  executeApplicationCommand={applicationCommandDispatcher}
                  compact={false}
                />
                </div>
              ) : (
                <section
                  data-split-host
                  className="relative flex min-h-0 min-w-0 flex-1"
                >
                  <>
                    <div className="relative flex min-w-0 flex-1 flex-col">
                      {shareInvitations.length > 0 ? (
                        <InvitationStrip
                          invitations={shareInvitations}
                          open={invitationsOpen}
                          busyKey={busyKey}
                          onToggle={() => setInvitationsOpen((open) => !open)}
                          onRespond={(invitationId, response) =>
                            void respondToShareInvitation(
                              invitationId,
                              response,
                            )
                          }
                        />
                      ) : null}
                      {/* The Library's own header needs nothing loaded, so only a workspace's waits. */}
                      {surfaceLoading && (requestedWorkspaceId || surface !== "library") ? (
                        <WorkspaceHeaderSkeleton />
                      ) : needsSchool || surfaceFailure ? null : workspace ? (
                        <WorkspaceHeader
                          workspace={workspaceHeader}
                          items={entries.map((entry) => entry.item)}
                          runs={workspaceRuns}
                          optimisticActive={Boolean(
                            runEngine.liveExchange &&
                            runEngine.liveExchange.status !== "failed" &&
                            runEngine.liveExchange.status !== "stopped",
                          )}
                          optimisticRunId={runEngine.liveExchange?.runId}
                          onEditWorkspace={openWorkspaceEdit}
                          onShareWorkspace={() => setWorkspaceShareOpen(true)}
                          onExportWorkspace={() =>
                            void exportWorkspaceManifest()
                          }
                          onDeleteWorkspace={() => {
                            setWorkspaceDeleteConfirmation("");
                            setWorkspaceDeleteOpen(true);
                          }}
                          onOpenChats={() =>
                            spectraBus.emit("threads.open", {
                              scope: workspaceHeader?._id ? { workspaceId: workspaceHeader._id, title: workspaceHeader.title } : undefined,
                            })
                          }
                        />
                      ) : (
                        <LibraryHeader
                          surface={surface}
                          folderId={currentLibraryNodeId}
                          workspaceCount={workspaces.length}
                          onOpenChats={() => spectraBus.emit("threads.open", {})}
                        />
                      )}
                      {needsSchool ? (
                        <NeedsSchoolEmpty />
                      ) : surfaceFailure ? (
                        <OverviewLoadFailure
                          message={surfaceFailure.message}
                          onRetry={() =>
                            void loadOverview(requestedWorkspaceId)
                          }
                        />
                      ) : surfaceLoading || !scopeReady ? (
                        <main className="spectra-workspace-content relative isolate z-chrome flex min-h-0 flex-1 flex-col overflow-hidden">
                          <WorkspaceContentSkeleton shelf={surface === "library" && !requestedWorkspaceId && !currentLibraryNodeId} />
                        </main>
                      ) : (
                        /* One surface. The Library scoped to whatever is open owns
                       the location, the search, the filter, the create menu and
                       the rail (CANON D41). */
                        <main className="spectra-workspace-content relative isolate z-chrome flex min-h-0 flex-1 flex-col overflow-hidden">
                          <LibraryOrganizer
                            key={scopeNodeId ?? "root"}
                            scope={
                              scopeNodeId && workspace
                                ? {
                                    nodeId: scopeNodeId,
                                    label: workspace.title,
                                  }
                                : null
                            }
                            firstRun={firstRun}
                            initialNodeId={requestedNodeId ?? scopeNodeId}
                            selectionMode={multiSelectMode}
                            selectedObjectKeys={selectedObjectKeys}
                            activeWorkId={studio.activeArtifact?._id}
                            busy={Boolean(busyKey?.startsWith("artifact:"))}
                            importing={busyKey === "library:import"}
                            onImportFile={(file, parentNodeId) =>
                              void importLibraryFile(file, parentNodeId)
                            }
                            onNewWorkspace={(parentNodeId) => {
                              setWorkspaceCreateParentNodeId(parentNodeId);
                              setWorkspaceCreateOpen(true);
                            }}
                            selecting={multiSelectMode}
                            onToggleSelect={() => setMultiSelectMode((value) => !value)}
                            contextIds={selectedContextIds}
                            onOpenWork={openArtifactById}
                            folderId={currentLibraryNodeId}
                            onLocationChange={(nodeId, from) => {
                              pushFolderNav(nodeId, from);
                              setCurrentLibraryNodeId(nodeId);
                              rememberLibraryFolder(nodeId);
                            }}
                            onOpenWorkspace={goToWorkspaceHub}
                            onLeaveScope={goToLibraryTop}
                            onOpenThread={(threadId, title) =>
                              setLiveThread({ id: threadId, title })
                            }
                            onShareWork={(artifactId) => {
                              const found = allArtifacts.find(
                                (item) => item._id === artifactId,
                              );
                              if (found) setArtifactShareTarget(found);
                            }}
                            onToggleContext={toggleContextArtifact}
                            onSelectWork={(ids) => {
                              setMultiSelectMode(true);
                              setSelectedContextIds(new Set(ids));
                            }}
                          />
                        </main>
                      )}
                    </div>
                    {!studio.isOpen &&
                    !liveThread &&
                    tiledArtifacts.length === 0 ? (
                      <Inspector
                        artifacts={allArtifacts}
                        selectedArtifact={selectedArtifact}
                        selectedRun={selectedRun}
                        onClose={() => setSelection(null)}
                        onHide={() => {
                          if (selection?.type === "artifact")
                            void moveItemToGeneral(selection.itemId);
                        }}
                        onOpenArtifact={openArtifactPanel}
                      />
                    ) : null}
                    {studio.mode === "split" && studio.activeArtifact ? (
                      <ArtifactStudio
                        key={studio.activeArtifact._id}
                        mode="split"
                        artifact={studio.activeArtifact}
                        artifacts={allArtifacts}
                        tabs={studio.tabs}
                        dirtyIds={studio.dirtyIds}
                        busy={
                          busyKey ===
                          `artifact:update:${studio.activeArtifact._id}`
                        }
                        panelWidth={paneWidths.studio ?? studioPanelWidth}
                        panelOverlay={paneOverlay.studio ?? false}
                        sourceLabel={workspace?.title ?? surfaceLabel}
                        onPanelWidthChange={(next) =>
                          notePaneIntent("studio", Math.max(0, next - studioPaneRoom))
                        }
                        onPaneRoomChange={setStudioPaneRoom}
                        onClose={closeActiveStudio}
                        onExpand={openArtifactTab}
                        onActivateTab={activateArtifactTab}
                        onCloseTab={closeArtifactTab}
                        onArchive={archiveArtifact}
                        onShare={
                          studio.activeArtifact.ownership !== "shared"
                            ? (artifact) => setArtifactShareTarget(artifact)
                            : undefined
                        }
                        onDirtyChange={studio.setDirty}
                        onOpenThread={setLiveThread}
                        executeApplicationCommand={applicationCommandDispatcher}
                        compact={false}
                      />
                    ) : null}
                    {!workSetIsolated && tiledArtifacts.length > 0 ? (
                      <ArtifactTileSurface
                        artifacts={tiledArtifacts}
                        allArtifacts={allArtifacts}
                        dirtyIds={studio.dirtyIds}
                        busyArtifactId={
                          busyKey?.startsWith("artifact:update:")
                            ? busyKey.replace("artifact:update:", "")
                            : null
                        }
                        sourceLabel={workspace?.title ?? surfaceLabel}
                        continuedThreadId={composerThread?.id}
                        onCloseArtifact={closeTileArtifact}
                        onCloseAll={closeTileSet}
                        onAddArtifact={addArtifactTile}
                        onFocusSet={() => setWorkSetIsolated(true)}
                        onArchive={archiveArtifact}
                        onDirtyChange={studio.setDirty}
                        onContinueThread={(threadId, title) =>
                          toggleContinuedThread(threadId, title)
                        }
                        executeApplicationCommand={applicationCommandDispatcher}
                      />
                    ) : null}
                  </>
                </section>
              )}
            </div>
            {multiSelectMode ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-[var(--spectra-composer-safe-area,84px)] z-composer-dock flex justify-center px-4">
                <div className="pointer-events-auto">
                  <SelectionActionBar
                    count={selectionCount}
                    onClear={clearSelection}
                    onExit={() => {
                      clearSelection();
                      setMultiSelectMode(false);
                    }}
                    onTile={
                      selectedContextIds.size
                        ? openSelectedArtifactsInTiles
                        : undefined
                    }
                    onAsk={selectedContextIds.size ? askAboutSelection : undefined}
                    onShare={selectedContextIds.size ? shareSelection : undefined}
                  />
                </div>
              </div>
            ) : null}
            {liveThread ? (
              <LiveThreadPanel
                threadId={liveThread.id}
                title={liveThread.title}
                overlay={paneOverlay.thread ?? false}
                liveExchange={
                  runEngine.liveExchange &&
                  runEngine.liveExchange.threadId === liveThread.id
                    ? runEngine.liveExchange
                    : null
                }
                width={paneWidths.thread ?? liveThreadPanelWidth}
                onWidthChange={(next) => notePaneIntent("thread", next)}
                onClose={() => setLiveThread(null)}
                onOpenArtifact={(artifactId) => {
                  const artifact = allArtifacts.find(
                    (item) => item._id === artifactId,
                  );
                  if (artifact) openArtifactPanel(artifact);
                }}
                onOpenWorkspace={goToWorkspaceHub}
              />
            ) : null}
            {chatBrowserOpen ? (
              <ChatBrowserPanel
                scope={chatBrowserScope}
                workspaceId={selectedWorkspaceId}
                artifactId={chatBrowserArtifactId}
                width={paneWidths["chat-browser"] ?? chatBrowserWidth}
                onWidthChange={(next) => notePaneIntent("chat-browser", next)}
                overlay={paneOverlay["chat-browser"] ?? false}
                title={chatBrowserScope === "artifact" ? "Threads about this work" : chatBrowserScope === "workspace" ? "Workspace threads" : "All threads"}
                onClose={() => setChatBrowserOpen(false)}
                onOpenChat={(thread) => {
                  setChatBrowserOpen(false);
                  setLiveThread({ id: thread._id, title: thread.title });
                }}
              />
            ) : null}
            {activeRunPanelId ? (
              <RunDetailPanel
                runId={activeRunPanelId}
                overlay={paneOverlay.run ?? false}
                width={paneWidths.run ?? runPanelWidth}
                onWidthChange={(next) => notePaneIntent("run", next)}
                card={runEngine.cards.find(
                  (card) => card.runId === activeRunPanelId,
                )}
                onClose={() => setActiveRunPanelId(null)}
                onAction={(card, action, targetId) => {
                  if (action === "open") runEngine.closeDetails();
                  void runEngine.onCardAction(card, action, targetId);
                }}
                onUseThread={(id, title) =>
                  toggleContinuedThread(id, title, activeRunPanelId)
                }
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The folder open in the Library goes in the address, so a reload, Back or a
 * copied link comes back to it rather than to the top (LIBRARY.md).
 */
function rememberLibraryFolder(nodeId: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (nodeId) params.set("nodeId", nodeId);
  else params.delete("nodeId");
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}
