"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { openWorkInSide } from "@/features/spectra/components/side-open";
import type { SpectraArtifact } from "@/features/spectra/data/api";
import { useNear } from "./build";

/*
 * A work's own studio, set into the page the way an embed is set into a
 * document: the real editor with its workbar, editable, and "expand" opens it
 * beside the page.
 */

function Ghost() {
  return (
    <div className="landing-studio-ghost" role="status" aria-label="Opening">
      <Skeleton bar className="h-8 w-full" />
      <Skeleton bar className="h-5 w-2/3" />
      <Skeleton bar className="h-4 w-full" />
      <Skeleton bar className="h-4 w-5/6" />
    </div>
  );
}

const ArtifactStudio = dynamic(
  () =>
    import("@/features/spectra/components/artifact-studio").then(
      (module) => module.ArtifactStudio,
    ),
  {
    ssr: false,
    loading: () => <Ghost />,
  },
);

const noop = () => undefined;

export function InlineStudio({
  work,
  instanceKey,
  label = "Henry's Library",
  className,
  compact = true,
}: {
  work: SpectraArtifact;
  instanceKey: string;
  label?: string;
  className?: string;
  /** The studio's slim chrome; a board needs its full one to be drawn on. */
  compact?: boolean;
}) {
  const dirty = useMemo(() => new Set<string>(), []);
  const ref = useRef<HTMLDivElement>(null);
  // A studio is the heaviest thing on the page; it opens only as the reader nears it.
  const near = useNear(ref);
  return (
    <div
      ref={ref}
      className={className ?? "landing-studio"}
      data-work-type={work.blueprintKey}
    >
      {near ? (
        <ArtifactStudio
          key={work._id}
          mode="tab"
          compact={compact}
          instanceKey={instanceKey}
          artifact={work}
          artifacts={[work]}
          tabs={[]}
          dirtyIds={dirty}
          sourceLabel={label}
          onClose={noop}
          onCloseTab={noop}
          onExpand={() => openWorkInSide(work._id)}
          onActivateTab={noop}
          onDirtyChange={noop}
        />
      ) : (
        <Ghost />
      )}
    </div>
  );
}
