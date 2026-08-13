"use client";

import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { BookOpen, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { type SpectraArtifact } from "../data/api";
import { projectLegacyWorkSession } from "../work/session/session-controller";
import { blueprintMeta } from "./artifact-card";
import { tagsFromDraft } from "./artifact-studio-value-utils";

export type StudioMode = "closed" | "split" | "tab";
export type StudioTab = { artifactId: string; openedAt: number };

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
      // Fair share when multiple panels compete: never let one lane take more
      // than ~46% of the host while another panel is open.
      const fairCap =
        siblingCount > 0
          ? Math.max(floor, Math.floor(hostWidth * 0.46))
          : maximum;
      const responsiveCap =
        siblingCount === 0 && hostWidth < 1920
          ? Math.max(floor, Math.floor(hostWidth * 0.5))
          : maximum;
      const next = Math.max(
        floor,
        Math.min(width, maximum, fairCap, responsiveCap),
      );
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
      className="relative z-40 flex h-full min-w-[280px] max-w-[94vw] shrink-0 border-l border-[color-mix(in_oklab,var(--border-default)_55%,transparent)] bg-[var(--bg-primary)] min-[1920px]:min-w-[300px]"
      style={{ width, containerType: "inline-size" }}
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
}) {
  const [shellSlot, setShellSlot] = useState<HTMLElement | null>(() =>
    typeof document === "undefined"
      ? null
      : document.getElementById("spectra-shell-tab-slot"),
  );
  useLayoutEffect(() => {
    setShellSlot(document.getElementById("spectra-shell-tab-slot"));
  }, []);

  const tabClass = (active: boolean) =>
    `group flex h-8 min-w-[120px] max-w-[220px] shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 text-[12px] font-medium transition ${
      active
        ? "border-[color-mix(in_oklab,var(--brand-primary)_36%,var(--border-default))] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_0_2px_var(--brand-primary),0_1px_6px_rgba(27,20,12,0.06)]"
        : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    }`;

  const rail = (
    <div
      className={`flex min-h-0 min-w-0 flex-1 items-center overflow-hidden ${shellSlot ? "h-full bg-transparent px-0" : "h-12 shrink-0 border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_60%,var(--bg-primary))] px-3.5"}`}
    >
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
