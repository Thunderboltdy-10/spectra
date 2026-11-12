"use client";

import { useArtifactAiActivity } from "../collaboration/artifact-ai-activity";
import { describeFailure } from "@/components/ui/truthful-state";
import { useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { useCalmQuery } from "../data/use-calm-query";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { getSpectraArtifactVersions, type SpectraArtifactEmbed } from "../data/api";
import { spectraBus } from "../events";
import { launchFrom } from "../life/use-life";
import { ArtifactEmbed, embedLifeKey } from "./artifact-embed";
import { EDITABLE_IN_PLACE, InlineEmbedEditor } from "./artifact-embed-inline";

function openSource(artifactId: string) {
  spectraBus.command("work.open", { workId: artifactId, surface: "panel" });
}

export function useArtifactEmbedContainer(
  containerType: "artifact" | "thread",
  containerId: string,
  enabled = true,
) {
  return useCalmQuery(
    api.artifactEmbeds.listForContainer,
    enabled && containerId ? { containerType, containerId } : "skip",
    { peekMs: 15_000 },
  ) as { embeds: SpectraArtifactEmbed[]; canConfigure: boolean } | undefined;
}

/** Whether this reader can edit the embedded work where it is (live, theirs to change, a type that fits). */
export function editableInPlace(embed: SpectraArtifactEmbed) {
  return Boolean(
    embed.state === "ready" &&
      embed.versionPolicy === "live" &&
      !embed.sourceUnavailable &&
      !embed.keptOn &&
      embed.canEditSource &&
      embed.source &&
      EDITABLE_IN_PLACE.has(embed.source.blueprintKey),
  );
}

export function ArtifactEmbedById({
  embedId,
  className,
  onOpenSource = openSource,
  onRemove,
  editInPlace = false,
  tabs,
  onStackAnother,
  onUnstack,
}: {
  embedId: string;
  className?: string;
  onOpenSource?: (artifactId: string) => void;
  onRemove?: () => void;
  /** The host is an editor: the embedded work can be edited here too. */
  editInPlace?: boolean;
  /** A stacked card's tabs, in place of the one work's own. */
  tabs?: ReactNode;
  /** Lay another work on this card, from a picker beside it. */
  onStackAnother?: (anchor: Element | null) => void;
  /** Take the work shown out of its stack, onto a card of its own. */
  onUnstack?: () => void;
}) {
  const projection = useQuery(api.artifactEmbeds.getProjection, {
    embedId: embedId as Id<"artifactEmbeds">,
  }) as SpectraArtifactEmbed | null | undefined;
  // While Spectra works on the source, the card keeps its last settled face and
  // refreshes once when the work is done.
  const sourceBusy = Boolean(useArtifactAiActivity(projection?.source?.artifactId ?? ""));
  const settled = useRef(projection);
  if (!sourceBusy && projection !== undefined) settled.current = projection;
  const embed = sourceBusy && settled.current ? settled.current : projection;
  const update = useMutation(api.artifactEmbeds.update);
  const remove = useMutation(api.artifactEmbeds.remove);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);

  if (embed === undefined)
    return (
      <div data-life-ghost
        className={`min-h-24 animate-pulse rounded-card border border-[var(--border-subtle)] bg-[var(--bg-secondary)] motion-reduce:animate-none ${className ?? ""}`}
        aria-label="Loading live reference"
      />
    );

  if (embed === null)
    return (
      <div className={className}>
        {/* A stacked card keeps its tabs, so the reader can turn to a work that is still there. */}
        {tabs ? <div className="work-embed-top">{tabs}</div> : null}
        <div
          className="flex items-center gap-3 rounded-card border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] px-4 py-3 text-micro text-[var(--text-secondary)]"
          role="status"
          aria-label="Reference unavailable"
        >
          <span className="flex-1">This reference is no longer available.</span>
          {onRemove ? (
            <button type="button" onClick={onRemove} className="today-link shrink-0">
              Remove from page
            </button>
          ) : null}
        </div>
      </div>
    );

  const workId = embed.source?.artifactId;
  // Editing stops by itself when the embed stops being editable here (pinned,
  // archived, access changed): its preview says why.
  const editable = editInPlace && editableInPlace(embed);
  const showEditor = editing && editable && workId;

  function change(
    patch: { versionPolicy: "live" } | { versionPolicy: "pinned"; pinnedVersionId: Id<"spectraArtifactVersions"> },
    fallback: string,
  ) {
    setBusy(true);
    return update({ embedId: embedId as Id<"artifactEmbeds">, ...patch })
      .catch((error) => toast.error(describeFailure(error, { fallback }).message))
      .finally(() => setBusy(false));
  }

  function stopEditing() {
    // Unsynchronised changes go through the inline studio's own close, which
    // asks first. Only that copy: the same work open in the Side stays open.
    if (dirtyRef.current && workId) void spectraBus.command("work.requestClose", { workId, instance: embedId });
    else setEditing(false);
  }

  return (
    <div
      ref={hostRef}
      className={className}
      data-reference-host="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ArtifactEmbed
        embed={embed}
        busy={busy}
        tabs={tabs}
        onStackAnother={onStackAnother ? () => onStackAnother(hostRef.current) : undefined}
        onUnstack={onUnstack}
        onOpenSource={onOpenSource}
        onEdit={
          editable
            ? () => {
                launchFrom(hostRef.current?.querySelector(`[data-life-key="${embedLifeKey(embedId)}"]`));
                dirtyRef.current = false;
                setEditing(true);
              }
            : undefined
        }
        editor={
          showEditor ? (
            <InlineEmbedEditor
              embedId={embedId}
              workId={workId}
              onDone={() => {
                dirtyRef.current = false;
                setEditing(false);
              }}
              onOpenFull={() => {
                launchFrom(hostRef.current?.querySelector("[data-embed-editor]"));
                setEditing(false);
                void spectraBus.command("work.open", { workId, surface: "full" });
              }}
              onDirtyChange={(dirty) => {
                dirtyRef.current = dirty;
              }}
            />
          ) : undefined
        }
        onDoneEditing={stopEditing}
        onUseLiveVersion={() => void change({ versionPolicy: "live" }, "The reference could not follow the live artifact.")}
        onPinVersion={
          workId
            ? () => {
                setBusy(true);
                void getSpectraArtifactVersions(workId, 1)
                  .then((page) => {
                    const latest = page.versions[0];
                    if (!latest) {
                      toast.error("This artifact has no saved version to pin yet.");
                      return;
                    }
                    setEditing(false);
                    return change(
                      {
                        versionPolicy: "pinned",
                        pinnedVersionId: latest._id as Id<"spectraArtifactVersions">,
                      },
                      "The version could not be pinned.",
                    );
                  })
                  .catch((error) =>
                    toast.error(describeFailure(error, { fallback: "The saved versions could not be loaded." }).message),
                  )
                  .finally(() => setBusy(false));
              }
            : undefined
        }
        onModeChange={(mode) => {
          setBusy(true);
          void update({ embedId: embedId as Id<"artifactEmbeds">, mode })
            .catch((error) =>
              toast.error(
                describeFailure(error, { fallback: "The reference size could not be changed." }).message,
              ),
            )
            .finally(() => setBusy(false));
        }}
        onRemove={
          onRemove
            ? () => {
                setBusy(true);
                void remove({
                  embedId: embedId as Id<"artifactEmbeds">,
                })
                  .then(() => onRemove())
                  .catch((error) =>
                    toast.error(
                      describeFailure(error, { fallback: "The reference could not be removed." }).message,
                    ),
                  )
                  .finally(() => setBusy(false));
              }
            : undefined
        }
      />
    </div>
  );
}

