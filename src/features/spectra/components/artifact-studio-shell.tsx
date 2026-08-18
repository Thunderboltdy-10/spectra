"use client";

import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { BookOpen, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { type SpectraArtifact } from "../data/api";
import {
  availableWorkModes,
  getWorkDefinition,
  workCan,
  type WorkCapability,
  type WorkModeDefinition,
  type WorkResponsiveContract,
  type WorkSharingRole,
  type WorkType,
} from "../work/registry";
import { projectLegacyWorkSession } from "../work/session/session-controller";
import { blueprintMeta } from "./artifact-card";
import { tagsFromDraft } from "./artifact-studio-value-utils";

export type StudioMode = "closed" | "split" | "tab";
export type StudioTab = { artifactId: string; openedAt: number };

/* ------------------------------------------------------------------ *
 * The studio contract
 *
 * One artifact shell holds identity, banners, sync truth, inspectors and
 * the scroll container. A studio renders the work itself and nothing else.
 * Everything a studio needs from the shell arrives through this contract, so
 * a type cannot quietly re-derive permissions, re-invent a mode list, or
 * decide on its own that a side panel is read-only.
 * ------------------------------------------------------------------ */

/** The four inspectors that survived. Everything else is a workbar action. */
export type StudioInspectorPanel =
  | "history"
  | "comments"
  | "references"
  | "details";

/**
 * Density is measured from the pane the studio occupies, never the window.
 * A studio in an 850px panel inside a 1440px display is `tight`.
 *   comfortable  ≥ the type's preferred inline size
 *   compact      between minimum and preferred: labels start shedding
 *   tight        at or below the type's minimum: essentials only
 */
export type StudioDensity = "comfortable" | "compact" | "tight";

export type StudioSyncState =
  | "live"
  | "saving"
  | "saved"
  | "pending"
  | "offline"
  | "read_only"
  | "error";

export type StudioContract = {
  artifactId: string;
  type: WorkType;
  /** The viewer's role here, resolved once by the shell from permissions. */
  role: WorkSharingRole;
  /**
   * Registry truth. A workbar action with `requires` is filtered by this, so
   * an action the viewer cannot perform is absent rather than inert.
   */
  can: (capability: WorkCapability) => boolean;
  /** Modes the viewer may actually enter, already capability-filtered. */
  modes: readonly WorkModeDefinition[];
  /**
   * Read-only means the viewer genuinely lacks `edit`. It is never a
   * consequence of surface or width: compact panes and right-hand panels edit
   * (CANON D1/D4).
   */
  readOnly: boolean;
  /** How the studio is mounted. Affects layout only, never capability. */
  surface: "full" | "panel";
  sync: { state: StudioSyncState; label: string };
  responsive: WorkResponsiveContract;
  density: StudioDensity;
  /** The shell's docked inspectors. A studio opens them, never rebuilds them. */
  inspector: {
    open: StudioInspectorPanel | null;
    show: (panel: StudioInspectorPanel) => void;
    hide: () => void;
  };
};

const StudioContractContext = createContext<StudioContract | null>(null);

export function StudioContractProvider({
  value,
  children,
}: {
  value: StudioContract;
  children: ReactNode;
}) {
  return (
    <StudioContractContext.Provider value={value}>
      {children}
    </StudioContractContext.Provider>
  );
}

/**
 * Throws when a studio renders outside the shell. That is deliberate: the
 * failure mode we are removing is a studio that silently supplies its own
 * answers for permissions, modes and width. A missing contract has to be loud.
 */
export function useStudioContract(): StudioContract {
  const contract = useContext(StudioContractContext);
  if (!contract)
    throw new Error(
      "useStudioContract must be used inside the artifact shell. Render this studio through ArtifactStudio, or wrap it in StudioContractProvider.",
    );
  return contract;
}

/** Builds the contract from registry truth. The shell's single source. */
export function useStudioContractValue({
  artifactId,
  type,
  role,
  surface,
  sync,
  density,
  inspector,
}: {
  artifactId: string;
  type: WorkType;
  role: WorkSharingRole;
  surface: "full" | "panel";
  sync: { state: StudioSyncState; label: string };
  density: StudioDensity;
  inspector: StudioContract["inspector"];
}): StudioContract {
  return useMemo(() => {
    const definition = getWorkDefinition(type);
    return {
      artifactId,
      type,
      role,
      can: (capability: WorkCapability) => workCan(type, role, capability),
      modes: availableWorkModes(type, role),
      readOnly: !workCan(type, role, "edit"),
      surface,
      sync,
      responsive: definition.responsive,
      density,
      inspector,
    };
  }, [artifactId, density, inspector, role, surface, sync, type]);
}

/**
 * Resolves density from the studio's own pane. `ResizeObserver`, not a viewport
 * media query and not a scroll listener, because the pane is what changes.
 */
export function useStudioDensity(
  ref: RefObject<HTMLElement | null>,
  responsive: WorkResponsiveContract,
): StudioDensity {
  const [density, setDensity] = useState<StudioDensity>("comfortable");
  const { minInlineSize, preferredInlineSize } = responsive;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number) => {
      const next: StudioDensity =
        width >= preferredInlineSize
          ? "comfortable"
          : width > minInlineSize
            ? "compact"
            : "tight";
      setDensity((current) => (current === next ? current : next));
    };
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [minInlineSize, preferredInlineSize, ref]);
  return density;
}

