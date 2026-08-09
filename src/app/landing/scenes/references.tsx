"use client";

/**
 * Scene 8 — a reference is a relationship, not a copy.
 *
 * The revision document embeds the field data. Not a screenshot of it, not a
 * pasted table: the product's real `ArtifactEmbed`, holding a live version
 * policy, which means the number in the document is the number in the sheet.
 *
 * The scene then does the thing a marketing page would never do: it shows the
 * embed being refused. A source you have no access to renders as a locked
 * reference that exposes no title and no preview, and the honest way to get in
 * is to ask. That refusal is the most trustworthy thing on this page.
 */

import { useMemo } from "react";
import { ArtifactEmbed } from "@/features/spectra/components/artifact-embed";
import { SpectraRichContent } from "@/features/spectra/components/spectra-rich-content";
import type { SpectraArtifactEmbed } from "@/features/spectra/data/api";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import {
  Body,
  Carried,
  Chip,
  Headline,
  Marker,
  Plate,
  useSceneT,
} from "../story/scene-kit";
import { type Beat } from "../story/beats";
import { FIXTURE_TIME, SOURCES, VERIFIED_SOURCE_IDS } from "../story/work";

export const REFERENCES_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.02,
    to: 0.1,
    path: "references/marker",
    primitive: "richtext",
    act: { kind: "type", text: "Sources, attached" },
  },
  {
    actor: "spectra",
    from: 0.1,
    to: 0.21,
    path: "references/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "A reference is" },
  },
  {
    actor: "spectra",
    from: 0.21,
    to: 0.33,
    path: "references/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "a relationship." },
  },

  {
    actor: "pabloAi",
    from: 0.3,
    to: 0.44,
    path: "references/embed",
    primitive: "canvasObject",
    label: "Ecosystem field data",
    act: { kind: "drag", to: "references/document" },
    note: "Embedding the live sheet",
  },
  {
    actor: "pabloAi",
    from: 0.46,
    to: 0.56,
    path: "references/embed/mode",
    primitive: "button",
    label: "Expand",
    act: { kind: "press" },
    note: "Showing the numbers inline",
  },

  /* The refusal. It is a real state of the real component, so it is shown. */
  {
    actor: "pablo",
    from: 0.58,
    to: 0.7,
    path: "references/locked",
    primitive: "canvasObject",
    label: "Class results, 2026",
    act: { kind: "drag", to: "references/document" },
    note: "Pulling in a shared set",
  },
  {
    actor: "pablo",
    from: 0.72,
    to: 0.82,
    path: "references/locked/request",
    primitive: "button",
    label: "Request access",
    act: { kind: "press" },
    note: "Asking the owner",
  },
  {
    actor: "spectra",
    from: 0.82,
    to: 0.98,
    path: "references/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "A source you cannot see stays unreadable, and says so. No title, no preview, no quiet leak. Ask, and it unlocks itself when the owner agrees.",
    },
  },
];

/** The excerpt the document cites, with a real citation in it. */
const CITED = `Net primary productivity varies by more than a factor of four across the four plots, and the pond margin sits close to the mean once the storm remeasurement is applied [[cite:src-dataset:span-11|Field plots]].`;

function embedOf(input: {
  mode: "compact" | "expanded";
  state: SpectraArtifactEmbed["state"];
  requested?: boolean;
}): SpectraArtifactEmbed {
  const locked = input.state === "no_access";
  return {
    embedId: locked ? "embed-locked" : "embed-data",
    containerType: "artifact",
    containerId: "work-ecosystems",
    containerRegionId: "region-data",
    mode: input.mode,
    interaction: "read",
    effectiveInteraction: "read",
    versionPolicy: "live",
    contextPolicy: "visible_region",
    canConfigure: false,
    state: input.state,
    canRequestAccess: locked && !input.requested,
    ...(locked && input.requested
      ? {
          accessRequest: {
            requestId: "req-1",
            status: "pending" as const,
            createdAt: FIXTURE_TIME.updated,
          },
        }
      : {}),
    ...(locked
      ? {}
      : {
          source: {
            artifactId: "src-dataset",
            title: SOURCES[2]!.label,
            summary: "Four plots, light against biomass, remeasured Thursday.",
            blueprintKey: "sheet",
            updatedAt: FIXTURE_TIME.updated,
            tags: ["Biology", "Field work"],
          },
        }),
  };
}

