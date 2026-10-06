"use client";

import { describeFailure } from "@/components/ui/truthful-state";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
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
  return useQuery(
    api.artifactEmbeds.listForContainer,
    enabled && containerId ? { containerType, containerId } : "skip",
  ) as { embeds: SpectraArtifactEmbed[]; canConfigure: boolean } | undefined;
}

/** Whether this reader can edit the embedded work where it is (live, theirs to change, a type that fits). */
export function editableInPlace(embed: SpectraArtifactEmbed) {
  return Boolean(
    embed.state === "ready" &&
      embed.versionPolicy === "live" &&
      !embed.sourceUnavailable &&
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
}: {
  embedId: string;
  className?: string;
  onOpenSource?: (artifactId: string) => void;
  onRemove?: () => void;
  /** The host is an editor: the embedded work can be edited here too. */
  editInPlace?: boolean;
}) {
  const embed = useQuery(api.artifactEmbeds.getProjection, {
    embedId: embedId as Id<"artifactEmbeds">,
  }) as SpectraArtifactEmbed | null | undefined;
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
      <div
        className={`rounded-card border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] px-4 py-3 text-micro text-[var(--text-secondary)] ${className ?? ""}`}
        role="status"
        aria-label="Reference unavailable"
      >
        This pinned reference is no longer available.
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
    // Unsynchronised changes go through the studio's own close, which asks first.
    if (dirtyRef.current && workId) void spectraBus.command("work.requestClose", { workId });
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
        onUseLiveVersion={() => void change({ versionPolicy: "live" }, "The reference could not follow the live work.")}
        onPinVersion={
          workId
            ? () => {
                setBusy(true);
                void getSpectraArtifactVersions(workId, 1)
                  .then((page) => {
                    const latest = page.versions[0];
                    if (!latest) {
                      toast.error("This work has no saved version to pin yet.");
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
}: {
  containerType: "artifact" | "thread";
  containerId: string;
  className?: string;
  onOpenSource?: (artifactId: string) => void;
}) {
  const result = useArtifactEmbedContainer(containerType, containerId);
  const update = useMutation(api.artifactEmbeds.update);
  const remove = useMutation(api.artifactEmbeds.remove);

  if (!result?.embeds.length) return null;
  return (
    <section
      className={className}
      aria-label={
        containerType === "thread"
          ? "Work in this conversation"
          : "Live references"
      }
    >
      {result.embeds.map((embed) => (
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
