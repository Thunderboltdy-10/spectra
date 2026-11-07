"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { type IconName } from "@/components/icons";
import { X } from "@/components/icons/glyph-icons";
import { IconButton } from "@/components/ui/icon-button";
import { PanelHeader, PanelTabs } from "@/components/ui/side-panel";
import { transitionFor } from "../motion/grammar";
import { useSpectraMotion } from "../motion/motion-level";

/*
 * Everything about a piece of work that is not the work itself opens in one
 * pane, the same way for every type of work. A full work gives it room beside
 * the page; work held in a side panel takes it on top, so nothing moves.
 * Pressing another button changes what the pane shows and leaves the pane
 * where it is. A studio's own tools (a sheet's Format, a board's Layers) use
 * the same pane through `StudioToolPane`.
 */

export type StudioPaneKind = "about" | "comments" | "threads" | "references" | "history";

const PANES: Record<StudioPaneKind, { label: string; title: string; icon: IconName }> = {
  about: { label: "About", title: "About this work", icon: "info" },
  comments: { label: "Comments", title: "Comments", icon: "reply" },
  threads: { label: "Threads", title: "Threads about this work", icon: "conversations" },
  references: { label: "References", title: "References", icon: "link" },
  history: { label: "History", title: "Version history", icon: "activity" },
};

const STORE_KEY = "spectra.panel.studio-pane";
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 300;
/** What a full work keeps before the pane stops sitting beside it and goes on top instead. */
const STAGE_MIN = 560;

