"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { FileQuestion, Loader2, Search } from "@/components/icons/glyph-icons";
import { describeFailure } from "@/components/ui/truthful-state";
import { toast } from "@/components/ui/toast";
import type { SpectraArtifact } from "../data/api";
import type { ArtifactTypeKey } from "../artifacts/types";
import type { CompatibilityProfile } from "../commands/types";
import { workTypeMeta } from "./artifact-card";
import { workCardStyle } from "./work-card";
import { rankEmbedCandidates } from "./embed-candidates";
import { useAddReference } from "./use-add-reference";
import { useRelated, useSemanticSearch } from "../semantic/use-semantic";
import type { SemanticAnchor } from "../../../../shared/semantic-types";
import { useSpectraMotion } from "../motion/motion-level";
import { transitionFor } from "../motion/grammar";

const SHOWN = 8;
const WIDTH = 380;
const GAP = 8;

/** A search or related hit names its work by the anchor; other kinds never match a work id. */
function workIdOf(result: { itemId: string; anchor: SemanticAnchor }) {
  return result.anchor.kind === "artifact" ? result.anchor.artifactId : result.itemId;
}

/**
 * "/ Reference" in a page: a small search at the caret. Typing narrows the
 * work (related and recent first, then what the words find); Enter or a click
 * sets the chosen work into the page right there, live and usable. How it
 * shows is changed afterwards from the embed's own menu, so choosing is one
 * step and nothing else on screen moves or dims.
 */
export function InlineReferencePicker({
  at,
  stackOnto,
  containerId,
  containerWorkType,
  compatibilityProfile,
  artifacts,
  onClose,
}: {
  at: { x: number; y: number };
  /** Lay the chosen work on this embed's card as a tab, rather than as a card of its own. */
  stackOnto?: string;
  containerId: string;
  containerWorkType?: ArtifactTypeKey;
  compatibilityProfile?: CompatibilityProfile;
  artifacts: SpectraArtifact[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>({ left: at.x, top: at.y + GAP });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const motionLevel = useSpectraMotion();
  const addReference = useAddReference({ containerId, containerWorkType, compatibilityProfile });
  const semantic = useSemanticSearch(query, { kinds: ["artifact"], limit: 20, openItemIds: [containerId] });
  const related = useRelated(containerId, { limit: 12 });
  const candidates = useMemo(
    () =>
      rankEmbedCandidates({
        artifacts,
        containerId,
        query,
        searchIds: semantic.results.map(workIdOf),
        relatedIds: related.results.map(workIdOf),
      }).slice(0, SHOWN),
    [artifacts, containerId, query, semantic.results, related.results],
  );
  const searching = semantic.status === "loading" && candidates.length === 0;

  // Below the caret when it fits, above it when it does not; always on screen.
  useLayoutEffect(() => {
    const height = rootRef.current?.offsetHeight ?? 320;
    const left = Math.max(12, Math.min(at.x - 18, window.innerWidth - WIDTH - 12));
    const below = at.y + GAP;
    const top = below + height > window.innerHeight - 12 ? Math.max(12, at.y - 28 - GAP - height) : below;
    setPlace({ left, top });
  }, [at.x, at.y, candidates.length]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [onClose]);

  async function choose(source: SpectraArtifact | undefined) {
    if (!source || adding) return;
    setAdding(source._id);
    try {
      await addReference(source, { stackOnto });
      onClose();
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "Could not add this reference." }).message);
      setAdding(null);
    }
  }

  return createPortal(
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-label="Add a reference"
      className="inline-reference-picker"
      style={{ left: place.left, top: place.top, width: WIDTH }}
      initial={motionLevel.disabled ? false : { opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={motionLevel.disabled ? undefined : transitionFor("reveal", motionLevel.level)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((value) => Math.min(candidates.length - 1, value + 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((value) => Math.max(0, value - 1));
        } else if (event.key === "Enter") {
          event.preventDefault();
          void choose(candidates[active]);
        }
      }}
    >
      <label className="inline-reference-search">
        <Search className="size-4" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find work to show here"
          aria-label="Find work to show here"
          role="combobox"
          aria-expanded="true"
          aria-controls="inline-reference-results"
          aria-activedescendant={candidates[active] ? `inline-reference-${candidates[active]._id}` : undefined}
        />
      </label>
      <ul id="inline-reference-results" role="listbox" className="inline-reference-results">
        {candidates.map((artifact, index) => {
          const meta = workTypeMeta[artifact.blueprintKey as ArtifactTypeKey];
          const Icon = meta?.icon ?? FileQuestion;
          return (
            <li
              key={artifact._id}
              id={`inline-reference-${artifact._id}`}
              role="option"
              aria-selected={index === active}
              data-active={index === active || undefined}
              style={workCardStyle(artifact.blueprintKey)}
              onPointerEnter={() => setActive(index)}
              onClick={() => void choose(artifact)}
            >
              <span className="inline-reference-icon">
                {adding === artifact._id ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
              </span>
              <span className="inline-reference-name">{artifact.title || "Untitled"}</span>
              <span className="inline-reference-kind">{meta?.label}</span>
            </li>
          );
        })}
        {candidates.length === 0 ? (
          <li className="inline-reference-none">{searching ? "Looking…" : "Nothing matches. Try other words."}</li>
        ) : null}
      </ul>
    </motion.div>,
    document.body,
  );
}
