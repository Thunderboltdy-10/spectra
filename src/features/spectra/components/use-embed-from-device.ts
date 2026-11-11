"use client";

import { useEffect, useMemo, useState } from "react";
import { readDeviceWork } from "../bridge/device-works";
import type { SpectraArtifactEmbed } from "../data/api";

type Stored = Awaited<ReturnType<typeof readDeviceWork>>;

/**
 * Spectra holds only the name of work kept on a computer, so an embed of it reads
 * the rest from Bridge. When Bridge can't answer, the embed says where the work
 * lives rather than looking empty.
 */
export function useEmbedFromDevice(embed: SpectraArtifactEmbed): SpectraArtifactEmbed {
  const source = embed.source;
  const artifactId = source?.storageHome === "device" && embed.versionPolicy === "live" ? source.artifactId : null;
  const updatedAt = source?.updatedAt;
  const [stored, setStored] = useState<{ artifactId: string; row: Stored } | null>(null);
  useEffect(() => {
    if (!artifactId) return;
    let live = true;
    void readDeviceWork(artifactId).then((row) => {
      if (live) setStored({ artifactId, row });
    });
    return () => {
      live = false;
    };
  }, [artifactId, updatedAt]);
  return useMemo(() => {
    if (!artifactId || stored?.artifactId !== artifactId) return embed;
    if (!stored.row || stored.row.content === undefined || stored.row.content === null)
      return { ...embed, keptOn: embed.keptOn ?? { deviceName: "your computer" } };
    return {
      ...embed,
      keptOn: undefined,
      source: {
        ...embed.source!,
        snapshot: {
          ...embed.source!.snapshot,
          title: stored.row.title ?? embed.source!.title,
          content: stored.row.content,
        },
      },
    };
  }, [artifactId, embed, stored]);
}
