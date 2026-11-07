"use client";

import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { Folder } from "@/components/icons/glyph-icons";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { api } from "../../../../convex/_generated/api";
import type { SpectraArtifact } from "../data/api";
import { spectraShellHref } from "../pages/shell-location";
import { artifactPlacements } from "./spectra-view-model";

/*
 * Where a work is kept, as a place you can go to. Asked once per placement and
 * remembered for the sitting: a moved work corrects itself when it is reopened,
 * and an open page never holds a live subscription just for this line.
 */

export type WorkPlace = { key: string; segments: string[]; href: string };

const known = new Map<string, Promise<{ id: string; title: string }[] | null>>();
const AFTER_MS = 5 * 60_000;

function remember(nodeId: string, ask: () => Promise<{ id: string; title: string }[] | null>) {
  const held = known.get(nodeId);
  if (held) return held;
  const asked = ask().catch(() => {
    known.delete(nodeId);
    return null;
  });
  known.set(nodeId, asked);
  window.setTimeout(() => known.delete(nodeId), AFTER_MS);
  return asked;
}

export function useWorkPlaces(work: SpectraArtifact): WorkPlace[] {
  const convex = useConvex();
  const placements = artifactPlacements(work);
  const key = placements.map((placement) => placement.nodeId).join("|");
  const [paths, setPaths] = useState<Record<string, { id: string; title: string }[]>>({});

  useEffect(() => {
    let current = true;
    for (const placement of placements) {
      if (!placement.nodeId) continue;
      void remember(placement.nodeId, async () => {
        const path = await convex.query(api.orgTree.path, { nodeId: placement.nodeId });
        return path ? [...path.ancestors, path.node].filter((node) => node.kind !== "work").map((node) => ({ id: String(node.nodeId), title: node.name })) : null;
      }).then((ancestors) => {
        if (current && ancestors) setPaths((was) => ({ ...was, [placement.nodeId]: ancestors }));
      });
    }
    return () => {
      current = false;
    };
    // `key` stands for the placements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convex, key]);

  return placements.map((placement) => {
    const ancestors = paths[placement.nodeId] ?? [];
    const last = ancestors.at(-1);
    return {
      key: placement.nodeId,
      segments: ancestors.length ? ancestors.map((node) => node.title) : [placement.workspaceTitle],
      href: last
        ? spectraShellHref({ surface: "library", nodeId: last.id })
        : spectraShellHref({ surface: "library", workspaceId: placement.workspaceId }),
    };
  });
}

function PlacePath({ segments }: { segments: readonly string[] }) {
  return (
    <span className="work-origin-path">
      {segments.map((segment, index) => (
        <span key={`${index}:${segment}`}>
          {index ? <span aria-hidden className="work-origin-slash">/</span> : null}
          {segment}
        </span>
      ))}
    </span>
  );
}

/** Goes to one place a work is kept. */
export function WorkPlaceLink({ place, className }: { place: WorkPlace; className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className ?? "work-origin"}
      title={`Open ${place.segments.join(" / ")}`}
      onClick={() => router.push(place.href)}
    >
      <Folder className="size-3.5 shrink-0" />
      <PlacePath segments={place.segments} />
    </button>
  );
}

/** The line under a work's description. */
export function WorkOrigin({ work }: { work: SpectraArtifact }) {
  const router = useRouter();
  const places = useWorkPlaces(work);
  const first = places[0];
  if (first)
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <WorkPlaceLink place={first} />
        {places.length > 1 ? <span className="shrink-0 text-micro text-[var(--text-tertiary)]">and {places.length - 1} more</span> : null}
      </div>
    );
  if (work.ownership === "shared")
    return (
      <p className="work-origin" data-still>
        <Folder className="size-3.5 shrink-0" />
        Shared with you{work.owner?.name ? ` by ${work.owner.name}` : ""}
      </p>
    );
  return (
    <button type="button" className="work-origin" onClick={() => router.push(spectraShellHref({ surface: "library" }))}>
      <Folder className="size-3.5 shrink-0" />
      Your library
    </button>
  );
}