/**
 * Publishes the live composer's height as `--spectra-composer-safe-area` on the
 * studio root, so the shared scrollport can end above it.
 *
 * The composer is `position: fixed` over the workbench, so no amount of layout
 * inside a studio can know how tall it is; six of nine editors ended up with
 * their last rows of content underneath it. Measuring it once here fixes all of
 * them, and self-corrects to 0 when the composer is not mounted.
 */
export function useComposerSafeArea(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const apply = (height: number) => {
      element.style.setProperty(
        "--spectra-composer-safe-area",
        `${Math.round(height)}px`,
      );
    };
    const measure = () => {
      const composer =
        document.querySelector<HTMLElement>(".spectra-live-stack") ??
        document.querySelector<HTMLElement>(".spectra-workbench-live-stack");
      if (!composer) {
        apply(0);
        return;
      }
      const rect = composer.getBoundingClientRect();
      // Zero when the composer is off-screen or collapsed, so Present mode and
      // full-bleed activities do not pay for padding they do not need.
      apply(rect.height > 0 && rect.bottom > 0 ? rect.height + 12 : 0);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    schedule();
    const composer = document.querySelector<HTMLElement>(".spectra-live-stack");
    const observer = new ResizeObserver(schedule);
    if (composer) observer.observe(composer);
    // The composer mounts and unmounts with the route, so watch for it
    // appearing. Deliberately not `subtree: true` — a document-wide subtree
    // observer would fire on every keystroke in the editor.
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      element.style.removeProperty("--spectra-composer-safe-area");
    };
  }, [ref]);
}

