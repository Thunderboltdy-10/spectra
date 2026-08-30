"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import type { SpectraArtifactEmbed } from "../data/api";
import { spectraBus } from "../events";
import { ArtifactEmbed } from "./artifact-embed";

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

export function ArtifactEmbedById({
  embedId,
  className,
  onOpenSource = openSource,
  onRemove,
}: {
  embedId: string;
  className?: string;
  onOpenSource?: (artifactId: string) => void;
  onRemove?: () => void;
}) {
  const embed = useQuery(api.artifactEmbeds.getProjection, {
    embedId: embedId as Id<"artifactEmbeds">,
  }) as SpectraArtifactEmbed | undefined;
  const update = useMutation(api.artifactEmbeds.update);
  const remove = useMutation(api.artifactEmbeds.remove);
  const [busy, setBusy] = useState(false);

  if (!embed)
    return (
      <div
        className={`min-h-24 animate-pulse rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] motion-reduce:animate-none ${className ?? ""}`}
        aria-label="Loading live reference"
      />
    );

  return (
    <div
      className={className}
      data-reference-host="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ArtifactEmbed
        embed={embed}
        busy={busy}
        onOpenSource={onOpenSource}
        onModeChange={(mode) => {
          setBusy(true);
          void update({ embedId: embedId as Id<"artifactEmbeds">, mode })
            .catch((error) =>
              toast.error(
                error instanceof Error
                  ? error.message
                  : "The reference size could not be changed.",
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
                      error instanceof Error
                        ? error.message
                        : "The reference could not be removed.",
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
                  void update({
                    embedId: embed.embedId as Id<"artifactEmbeds">,
                    mode,
                  })
              : undefined
          }
          onRemove={
            result.canConfigure
              ? () =>
                  void remove({
                    embedId: embed.embedId as Id<"artifactEmbeds">,
                  }).catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "The reference could not be removed.",
                    ),
                  )
              : undefined
          }
        />
      ))}
    </section>
  );
}
