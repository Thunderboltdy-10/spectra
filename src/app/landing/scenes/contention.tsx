"use client";

/**
 * Scene 5 — contention, resolved.
 *
 * Two AIs reach for the same cell at the same moment. This is the scene that
 * cannot be faked, so it is not: the guard running here is the product's own
 * `useHeldControlGuard`, fed the story's own presence frames. It writes
 * `data-spectra-held` onto the exact cell, the product's own stylesheet draws
 * the busy affordance, and the actor who lost the race is published as
 * `blocked` and then `queued` rather than being quietly dropped.
 *
 * The claim the scene makes is narrow and true: one control is busy, everything
 * around it stays live, and nobody is ever shown a merge dialog.
 */

import { useMemo, useRef } from "react";
import { SheetsStudio } from "@/features/spectra/components/sheets-studio";
import { useHeldControlGuard } from "@/features/spectra/collaboration/held-controls";
import { SceneRegion } from "../story/scene-region";
import { Body, Chip, Headline, Marker, Plate, useSceneT } from "../story/scene-kit";
import { statesAt, type Beat } from "../story/beats";
import { CONTESTED_CELL, FIELD_DATA, SOURCES } from "../story/work";

export const CONTENTION_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.02,
    to: 0.1,
    path: "contention/marker",
    primitive: "richtext",
    act: { kind: "type", text: "When two reach at once" },
  },
  {
    actor: "spectra",
    from: 0.1,
    to: 0.2,
    path: "contention/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "Two hands," },
  },
  {
    actor: "spectra",
    from: 0.2,
    to: 0.31,
    path: "contention/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "one cell." },
  },

  /* Spectra gets there first, and a caret in a cell is a real claim. */
  {
    actor: "spectra",
    from: 0.32,
    to: 0.62,
    path: CONTESTED_CELL,
    part: "value",
    primitive: "gridCell",
    label: "Biomass, pond margin",
    act: { kind: "select", from: 0, to: 3 },
    note: "Correcting the remeasured plot",
  },

  /* Pablo's AI arrives a beat later and is refused the control, not the
     artifact. `blocked` is the honest lifecycle: present, resolving, waiting. */
  {
    actor: "pabloAi",
    from: 0.38,
    to: 0.6,
    path: CONTESTED_CELL,
    primitive: "gridCell",
    label: "Biomass, pond margin",
    act: { kind: "wait" },
    lifecycle: "blocked",
    note: "Waiting for the cell",
  },
  {
    actor: "pabloAi",
    from: 0.6,
    to: 0.66,
    path: CONTESTED_CELL,
    primitive: "gridCell",
    act: { kind: "wait" },
    lifecycle: "queued",
    note: "Next in line",
  },

  /* The moment Spectra settles, the queued actor proceeds. Nothing was lost
     and nothing had to be merged. */
  {
    actor: "pabloAi",
    from: 0.66,
    to: 0.8,
    path: CONTESTED_CELL,
    part: "value",
    primitive: "gridCell",
    label: "Biomass, pond margin",
    act: { kind: "type", text: "5.4" },
    note: "Applying its correction",
  },
  {
    actor: "pablo",
    from: 0.72,
    to: 0.82,
    path: "/sheets/0/cells/A2",
    primitive: "gridCell",
    label: "Woodland edge",
    act: { kind: "select", from: 0, to: 13 },
    note: "Working elsewhere, unaffected",
  },
  {
    actor: "spectra",
    from: 0.82,
    to: 0.98,
    path: "contention/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "The cell that is busy says so. Every other cell in the sheet stays live, and the one who waited still gets their turn.",
    },
  },
];

export function ContentionScene() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const t = useSceneT("contention");

  /* The same frames the presence layer draws are the frames the guard reads.
     One source of truth, so the cursor and the affordance can never disagree
     about who is holding what. */
  const states = useMemo(() => statesAt(CONTENTION_BEATS, t, 0), [t]);
  const held = useHeldControlGuard({ states, surfaceRef });
  const holder = held.get(CONTESTED_CELL);

  /* Whoever is waiting, in their own words. Not a label invented for the
     landing: the product's own explanation string. */
  const waiting = useMemo(
    () =>
      states.find(
        (state) =>
          state.lifecycle === "blocked" || state.lifecycle === "queued",
      ),
    [states],
  );

  const content = useMemo(() => FIELD_DATA, []);
  const source = SOURCES[2]!;

  return (
    <SceneRegion scene="contention">
      <div className="relative h-full">
        <div className="absolute left-0 top-[18px] w-[318px]">
          <Marker
            beats={CONTENTION_BEATS}
            scene="contention"
            path="contention/marker"
          />
          <Headline
            beats={CONTENTION_BEATS}
            scene="contention"
            size="support"
            paths={["contention/line-1", "contention/line-2"]}
            className="mt-4"
          />
          <Body
            beats={CONTENTION_BEATS}
            scene="contention"
            path="contention/body"
            className="mt-6"
          />

          {/* The state of the race, in the product's own vocabulary. It exists
              only while somebody is genuinely waiting. */}
          <div
            className="mt-7 flex min-h-[26px] flex-wrap items-center gap-2"
            data-present={waiting ? "true" : "false"}
            style={{
              opacity: waiting ? 1 : 0,
              transition: "opacity var(--motion-base) var(--ease-standard)",
            }}
          >
            {holder ? (
              <Chip tone="violet" dot>
                {holder.label} is editing C4
              </Chip>
            ) : null}
            {waiting ? (
              <Chip>
                {waiting.lifecycle === "queued" ? "Next in line" : "Waiting"}
              </Chip>
            ) : null}
          </div>
        </div>

        {/* The real workbook. It is the same live sheet the revision document
            cites as its third source, so contention happens over data the page
            has already told the visitor about. */}
        <div ref={surfaceRef} className="absolute right-0 top-[10px] w-[520px]">
          <Plate
            scene="contention"
            path="contention/sheet"
            title={source.label}
            meta={source.kind}
            trailing={<Chip tone="mint" dot>Live</Chip>}
            style={{ height: 452 }}
            radius={1}
          >
            <SheetsStudio
              artifactId="src-dataset"
              content={content}
              onChange={() => undefined}
              readOnly
              mode="split"
              syncMessage="Auto-saved"
            />
          </Plate>
        </div>
      </div>
    </SceneRegion>
  );
}