export function useArtifactStudioState(
  _storageKey: string,
  artifacts: SpectraArtifact[],
) {
  const [synchronizedSnapshots, setSynchronizedSnapshots] = useState(
    () =>
      new Map<
        string,
        {
          syncedAt: number;
          title: string;
          summary: string;
          tagDraft: string;
          content: unknown;
        }
      >(),
  );
  useEffect(() => {
    const receiveSynchronizedArtifact = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            artifactId?: unknown;
            snapshot?: {
              title?: unknown;
              summary?: unknown;
              tagDraft?: unknown;
              content?: unknown;
            };
          }
        | undefined;
      if (
        typeof detail?.artifactId !== "string" ||
        typeof detail.snapshot?.title !== "string" ||
        typeof detail.snapshot.summary !== "string" ||
        typeof detail.snapshot.tagDraft !== "string"
      )
        return;
      setSynchronizedSnapshots((current) => {
        const next = new Map(current);
        next.set(detail.artifactId as string, {
          syncedAt: Date.now(),
          title: detail.snapshot!.title as string,
          summary: detail.snapshot!.summary as string,
          tagDraft: detail.snapshot!.tagDraft as string,
          content: detail.snapshot!.content,
        });
        return next;
      });
    };
    window.addEventListener(
      "spectra:artifact-synchronized",
      receiveSynchronizedArtifact,
    );
    return () =>
      window.removeEventListener(
        "spectra:artifact-synchronized",
        receiveSynchronizedArtifact,
      );
  }, []);
  const openObjects = useSpectraContextStore((state) => state.openObjects);
  const activeOpenObjectKey = useSpectraContextStore(
    (state) => state.activeOpenObjectKey,
  );
  const dirtyArtifactIds = useSpectraContextStore(
    (state) => state.dirtyArtifactIds,
  );
  const openObject = useSpectraContextStore((state) => state.openObject);
  const focusObject = useSpectraContextStore((state) => state.focusObject);
  const deactivateObject = useSpectraContextStore(
    (state) => state.deactivateObject,
  );
  const closeObject = useSpectraContextStore((state) => state.closeObject);
  const setArtifactDirty = useSpectraContextStore(
    (state) => state.setArtifactDirty,
  );
  const artifactById = useMemo(
    () =>
      new Map(
        artifacts.map((artifact) => {
          const synchronized = synchronizedSnapshots.get(artifact._id);
          if (!synchronized || artifact.updatedAt >= synchronized.syncedAt)
            return [artifact._id, artifact] as const;
          return [
            artifact._id,
            {
              ...artifact,
              title: synchronized.title,
              summary: synchronized.summary || undefined,
              tags: tagsFromDraft(synchronized.tagDraft),
              content: synchronized.content,
              updatedAt: synchronized.syncedAt,
            },
          ] as const;
        }),
      ),
    [artifacts, synchronizedSnapshots],
  );
  const session = useMemo(
    () =>
      projectLegacyWorkSession(
        artifactById,
        openObjects,
        activeOpenObjectKey,
        dirtyArtifactIds,
      ),
    [activeOpenObjectKey, artifactById, dirtyArtifactIds, openObjects],
  );
  const mode: StudioMode = session.mode;
  const activeArtifactId = session.activeWorkId;
  const activeArtifact = session.activeWork;
  const tabs = useMemo<StudioTab[]>(
    () =>
      session.tabs.map((tab) => ({
        artifactId: tab.workId,
        openedAt: tab.openedAt,
      })),
    [session.tabs],
  );
  const dirtyIds = session.dirtyIds;

  const openSplit = useCallback(
    (artifact: SpectraArtifact) => {
      openObject({
        type: "artifact",
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        presentation: "split",
      });
    },
    [openObject],
  );

  const openTab = useCallback(
    (artifact: SpectraArtifact) => {
      openObject({
        type: "artifact",
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        presentation:
          artifact.blueprintKey === "thread_reference" ? "split" : "tab",
      });
    },
    [openObject],
  );

  const activateTab = useCallback(
    (artifactId: string) => {
      if (focusObject("artifact", artifactId)) return;
      const artifact = artifactById.get(artifactId);
      if (artifact) openTab(artifact);
    },
    [artifactById, focusObject, openTab],
  );

  const closeTab = useCallback(
    (artifactId: string) => {
      closeObject("artifact", artifactId);
    },
    [closeObject],
  );

  const closeStudio = useCallback(() => {
    if (activeArtifactId && mode === "split")
      closeObject("artifact", activeArtifactId);
    else deactivateObject();
  }, [activeArtifactId, closeObject, deactivateObject, mode]);

  const setDirty = useCallback(
    (artifactId: string, dirty: boolean) => {
      setArtifactDirty(artifactId, dirty);
    },
    [setArtifactDirty],
  );

  return {
    mode,
    activeArtifact,
    activeArtifactId,
    tabs,
    dirtyIds,
    isOpen: mode !== "closed" && Boolean(activeArtifact),
    openSplit,
    openTab,
    activateTab,
    closeTab,
    closeStudio,
    setDirty,
  };
}