export function ArtifactEmbedList({
  containerType,
  containerId,
  className,
  onOpenSource = openSource,
  region,
}: {
  containerType: "artifact" | "thread";
  containerId: string;
  className?: string;
  onOpenSource?: (artifactId: string) => void;
  /** Only the embeds placed in these regions; the container shares one subscription across lists. */
  region?: (regionId: string) => boolean;
}) {
  const result = useArtifactEmbedContainer(containerType, containerId);
  const update = useMutation(api.artifactEmbeds.update);
  const remove = useMutation(api.artifactEmbeds.remove);
  const embeds = region ? result?.embeds.filter((embed) => region(embed.containerRegionId)) : result?.embeds;

  if (!result || !embeds?.length) return null;
  return (
    <section
      className={className}
      aria-label={
        containerType === "thread"
          ? "Artifacts in this conversation"
          : "Live references"
      }
    >
      {embeds.map((embed) => (
        <ArtifactEmbed
          key={embed.embedId}
          embed={embed}
          onOpenSource={onOpenSource}
          onModeChange={
            result.canConfigure
              ? (mode) =>
                  // A refused resize used to surface as an unhandled
                  // rejection and nothing on screen; say it, like remove.
                  void update({
                    embedId: embed.embedId as Id<"artifactEmbeds">,
                    mode,
                  }).catch((error) =>
                    toast.error(
                      describeFailure(error, { fallback: "The reference size could not be changed." }).message,
                    ),
                  )
              : undefined
          }
          onRemove={
            result.canConfigure
              ? () =>
                  void remove({
                    embedId: embed.embedId as Id<"artifactEmbeds">,
                  }).catch((error) =>
                    toast.error(
                      describeFailure(error, { fallback: "The reference could not be removed." }).message,
                    ),
                  )
              : undefined
          }
        />
      ))}
    </section>
  );
}
