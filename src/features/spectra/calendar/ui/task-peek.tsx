"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/components/icons";
import { describeFailure } from "@/components/ui/truthful-state";
import { getSpectraArtifact, type SpectraArtifact } from "../../data/api";

/*
 * A task, edited where it sits on the calendar (CALENDAR.md, "Peek"): resting
 * on a task opens it beside the block, in its own task view, so its date, its
 * checklist, its notes and done change right there. Pressing the block opens
 * it whole, for the rarer things (repeating, reminders, the work it is for).
 */

const ArtifactStudio = dynamic(
  () => import("../../components/artifact-studio").then((module) => module.ArtifactStudio),
  { ssr: false, loading: () => <PeekGhost /> },
);

function PeekGhost() {
  return (
    <div data-life-ghost className="task-peek-ghost" role="status" aria-label="Opening the task">
      <Skeleton bar className="h-7 w-3/4" />
      <Skeleton bar className="h-4 w-1/2" />
      <Skeleton bar className="mt-4 h-4 w-full" />
    </div>
  );
}

const WIDTH = 440;
const GAP = 10;
const EDGE = 12;
/** The island and its tabs keep the foot of the window; the card stays above them. */
const ISLAND_CLEARANCE = 128;
const noop = () => undefined;

/** Beside the block, on whichever side has room, kept inside the window and above the island. */
function placeBeside(anchor: DOMRect, height: number) {
  const right = anchor.right + GAP + WIDTH <= window.innerWidth - EDGE;
  const left = right ? anchor.right + GAP : Math.max(EDGE, anchor.left - GAP - WIDTH);
  const floor = window.innerHeight - ISLAND_CLEARANCE;
  const maxHeight = Math.min(560, floor - EDGE);
  const top = Math.min(Math.max(EDGE, anchor.top - EDGE), Math.max(EDGE, floor - Math.min(height, maxHeight)));
  return { left, top, maxHeight, origin: right ? "left top" : "right top" };
}

type Loaded = { artifact: SpectraArtifact } | { error: string } | null;

export function TaskPeek({
  anchor,
  resolveWork,
  onOpenFull,
  onPointerEnter,
  onPointerLeave,
  onClose,
}: {
  anchor: DOMRect;
  /** The task work behind the block (made now, for a school task sync has not reached). */
  resolveWork: () => Promise<string | null>;
  onOpenFull: (workId: string) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [height, setHeight] = useState(260);
  const dirtyIds = useMemo(() => new Set<string>(), []);
  const resolve = useRef(resolveWork);
  resolve.current = resolveWork;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const request = new AbortController();
    void resolve
      .current()
      .then((workId) => (workId ? getSpectraArtifact(workId, { signal: request.signal }) : null))
      .then((found) => {
        if (request.signal.aborted) return;
        // A school task with no work yet, while ManageBac is not connected, has nothing to open beside it.
        if (!found) close.current();
        else setLoaded({ artifact: found.artifact });
      })
      .catch((error) => {
        if (!request.signal.aborted) setLoaded({ error: describeFailure(error, { fallback: "This task could not be opened here." }).message });
      });
    return () => request.abort();
  }, []);

  // The card follows its own height, so a longer checklist never runs off the window.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => setHeight(card.offsetHeight));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node;
      // Menus the task opens (the due picker) live in their own layer; pressing in them is still the card.
      if (cardRef.current?.contains(target) || (target as Element).closest?.("[data-radix-popper-content-wrapper], [role=dialog], [role=menu], [role=listbox]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, [onClose]);

  const { left, top, maxHeight, origin } = placeBeside(anchor, height);
  const artifact = loaded && "artifact" in loaded ? loaded.artifact : null;

  return createPortal(
    <div
      ref={cardRef}
      className="task-peek spectra-float"
      style={{ left, top, width: WIDTH, ["--peek-max" as string]: `${maxHeight}px`, ["--peek-origin" as string]: origin }}
      role="dialog"
      aria-label={artifact ? `Task: ${artifact.title}` : "Task"}
      onPointerEnter={onPointerEnter}
      // Typing in it keeps it open wherever the pointer goes; pressing outside or Escape closes it.
      onPointerLeave={() => {
        if (!cardRef.current?.contains(document.activeElement)) onPointerLeave();
      }}
    >
      {loaded === null ? (
        <PeekGhost />
      ) : "error" in loaded ? (
        <p role="alert" className="task-peek-failure">
          {loaded.error}
        </p>
      ) : (
        <div className="task-peek-body">
          <ArtifactStudio
            mode="tab"
            compact
            instanceKey={`peek:${loaded.artifact._id}`}
            artifact={loaded.artifact}
            artifacts={[loaded.artifact]}
            tabs={[]}
            dirtyIds={dirtyIds}
            sourceLabel="Calendar"
            onClose={onClose}
            onCloseTab={onClose}
            onExpand={() => onOpenFull(loaded.artifact._id)}
            onActivateTab={noop}
            onDirtyChange={noop}
          />
        </div>
      )}
      {artifact ? (
        <footer className="task-peek-foot">
          <button type="button" className="task-peek-full" onClick={() => onOpenFull(artifact._id)}>
            <Icon name="expand" size={14} />
            Open the whole task
          </button>
        </footer>
      ) : null}
    </div>,
    document.body,
  );
}
