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
import type { CommandExecutionResult, CompatibilityProfile, FidelityClass } from "../commands/types";
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
import { spectraBus } from "../events";
import { workTypeMeta } from "./artifact-card";
import { resolveSplitOverlay } from "./split-presentation";

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
  compatibilityProfile: CompatibilityProfile;
  fidelity: Readonly<Record<string, FidelityClass>>;
  /** Optional app-level semantic dispatcher supplied by the shell. */
  executeApplicationCommand?: (commandId: string, params: unknown) => void | Promise<void | CommandExecutionResult>;
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

export function useOptionalStudioContract(): StudioContract | null {
  return useContext(StudioContractContext);
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
  compatibilityProfile = "spectra-native",
  fidelity = { artifact: "NATIVE" },
  executeApplicationCommand,
}: {
  artifactId: string;
  type: WorkType;
  role: WorkSharingRole;
  surface: "full" | "panel";
  sync: { state: StudioSyncState; label: string };
  density: StudioDensity;
  inspector: StudioContract["inspector"];
  compatibilityProfile?: CompatibilityProfile;
  fidelity?: Readonly<Record<string, FidelityClass>>;
  executeApplicationCommand?: StudioContract["executeApplicationCommand"];
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
      compatibilityProfile,
      fidelity,
      ...(executeApplicationCommand ? { executeApplicationCommand } : {}),
      inspector,
    };
  }, [artifactId, compatibilityProfile, density, executeApplicationCommand, fidelity, inspector, role, surface, sync, type]);
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
      setDensity((current) => {
        const next: StudioDensity =
          width >= preferredInlineSize
            ? "comfortable"
            : width > minInlineSize
              ? "compact"
              : "tight";
        if (current === next) return current;
        // A 24px band around each threshold absorbs the scrollbar appearing
        // and the workbar shedding labels, which otherwise flip density every
        // frame in a tab and take the studio past React's update cap.
        const band = 24;
        if (current === "comfortable" && width >= preferredInlineSize - band)
          return current;
        if (current === "compact" && width > minInlineSize && width < preferredInlineSize + band)
          return current;
        if (current === "tight" && width <= minInlineSize + band) return current;
        return next;
      });
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
 * The composer safe area is published globally by the composer band itself
 * (`composer-safe-area.ts`, mounted by `WorkbenchLiveStack`); studios consume
 * `--spectra-composer-safe-area` from the document root like every other
 * surface. The per-studio publisher that used to live here measured the same
 * band six ways and still missed surfaces outside the studios.
 */

export function useArtifactStudioState(
  _storageKey: string,
  artifacts: SpectraArtifact[],
) {
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
    () => new Map(artifacts.map((artifact) => [artifact._id, artifact] as const)),
    [artifacts],
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

/** Sibling panels that still hold in-flow width: overlays and the loading
 *  placeholder take none, so they must not squeeze fitting or resizing. */
function inFlowSiblingPanels(host: HTMLElement, panel: HTMLElement) {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-studio-panel]")).filter(
    (candidate) =>
      candidate !== panel &&
      !candidate.hasAttribute("data-split-overlay") &&
      !candidate.hasAttribute("aria-hidden"),
  );
}