export function StudioSplitShell({
  width,
  onWidthChange,
  ariaLabel,
  cssWidthVariable,
  minWidth = 360,
  contentReserve = 420,
  children,
}: {
  width: number;
  onWidthChange?: (width: number) => void;
  ariaLabel: string;
  cssWidthVariable?: string;
  minWidth?: number;
  /** Minimum main-canvas width kept when fitting this panel. */
  contentReserve?: number;
  children: ReactNode;
}) {
  const resizingRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const host =
      panelRef.current?.closest<HTMLElement>(".spectra-wave-y") ??
      panelRef.current?.parentElement;
    if (cssWidthVariable)
      host?.style.setProperty(cssWidthVariable, `${width}px`);
    return () => {
      if (cssWidthVariable) host?.style.removeProperty(cssWidthVariable);
    };
  }, [cssWidthVariable, width]);
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!onWidthChange) return;
    const updateWidth = onWidthChange;
    function fitPanel() {
      const panel = panelRef.current;
      if (!panel) return;
      const host =
        panel.closest<HTMLElement>(".spectra-wave-y") ?? panel.parentElement;
      if (!host) return;
      const peers = Array.from(
        host.querySelectorAll<HTMLElement>("[data-studio-panel]"),
      );
      const siblingWidth = peers
        .filter((candidate) => candidate !== panel)
        .reduce(
          (total, candidate) => total + candidate.getBoundingClientRect().width,
          0,
        );
      const siblingCount = peers.length - 1;
      const reserve =
        siblingCount > 0
          ? Math.max(
              320,
              Math.min(contentReserve, Math.floor(host.clientWidth * 0.28)),
            )
          : contentReserve;
      const floor = siblingCount > 0 ? Math.min(minWidth, 480) : minWidth;
      const hostWidth = host.clientWidth;
      const maximum = Math.max(
        floor,
        Math.min(880, hostWidth - siblingWidth - reserve),
      );
      const fairCap =
        siblingCount > 0
          ? Math.max(floor, Math.floor(hostWidth * 0.46))
          : maximum;
      const responsiveCap =
        siblingCount === 0 && hostWidth < 1920
          ? Math.max(floor, Math.floor(hostWidth * 0.5))
          : maximum;
      // Switching work in an already-open panel must not resize the panel.
      // Only raise the floor if the new type cannot fit; never snap to a
      // different type's preferred share of the workbench.
      if (fittedRef.current) {
        if (width < floor) updateWidth(floor);
        else if (width > maximum) updateWidth(maximum);
        return;
      }
      const next = Math.max(
        floor,
        Math.min(width, maximum, fairCap, responsiveCap),
      );
      fittedRef.current = true;
      if (Math.abs(next - width) >= 8) updateWidth(next);
      else if (width > maximum || width > fairCap || width > responsiveCap)
        updateWidth(Math.min(maximum, fairCap, responsiveCap));
      else if (width < floor) updateWidth(floor);
    }
    const frame = window.requestAnimationFrame(fitPanel);
    const host =
      panelRef.current?.closest<HTMLElement>(".spectra-wave-y") ??
      panelRef.current?.parentElement;
    const observer = host ? new ResizeObserver(fitPanel) : null;
    if (host) observer?.observe(host);
    window.addEventListener("resize", fitPanel);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", fitPanel);
    };
  }, [contentReserve, minWidth, onWidthChange, width]);
  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!resizingRef.current || !onWidthChange) return;
      const panel = panelRef.current;
      if (!panel) return;
      const host =
        panel.closest<HTMLElement>(".spectra-wave-y") ?? panel.parentElement;
      const panelLeft = panel.getBoundingClientRect().left;
      const peers = host
        ? Array.from(host.querySelectorAll<HTMLElement>("[data-studio-panel]"))
        : [];
      const siblings = peers.filter((candidate) => candidate !== panel);
      const rightSiblingWidth = siblings
        .filter(
          (candidate) => candidate.getBoundingClientRect().left > panelLeft,
        )
        .reduce(
          (total, candidate) => total + candidate.getBoundingClientRect().width,
          0,
        );
      const allSiblingWidth = siblings.reduce(
        (total, candidate) => total + candidate.getBoundingClientRect().width,
        0,
      );
      const hostRight =
        host?.getBoundingClientRect().right ?? window.innerWidth;
      const floor = siblings.length > 0 ? Math.min(minWidth, 300) : minWidth;
      const reserve =
        siblings.length > 0 ? Math.min(contentReserve, 240) : contentReserve;
      const hostWidth = host?.clientWidth ?? window.innerWidth;
      const available = Math.max(floor, hostWidth - allSiblingWidth - reserve);
      const fairCap =
        siblings.length > 0
          ? Math.max(floor, Math.floor(hostWidth * 0.52))
          : available;
      const responsiveCap =
        siblings.length === 0 && hostWidth < 1920
          ? Math.max(floor, Math.floor(hostWidth * 0.5))
          : available;
      onWidthChange(
        Math.max(
          floor,
          Math.min(
            Math.round(hostRight - event.clientX - rightSiblingWidth),
            Math.min(960, available, fairCap, responsiveCap),
          ),
        ),
      );
    }
    function onUp() {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [contentReserve, minWidth, onWidthChange]);
  return (
    <aside
      ref={panelRef}
      data-studio-panel
      className="spectra-studio-split-panel relative z-40 flex h-full min-w-0 overflow-hidden border-l border-[color-mix(in_oklab,var(--border-default)_55%,transparent)] bg-[var(--wave-paper,var(--bg-primary))]"
      style={{
        width: `${width}px`,
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: `${width}px`,
        minWidth: 0,
        contain: "inline-size",
        containerType: "inline-size",
      }}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="absolute -left-1 top-0 z-20 h-full w-2 cursor-ew-resize bg-transparent transition-colors hover:bg-[color-mix(in_oklab,var(--text-tertiary)_18%,transparent)]"
        aria-label={`Resize ${ariaLabel}`}
        onPointerDown={(event) => {
          event.preventDefault();
          resizingRef.current = true;
          document.body.style.cursor = "ew-resize";
          document.body.style.userSelect = "none";
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </aside>
  );
}

/** Width-stable stand-in while the studio chunk loads, so the library does not
 *  jump to full width and then get covered by a late-arriving panel. */
export function StudioSplitPlaceholder({
  width = 680,
}: {
  width?: number;
}) {
  return (
    <aside
      data-studio-panel
      aria-hidden
      className="spectra-studio-split-panel spectra-studio-split-placeholder relative z-40 h-full min-w-0 overflow-hidden border-l border-[color-mix(in_oklab,var(--border-default)_55%,transparent)] bg-[var(--wave-paper,var(--bg-primary))]"
      style={{
        width: `${width}px`,
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: `${width}px`,
        minWidth: 0,
        contain: "inline-size",
      }}
    />
  );
}

export function StudioTabRail({
  hubTabs,
  activeHubTabId,
  artifacts,
  tabs,
  activeArtifactId = null,
  dirtyIds,
  onActivateHub,
  onCloseHub,
  onAddHub,
  onActivateTab,
  onCloseTab,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  persistent = false,
}: {
  hubTabs: Array<{ id: string; label: string }>;
  activeHubTabId: string | null;
  artifacts: SpectraArtifact[];
  tabs: StudioTab[];
  activeArtifactId?: string | null;
  dirtyIds: Set<string>;
  onActivateHub: (hubTabId: string) => void;
  onCloseHub: (hubTabId: string) => void;
  onAddHub: () => void;
  onActivateTab: (artifactId: string) => void;
  onCloseTab: (artifactId: string) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  /** Keep the rail on screen even when there is only the one hub tab. */
  persistent?: boolean;
}) {
  // Deliberately null on the first render, server and client alike. Reading the
  // slot in the initialiser made the first client render disagree with the
  // server's — the server has no slot, the browser does — and React threw a
  // hydration error and rebuilt the whole Library tree, which showed up as
  // "Could not load your library". The portal arrives one commit later instead.
  const [shellSlot, setShellSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setShellSlot(document.getElementById("spectra-shell-tab-slot"));
  }, []);

  const tabClass = (active: boolean) =>
    `group flex h-8 min-w-[120px] max-w-[220px] shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 text-[12px] font-medium transition ${
      active
        ? "border-[color-mix(in_oklab,var(--brand-primary)_36%,var(--border-default))] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_0_2px_var(--brand-primary),0_1px_6px_rgba(27,20,12,0.06)]"
        : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    }`;

  // A single hub is the page itself, not a meaningful browser tab. Keeping an
  // entire 44px rail for “All” added a second header before any work was open.
  // A surface that *is* the rail's home — Library, Workspace — opts out of that
  // suppression, because there the rail is how a second view or an open piece of
  // work is reached at all, and the two hubs should not disagree about whether
  // Spectra has tabs.
  if (!persistent && hubTabs.length === 1 && tabs.length === 0) return null;

  const canNavigate = Boolean(onGoBack || onGoForward);

  const rail = (
    <div
      className={`flex min-h-0 min-w-0 flex-1 items-center overflow-hidden ${shellSlot ? "h-full bg-transparent px-0" : "h-12 shrink-0 border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_60%,var(--bg-primary))] px-3.5"}`}
    >
      {/* History arrows appear only where there is a history to walk. A pair of
          permanently dead chevrons is a promise the surface cannot keep. */}
      {canNavigate ? (
        <div className="mr-1.5 flex shrink-0 items-center gap-0.5 border-r border-[var(--border-subtle)] pr-1.5">
          <button
            type="button"
            aria-label="Go back"
            title="Go back"
            disabled={!canGoBack || !onGoBack}
            onClick={onGoBack}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Go forward"
            title="Go forward"
            disabled={!canGoForward || !onGoForward}
            onClick={onGoForward}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div className="spectra-studio-tab-scroller inline-flex w-max max-w-full items-center gap-1.5 overflow-x-auto pr-1">
        {hubTabs.map((hubTab) => {
          const active = activeHubTabId === hubTab.id;
          return (
            <button
              key={hubTab.id}
              type="button"
              className={tabClass(active)}
              onClick={() => onActivateHub(hubTab.id)}
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
              <span className="min-w-0 flex-1 truncate text-left">
                {hubTab.label}
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${hubTab.label}`}
                className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseHub(hubTab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onCloseHub(hubTab.id);
                  }
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}
        {tabs.map((tab) => {
          const artifact = artifacts.find(
            (item) => item._id === tab.artifactId,
          );
          if (!artifact) return null;
          const meta = blueprintMeta[artifact.blueprintKey];
          const Icon = meta.icon;
          const active = activeArtifactId === artifact._id;
          return (
            <button
              key={tab.artifactId}
              type="button"
              className={tabClass(active)}
              onClick={() => onActivateTab(artifact._id)}
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: meta.color }}
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {artifact.title}
              </span>
              {dirtyIds.has(artifact._id) ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-gold)]"
                  title="Unsaved changes"
                />
              ) : null}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${artifact.title}`}
                className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={(event) => {
                  event.stopPropagation();
                  if (dirtyIds.has(artifact._id)) {
                    onActivateTab(artifact._id);
                    requestAnimationFrame(() =>
                      window.dispatchEvent(
                        new CustomEvent("spectra:request-artifact-close", {
                          detail: { artifactId: artifact._id },
                        }),
                      ),
                    );
                  } else onCloseTab(artifact._id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (dirtyIds.has(artifact._id)) {
                      onActivateTab(artifact._id);
                      requestAnimationFrame(() =>
                        window.dispatchEvent(
                          new CustomEvent("spectra:request-artifact-close", {
                            detail: { artifactId: artifact._id },
                          }),
                        ),
                      );
                    } else onCloseTab(artifact._id);
                  }
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          onClick={onAddHub}
          aria-label="Open a new home view"
          title="Open a new home view"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  if (shellSlot) return createPortal(rail, shellSlot);
  return null;
}