export function ReferencesScene() {
  const t = useSceneT("references");

  const live = useMemo(
    () =>
      embedOf({
        mode: t >= 0.56 ? "expanded" : "compact",
        state: "ready",
      }),
    [t],
  );

  const locked = useMemo(
    () => embedOf({ mode: "compact", state: "no_access", requested: t >= 0.82 }),
    [t],
  );

  return (
    <SceneRegion scene="references">
      <div className="relative h-full">
        <div className="flex items-start gap-16">
          <div className="w-[340px] shrink-0 pt-[10px]">
            <Marker
              beats={REFERENCES_BEATS}
              scene="references"
              path="references/marker"
            />
            <Headline
              beats={REFERENCES_BEATS}
              scene="references"
              size="support"
              paths={["references/line-1", "references/line-2"]}
              className="mt-4"
            />
            <Body
              beats={REFERENCES_BEATS}
              scene="references"
              path="references/body"
              className="mt-6"
            />

            {/* The three sources, and what is actually known about each. The
                third is deliberately not "verified": it is live, which is a
                different and more useful claim. */}
            <ul className="mt-8 space-y-0 border-t border-[var(--border-subtle)]">
              {SOURCES.map((source, index) => (
                <li
                  key={source.id}
                  className="flex items-center gap-3 border-b border-[var(--border-subtle)] py-2.5"
                  style={{
                    opacity: t >= 0.34 + index * 0.04 ? 1 : 0,
                    transform: `translate3d(0, ${
                      t >= 0.34 + index * 0.04 ? 0 : 4
                    }px, 0)`,
                    transition:
                      "opacity var(--motion-slow) var(--ease-standard), transform var(--motion-slow) var(--ease-out-expo)",
                  }}
                >
                  <span className="flex-1 text-[14px] leading-[1.5] text-[var(--text-secondary)]">
                    {source.label}
                  </span>
                  <Chip
                    tone={source.state === "live" ? "mint" : "cyan"}
                    dot={source.state === "live"}
                  >
                    {source.state === "live" ? "Live" : "Verified"}
                  </Chip>
                </li>
              ))}
            </ul>
          </div>

          {/* The document, holding its references. */}
          <div className="flex-1">
            <Plate
              scene="references"
              path="references/document"
              title="Ecosystems revision notes"
              meta="Document"
              trailing={<Chip tone="violet">2 references</Chip>}
              style={{ minHeight: 640 }}
            >
              <div className="flex flex-col gap-4 px-6 py-5">
                <SpectraRichContent
                  content={CITED}
                  verifiedSourceIds={VERIFIED_SOURCE_IDS}
                  className="text-[15px] leading-[1.72]"
                />

                <Carried
                  beats={REFERENCES_BEATS}
                  scene="references"
                  path="references/embed"
                  from={[420, -60]}
                >
                  <div
                    {...targetAttrs(
                      "references/embed",
                      undefined,
                      "canvasObject",
                    )}
                  >
                    <ArtifactEmbed embed={live} />
                  </div>
                </Carried>

                <p className="text-[15px] leading-[1.72] text-[var(--text-secondary)]">
                  The class set would let the same figures be compared across
                  every group, if it were shared.
                </p>

                <Carried
                  beats={REFERENCES_BEATS}
                  scene="references"
                  path="references/locked"
                  from={[380, 120]}
                >
                  <div
                    {...targetAttrs(
                      "references/locked",
                      undefined,
                      "canvasObject",
                    )}
                  >
                    <ArtifactEmbed embed={locked} />
                  </div>
                </Carried>
              </div>
            </Plate>
          </div>
        </div>
      </div>
    </SceneRegion>
  );
}
