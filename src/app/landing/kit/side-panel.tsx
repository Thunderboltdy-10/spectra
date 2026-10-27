"use client";

import { useEffect, useRef, useState } from "react";
import { ArtifactStudio } from "@/features/spectra/components/artifact-studio";
import type { SpectraArtifact } from "@/features/spectra/data/api";

/*
 * The side, as in Spectra: a work opened from the page (a card, a citation,
 * a run's result) opens beside it in its real studio, editable, and the island
 * moves over to make room, exactly as it does in the app.
 */

const noop = () => undefined;

export function SidePanel({
  work,
  works,
  onClose,
}: {
  work: SpectraArtifact | null;
  works: SpectraArtifact[];
  onClose: () => void;
}) {
  const [width, setWidth] = useState(640);
  const [dirty] = useState(() => new Set<string>());
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    setWidth(
      Math.round(Math.min(680, Math.max(380, window.innerWidth * 0.44))),
    );
  }, []);

  // The island and the page keep clear of the side while it is open.
  useEffect(() => {
    const root = document.documentElement;
    if (!work) {
      root.style.removeProperty("--spectra-side-width");
      return;
    }
    const node = ref.current;
    if (!node) return;
    const measure = () =>
      root.style.setProperty(
        "--spectra-side-width",
        `${Math.round(node.getBoundingClientRect().width)}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--spectra-side-width");
    };
  }, [work]);

  useEffect(() => {
    if (!work) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !ref.current?.contains(document.activeElement)
      )
        onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, work]);

  if (!work) return null;
  return (
    <aside ref={ref} className="landing-side" aria-label={work.title}>
      <ArtifactStudio
        key={work._id}
        mode="split"
        artifact={work}
        artifacts={works}
        tabs={[]}
        dirtyIds={dirty}
        panelWidth={width}
        sourceLabel="Henry's Library"
        onPanelWidthChange={setWidth}
        onClose={onClose}
        onCloseTab={onClose}
        onExpand={noop}
        onActivateTab={noop}
        onDirtyChange={noop}
      />
    </aside>
  );
}