function readWidth() {
  try {
    const stored = Number(window.localStorage.getItem(STORE_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function writeWidth(width: number) {
  try {
    window.localStorage.setItem(STORE_KEY, String(width));
  } catch {
    /* A remembered width is a convenience. */
  }
}

type Tool = { id: string; title: string; icon?: IconName; close: () => void };

type ToolHost = {
  host: HTMLElement | null;
  claim: (tool: Tool) => void;
  release: (id: string) => void;
};

const ToolHostContext = createContext<ToolHost | null>(null);

export const StudioPaneToolProvider = ToolHostContext.Provider;

export type StudioPaneState = ReturnType<typeof useStudioPane>;

export function useStudioPane({
  surfaceRef,
  surface,
  kind,
  onKind,
  narrow = false,
}: {
  surfaceRef: RefObject<HTMLElement | null>;
  /** "full" gives the pane room beside the page; "panel" lays it on top. */
  surface: "full" | "panel";
  kind: StudioPaneKind | null;
  onKind: (kind: StudioPaneKind | null) => void;
  /** Keep to a smaller share of the surface, for a pane that has something open beside it. */
  narrow?: boolean;
}) {
  const [tool, setTool] = useState<Tool | null>(null);
  const toolRef = useRef<Tool | null>(null);
  toolRef.current = tool;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [stored, setStored] = useState(DEFAULT_WIDTH);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [resizing, setResizing] = useState(false);
  const onKindRef = useRef(onKind);
  onKindRef.current = onKind;

  useLayoutEffect(() => setStored(readWidth()), []);

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setSurfaceWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [surfaceRef]);

  const claim = useCallback((next: Tool) => {
    const current = toolRef.current;
    if (current && current.id !== next.id) current.close();
    toolRef.current = next;
    setTool(next);
    onKindRef.current(null);
  }, []);
  const release = useCallback((id: string) => {
    if (toolRef.current?.id !== id) return;
    toolRef.current = null;
    setTool(null);
  }, []);

  // Pressing one of the work's own buttons puts away whatever tool was showing.
  const lastKind = useRef(kind);
  useEffect(() => {
    if (kind === lastKind.current) return;
    lastKind.current = kind;
    if (!kind) return;
    toolRef.current?.close();
    toolRef.current = null;
    setTool(null);
  }, [kind]);

  const open = Boolean(kind || tool);
  const limit = surfaceWidth ? Math.max(MIN_WIDTH, surfaceWidth * (narrow ? 0.42 : 0.6)) : 720;
  const width = Math.round(Math.min(Math.max(stored, narrow ? Math.min(MIN_WIDTH, limit) : MIN_WIDTH), limit));
  const docked = surface === "full" && (!surfaceWidth || surfaceWidth - width >= STAGE_MIN);
  const pushes = open && docked;

  // The island keeps to what is left of the page.
  useEffect(() => {
    if (!pushes) return;
    const root = document.documentElement;
    root.style.setProperty("--spectra-side-width", `${width}px`);
    return () => void root.style.removeProperty("--spectra-side-width");
  }, [pushes, width]);

  const close = useCallback(() => {
    toolRef.current?.close();
    toolRef.current = null;
    setTool(null);
    onKindRef.current(null);
  }, []);

  const toolHost = useMemo(() => ({ host, claim, release }), [claim, host, release]);

  return {
    open,
    kind,
    tool,
    width,
    docked,
    resizing,
    limit,
    /** No room beside the pane: a version on show takes the whole surface. */
    stageFills: Boolean(surfaceWidth) && surfaceWidth - width < 420,
    toolHost,
    close,
    setHost,
    setResizing,
    setStored,
    /** Spread on the surface: a pane beside the page takes its room from here. */
    surfaceProps: {
      "data-pane": open ? (docked ? "beside" : "over") : undefined,
      "data-pane-resizing": resizing || undefined,
    },
    surfaceStyle: { paddingRight: pushes ? width : 0 } as CSSProperties,
  };
}

export function StudioPane({
  pane,
  kinds,
  onKind,
  children,
}: {
  pane: StudioPaneState;
  /** The buttons along the top of the pane. */
  kinds: readonly StudioPaneKind[];
  onKind: (kind: StudioPaneKind) => void;
  children: ReactNode;
}) {
  const motionLevel = useSpectraMotion();
  const { kind, tool, open, width, docked, limit } = pane;
  const shown = kind ? PANES[kind] : null;
  const title = tool?.title ?? shown?.title ?? "";
  const icon = tool?.icon ?? shown?.icon;

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    pane.setResizing(true);
    let last = startWidth;
    const move = (moved: PointerEvent) => {
      last = Math.round(Math.min(Math.max(startWidth + startX - moved.clientX, MIN_WIDTH), limit));
      pane.setStored(last);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      pane.setResizing(false);
      writeWidth(last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          key="studio-pane"
          data-studio-pane={kind ?? tool?.id}
          data-docked={docked || undefined}
          aria-label={title}
          className="studio-pane"
          style={{ width }}
          initial={motionLevel.disabled ? false : { x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={motionLevel.disabled ? undefined : { x: 40, opacity: 0 }}
          transition={motionLevel.disabled ? undefined : transitionFor("morph", motionLevel.level)}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize this pane"
            aria-valuenow={width}
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={Math.round(limit)}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={(event) => {
              const by = event.key === "ArrowLeft" ? 16 : event.key === "ArrowRight" ? -16 : 0;
              if (!by) return;
              event.preventDefault();
              const next = Math.round(Math.min(Math.max(width + by, MIN_WIDTH), limit));
              pane.setStored(next);
              writeWidth(next);
            }}
            className="studio-pane-grip"
          />
          <PanelHeader
            title={title}
            icon={icon}
            control={<IconButton icon={<X className="size-4" />} label="Close this pane" size="compact" onClick={pane.close} />}
          >
            {kind && kinds.length > 1 ? (
              <PanelTabs
                label="About this work"
                tabs={kinds.map((id) => ({ id, label: PANES[id].label, icon: PANES[id].icon }))}
                value={kind}
                onChange={(id) => onKind(id as StudioPaneKind)}
              />
            ) : null}
          </PanelHeader>
          {/* What it shows changes in place: the pane itself does not come and go. */}
          {kind ? (
            <motion.div
              key={kind}
              className="studio-pane-body"
              initial={motionLevel.disabled ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={motionLevel.disabled ? undefined : transitionFor("reveal", motionLevel.level)}
            >
              {children}
            </motion.div>
          ) : (
            <div ref={pane.setHost} className="studio-pane-body studio-pane-tool" />
          )}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * A studio's own side tool, drawn in the work's one pane so it opens, sizes and
 * gives way like everything else there. Outside a studio (a test, an embedded
 * copy) it simply renders where it is.
 */
export function StudioToolPane({
  id,
  title,
  icon,
  onClose,
  children,
}: {
  id: string;
  title: string;
  icon?: IconName;
  onClose: () => void;
  children: ReactNode;
}) {
  const context = useContext(ToolHostContext);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const claim = context?.claim;
  const release = context?.release;
  useEffect(() => {
    claim?.({ id, title, icon, close: () => closeRef.current() });
  }, [claim, icon, id, title]);
  useEffect(() => () => release?.(id), [id, release]);
  if (!context) return <aside aria-label={title}>{children}</aside>;
  return context.host ? createPortal(children, context.host) : null;
}