export function StudioSplitShell({
  width,
  onWidthChange,
  ariaLabel,
  cssWidthVariable,
  minWidth = 360,
  contentReserve = 420,
  overlay: controlledOverlay,
  children,
}: {
  width: number;
  onWidthChange?: (width: number) => void;
  ariaLabel: string;
  cssWidthVariable?: string;
  minWidth?: number;
  /** Minimum main-canvas width kept when fitting this panel. */
  contentReserve?: number;
  /**
   * When provided, the workbench row owns the split/overlay decision
   * (`resolveWorkbenchPanes`) so every open panel is budgeted together.
   * Left undefined outside the workbench (route side previews), where the
   * panel keeps its own host-measured behavior.
   */
  overlay?: boolean;
  children: ReactNode;
}) {
  const resizingRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  /* When the host cannot honor the library reserve and this work's own floor
     at once, the panel is promoted out of the flow: it overlays the content
     column at full width instead of squeezing both sides into unreadability.
     One pure resolver owns that boundary (`split-presentation.ts`). */
  const [internalOverlay, setInternalOverlay] = useState(false);
  const overlay = controlledOverlay ?? internalOverlay;
  const overlayRef = useRef(false);
  overlayRef.current = overlay;
  const overlayRefMirror = useCallback(
    (hostWidth: number) => {
      const next = resolveSplitOverlay({
        hostWidth,
        panelMinWidth: minWidth,
        contentReserve,
        overlay: overlayRef.current,
      });
      if (next !== overlayRef.current) {
        overlayRef.current = next;
        setInternalOverlay(next);
      }
      return next;
    },
    [contentReserve, minWidth],
  );
  useEffect(() => {
    // The workbench row controls the presentation; nothing to measure here.
    if (controlledOverlay !== undefined) return;
    const panel = panelRef.current;
    if (!panel) return;
    /* Only the workbench row (library/workspace beside the panel) can promote
       the panel to an overlay. Route side previews (settings, admin) wrap the
       panel in a host that is exactly the panel's own width, so measuring
       them would be circular — they keep their fixed-width behavior. */
    const host = panel.closest<HTMLElement>("[data-split-host]");
    if (!host) return;
    const measure = () => {
      overlayRefMirror(host.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [controlledOverlay, overlayRefMirror]);
  /* An overlay covers the content region but spares every sibling that is
     still in flow: a split studio stays fully visible beside an overlayed
     thread. The spared width is the sum of the in-flow siblings' actual
     (user-resizable) widths, measured live so drags update the inset. */
  const [insetRight, setInsetRight] = useState(0);
  useEffect(() => {
    if (!overlay) {
      setInsetRight(0);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const host =
      panel.closest<HTMLElement>("[data-split-host]") ?? panel.parentElement;
    if (!host) return;
    const measure = () => {
      const siblings = inFlowSiblingPanels(host, panel);
      const next = Math.round(
        siblings.reduce(
          (total, candidate) => total + candidate.getBoundingClientRect().width,
          0,
        ),
      );
      setInsetRight((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    for (const sibling of Array.from(
      host.querySelectorAll<HTMLElement>("[data-studio-panel]"),
    ))
      if (sibling !== panel) observer.observe(sibling);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [overlay]);
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
  /* The width the user actually chose (drag) or accepted (first fit). Forced
     clamps borrow from it; drags rewrite it. Only used while uncontrolled —
     the workbench row allocates controlled panels' widths itself. */
  const intentWidthRef = useRef(width);
  useEffect(() => {
    if (controlledOverlay !== undefined) return;
    if (!onWidthChange) return;
    const updateWidth = onWidthChange;
    function fitPanel() {
      const panel = panelRef.current;
      if (!panel) return;
      const host =
        panel.closest<HTMLElement>(".spectra-wave-y") ?? panel.parentElement;
      if (!host) return;
      // While the panel is an overlay it has no in-flow width to fit; the
      // last fitted width is kept and clamped again when the split returns.
      if (overlayRef.current) return;
      const peers = inFlowSiblingPanels(host, panel);
      const siblingWidth = peers
        .reduce(
          (total, candidate) => total + candidate.getBoundingClientRect().width,
          0,
        );
      const siblingCount = peers.length;
      /* The reserve never weakens: narrow hosts are resolved by overlay
         promotion (`resolveWorkbenchPanes`), not by squeezing the library
         below the width it can be read at. */
      const reserve = contentReserve;
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
      // different type's preferred share of the workbench. The width is the
      // user's intent: the budget borrows from it while the host is tight
      // and hands it back when room returns, instead of stranding the panel
      // at its floor after one narrow episode.
      if (fittedRef.current) {
        const target = Math.max(
          floor,
          Math.min(intentWidthRef.current, maximum),
        );
        if (Math.abs(target - width) >= 2) updateWidth(target);
        return;
      }
      const next = Math.max(
        floor,
        Math.min(width, maximum, fairCap, responsiveCap),
      );
      // The first fit borrows from the intent but never rewrites it: only a
      // user drag does. A panel that mounted during a crowded moment grows
      // back to its chosen width when the row makes room again.
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
    if (host) {
      observer?.observe(host);
      /* A sibling clamping or restoring changes what this panel may take;
         width changes do not resize the host, so watch the siblings too. */
      for (const sibling of Array.from(
        host.querySelectorAll<HTMLElement>("[data-studio-panel]"),
      ))
        if (sibling !== panelRef.current) observer?.observe(sibling);
    }
    /* A sibling panel opening, closing, or leaving the flow (overlay) does
       not resize the host, but it changes what this panel may take — refit
       on those structural changes too. */
    const mutations = host
      ? new MutationObserver((records) => {
          if (
            records.some(
              (record) =>
                record.type === "attributes" ||
                Array.from(record.addedNodes).some(
                  (node) =>
                    node instanceof HTMLElement &&
                    node.hasAttribute("data-studio-panel"),
                ) ||
                Array.from(record.removedNodes).some(
                  (node) =>
                    node instanceof HTMLElement &&
                    node.hasAttribute("data-studio-panel"),
                ),
            )
          )
            fitPanel();
        })
      : null;
    mutations?.observe(host!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-split-overlay"],
    });
    window.addEventListener("resize", fitPanel);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", fitPanel);
    };
  }, [contentReserve, controlledOverlay, minWidth, onWidthChange, width]);
  useEffect(() => {
    function onMove(event: globalThis.PointerEvent) {
      if (!resizingRef.current || !onWidthChange) return;
      if (overlayRef.current) return;
      const panel = panelRef.current;
      if (!panel) return;
      const host =
        panel.closest<HTMLElement>(".spectra-wave-y") ?? panel.parentElement;
      const panelLeft = panel.getBoundingClientRect().left;
      const siblings = host ? inFlowSiblingPanels(host, panel) : [];
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
      /* Controlled panels are budgeted by the row allocator
         (`allocateWorkbenchPanes`): the drag reports the raw desired width
         and the allocator applies the budget in the same pass, so a drag
         can never push a sibling under its floor or the library under its
         reserve. Uncontrolled panels (route previews) keep the local caps. */
      const dragged =
        controlledOverlay !== undefined
          ? Math.max(
              floor,
              Math.min(
                Math.round(hostRight - event.clientX - rightSiblingWidth),
                960,
              ),
            )
          : (() => {
              const reserve = contentReserve;
              const hostWidth = host?.clientWidth ?? window.innerWidth;
              const available = Math.max(
                floor,
                hostWidth - allSiblingWidth - reserve,
              );
              const fairCap =
                siblings.length > 0
                  ? Math.max(floor, Math.floor(hostWidth * 0.52))
                  : available;
              const responsiveCap =
                siblings.length === 0 && hostWidth < 1920
                  ? Math.max(floor, Math.floor(hostWidth * 0.5))
                  : available;
              return Math.max(
                floor,
                Math.min(
                  Math.round(hostRight - event.clientX - rightSiblingWidth),
                  Math.min(960, available, fairCap, responsiveCap),
                ),
              );
            })();
      intentWidthRef.current = dragged;
      onWidthChange(dragged);
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
  }, [contentReserve, controlledOverlay, minWidth, onWidthChange]);
  return (
    <aside
      ref={panelRef}
      data-studio-panel
      data-split-overlay={overlay ? "" : undefined}
      className={
        overlay
          ? "spectra-studio-split-panel spectra-studio-split-panel--overlay spectra-panel-enter absolute inset-y-0 left-0 z-panel flex h-full min-w-0 overflow-hidden bg-[var(--wave-paper,var(--bg-primary))]"
          : "spectra-studio-split-panel spectra-panel-enter relative z-chrome flex h-full min-w-0 overflow-hidden border-l border-[color-mix(in_oklab,var(--border-default)_55%,transparent)] bg-[var(--wave-paper,var(--bg-primary))]"
      }
      style={
        overlay
          ? {
              // Spare the combined width of siblings still in flow so a
              // split studio stays fully visible beside an overlayed panel.
              right: `${insetRight}px`,
              minWidth: 0,
              contain: "inline-size",
              containerType: "inline-size",
            }
          : {
              width: `${width}px`,
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: `${width}px`,
              minWidth: 0,
              contain: "inline-size",
              containerType: "inline-size",
            }
      }
      aria-label={ariaLabel}
    >
      {!overlay ? (
        <button
          type="button"
          className="absolute -left-1 top-0 z-chrome h-full w-2 cursor-ew-resize bg-transparent transition-colors hover:bg-[color-mix(in_oklab,var(--text-tertiary)_18%,transparent)]"
          aria-label={`Resize ${ariaLabel}`}
          onPointerDown={(event) => {
            event.preventDefault();
            resizingRef.current = true;
            document.body.style.cursor = "ew-resize";
            document.body.style.userSelect = "none";
          }}
        />
      ) : null}
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
      className="spectra-studio-split-panel spectra-studio-split-placeholder relative z-chrome h-full min-w-0 overflow-hidden border-l border-[color-mix(in_oklab,var(--border-default)_55%,transparent)] bg-[var(--wave-paper,var(--bg-primary))]"
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

  // A tab is two sibling controls, activate and close. The close used to be a
  // `role="button"` span nested inside the activate <button>: interactive
  // content inside a button is invalid, and assistive tech announced one
  // control whose name swallowed both.
  const tabBodyClass =
    "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-chip text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]";
  const tabCloseClass =
    "ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-chip text-[var(--text-tertiary)] outline-none hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]";
  const tabClass = (active: boolean) =>
    `group flex h-8 min-w-[120px] max-w-[220px] shrink-0 items-center gap-1.5 rounded-chip border px-2.5 text-caption font-medium transition-colors duration-[var(--motion-fast)] ${
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
            className="flex h-8 w-8 items-center justify-center rounded-chip text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Go forward"
            title="Go forward"
            disabled={!canGoForward || !onGoForward}
            onClick={onGoForward}
            className="flex h-8 w-8 items-center justify-center rounded-chip text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div className="spectra-studio-tab-scroller inline-flex w-max max-w-full items-center gap-1.5 overflow-x-auto pr-1">
        {hubTabs.map((hubTab) => {
          const active = activeHubTabId === hubTab.id;
          return (
            <div key={hubTab.id} className={tabClass(active)}>
              <button
                type="button"
                className={tabBodyClass}
                aria-current={active ? "page" : undefined}
                onClick={() => onActivateHub(hubTab.id)}
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {hubTab.label}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Close ${hubTab.label}`}
                className={tabCloseClass}
                onClick={() => onCloseHub(hubTab.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {tabs.map((tab) => {
          const artifact = artifacts.find(
            (item) => item._id === tab.artifactId,
          );
          if (!artifact) return null;
          const meta = workTypeMeta[artifact.blueprintKey];
          const Icon = meta.icon;
          const active = activeArtifactId === artifact._id;
          return (
            <div key={tab.artifactId} className={tabClass(active)}>
              <button
                type="button"
                className={tabBodyClass}
                aria-current={active ? "page" : undefined}
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
              </button>
              <button
                type="button"
                aria-label={`Close ${artifact.title}`}
                className={tabCloseClass}
                onClick={() => {
                  if (dirtyIds.has(artifact._id)) {
                    onActivateTab(artifact._id);
                    requestAnimationFrame(() =>
                      void spectraBus.command("work.requestClose", {
                        workId: artifact._id,
                      }),
                    );
                  } else onCloseTab(artifact._id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
