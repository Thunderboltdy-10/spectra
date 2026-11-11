"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { describeFailure } from "@/components/ui/truthful-state";
import { RotateCw } from "@/components/icons/glyph-icons";
import { getSpectraArtifact, type SpectraArtifact, type SpectraBlueprintKey } from "../data/api";
import { useLifeLanding, useLifeReturn } from "../life/use-life";
import { embedLifeKey } from "./artifact-embed";

/*
 * An embedded work edited where it is embedded (EDITORS.md, Embeds: "A
 * double-click edits it inline where the type allows"). The work's own studio
 * opens in the embed's frame, with its own workbar, history and sync, and folds
 * back into the preview when done.
 */

/** Works whose studio fits inside another work. Code and agents need the whole stage. */
export const EDITABLE_IN_PLACE: ReadonlySet<SpectraBlueprintKey> = new Set<SpectraBlueprintKey>([
  "document",
  "flashcard_deck",
  "quiz",
  "planner_task",
  "presentation",
  "sheets",
  "timetable",
  "whiteboard",
]);

function InlineGhost() {
  return (
    <div data-life-ghost className="spectra-embed-editor-ghost" aria-label="Opening the artifact here" role="status">
      <Skeleton bar className="h-8 w-full" />
      <Skeleton bar className="h-5 w-2/3" />
      <Skeleton bar className="h-4 w-full" />
      <Skeleton bar className="h-4 w-5/6" />
    </div>
  );
}

const ArtifactStudio = dynamic(
  () => import("./artifact-studio").then((module) => module.ArtifactStudio),
  { ssr: false, loading: () => <InlineGhost /> },
);

const noop = () => undefined;

type Loaded = { artifact: SpectraArtifact } | { error: string } | null;

export function InlineEmbedEditor({
  embedId,
  workId,
  onDone,
  onOpenFull,
  onDirtyChange,
}: {
  embedId: string;
  workId: string;
  /** Leave editing: the preview takes its place again. */
  onDone: () => void;
  /** Carry on in the work's own full view. */
  onOpenFull: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [attempt, setAttempt] = useState(0);
  const dirtyIds = useMemo(() => new Set<string>(), []);
  const key = embedLifeKey(embedId);
  // The preview's dots flow into the editor's frame, and back into the preview when it closes.
  useLifeLanding(frameRef, key);
  useLifeReturn(frameRef, key, "[data-embed-editor]");

  useEffect(() => {
    const request = new AbortController();
    getSpectraArtifact(workId, { signal: request.signal })
      .then(({ artifact }) => {
        if (!request.signal.aborted) setLoaded({ artifact });
      })
      .catch((error) => {
        if (request.signal.aborted) return;
        setLoaded({
          error: describeFailure(error, { fallback: "This artifact could not be opened here." }).message,
        });
      });
    return () => request.abort();
  }, [attempt, workId]);

  return (
    <div
      ref={frameRef}
      data-embed-editor=""
      className="spectra-embed-editor"
      onKeyDown={(event) => {
        // Escape leaves editing unless something inside used it (a menu, a dialog).
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onDone();
      }}
    >
      {loaded === null ? (
        <InlineGhost />
      ) : "error" in loaded ? (
        <div role="alert" className="spectra-embed-editor-failure">
          <p>{loaded.error}</p>
          <button
            type="button"
            onClick={() => {
              setLoaded(null);
              setAttempt((value) => value + 1);
            }}
          >
            <RotateCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      ) : (
        <ArtifactStudio
          mode="tab"
          compact
          instanceKey={embedId}
          artifact={loaded.artifact}
          artifacts={[loaded.artifact]}
          tabs={[]}
          dirtyIds={dirtyIds}
          sourceLabel="Embedded"
          onClose={onDone}
          onCloseTab={onDone}
          onExpand={onOpenFull}
          onActivateTab={noop}
          onDirtyChange={(_id, dirty) => onDirtyChange(dirty)}
        />
      )}
    </div>
  );
}
