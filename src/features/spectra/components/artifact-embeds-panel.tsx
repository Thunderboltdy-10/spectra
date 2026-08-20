"use client";

import {
  Check,
  Link2,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  getSpectraArtifactEmbeds,
  getSpectraArtifactVersions,
  postSpectra,
  type SpectraArtifact,
  type SpectraArtifactEmbed,
  type SpectraArtifactVersion,
} from "../data/api";
import type { ArtifactCommentRegion } from "./artifact-comments-panel";
import { ArtifactEmbed } from "./artifact-embed";
import { workTypeMeta } from "./artifact-card";
import { isArtifactTypeKey } from "../artifacts/registry";
import { getWorkReferenceContract } from "../references";
import { getWorkDefinition } from "../work/registry";
import { spectraBus } from "../events";
import { useSpectraMotion } from "../motion/motion-level";
import { transitionFor } from "../motion/grammar";
import { SelectField } from "@/components/ui/select";

type Interaction = "read" | "interact" | "edit";

export function ArtifactEmbedsPanel({
  open,
  containerType = "artifact",
  containerId,
  containerTitle,
  artifacts,
  regions,
  onOpenSource,
  onClose,
}: {
  open: boolean;
  containerType?: "artifact" | "thread";
  containerId: string;
  containerTitle: string;
  artifacts: SpectraArtifact[];
  regions: readonly ArtifactCommentRegion[];
  onOpenSource?: (artifactId: string) => void;
  onClose: () => void;
}) {
  const [embeds, setEmbeds] = useState<SpectraArtifactEmbed[]>([]);
  const [canConfigure, setCanConfigure] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceArtifactId, setSourceArtifactId] = useState("");
  const [containerRegionId, setContainerRegionId] = useState("");
  const [mode, setMode] = useState<"compact" | "expanded">("compact");
  const [interaction, setInteraction] = useState<Interaction>("read");
  const [versionPolicy, setVersionPolicy] = useState<"live" | "pinned">("live");
  const [pinnedVersionId, setPinnedVersionId] = useState("");
  const [referenceView, setReferenceView] = useState("");
  const [versions, setVersions] = useState<SpectraArtifactVersion[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSpectraArtifactEmbeds(containerType, containerId);
      setEmbeds(result.embeds);
      setCanConfigure(result.canConfigure);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load references.",
      );
    } finally {
      setLoading(false);
    }
  }, [containerId, containerType]);

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setSearch("");
    setSourceArtifactId("");
    setContainerRegionId(regions[0]?.regionId ?? "artifact:structure");
    setMode("compact");
    setInteraction("read");
    setVersionPolicy("live");
    setPinnedVersionId("");
    setReferenceView("");
    setVersions([]);
    void refresh();
  }, [open, refresh, regions]);

  useEffect(() => {
    if (!open || !sourceArtifactId || versionPolicy !== "pinned") return;
    void getSpectraArtifactVersions(sourceArtifactId, 60)
      .then((result) => {
        setVersions(result.versions);
        setPinnedVersionId(
          (current) => current || result.versions[0]?._id || "",
        );
      })
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not load source versions.",
        ),
      );
  }, [open, sourceArtifactId, versionPolicy]);

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return artifacts
      .filter(
        (artifact) =>
          isArtifactTypeKey(artifact.blueprintKey) &&
          artifact._id !== containerId &&
          artifact.status !== "deleted" &&
          (!needle ||
            `${artifact.title} ${artifact.summary ?? ""} ${artifact.blueprintKey}`
              .toLowerCase()
              .includes(needle)),
      )
      .slice(0, 40);
  }, [artifacts, containerId, search]);
  const selectedArtifact = artifacts.find(
    (artifact) => artifact._id === sourceArtifactId,
  );
  const referenceContract =
    selectedArtifact && isArtifactTypeKey(selectedArtifact.blueprintKey)
      ? getWorkReferenceContract(selectedArtifact.blueprintKey)
      : null;
  const referenceViews = referenceContract
    ? [
        ...new Set(
          referenceContract.targets.flatMap((target) => [...target.views]),
        ),
      ]
    : [];
  const supportsInteraction =
    selectedArtifact?.blueprintKey === "flashcard_deck" ||
    selectedArtifact?.blueprintKey === "quiz";

  useEffect(() => {
    if (!supportsInteraction && interaction === "interact")
      setInteraction("read");
  }, [interaction, supportsInteraction]);

  async function createEmbed() {
    if (
      !sourceArtifactId ||
      !containerRegionId ||
      (versionPolicy === "pinned" && !pinnedVersionId)
    )
      return;
    setBusy("create");
    try {
      await postSpectra({
        action: "createArtifactEmbed",
        containerType,
        containerId,
        containerRegionId,
        sourceArtifactId,
        mode,
        interaction,
        versionPolicy,
        pinnedVersionId:
          versionPolicy === "pinned" ? pinnedVersionId : undefined,
        contextPolicy: "summary",
        displayPreferences:
          referenceView || referenceViews[0]
            ? { view: referenceView || referenceViews[0] }
            : undefined,
      });
      if (
        containerType === "artifact" &&
        selectedArtifact &&
        isArtifactTypeKey(selectedArtifact.blueprintKey)
      ) {
        const definition = getWorkDefinition(selectedArtifact.blueprintKey);
        spectraBus.command("reference.insert", {
          hostWorkId: containerId,
          target: {
            workId: selectedArtifact._id,
            workType: selectedArtifact.blueprintKey,
            kind: referenceContract?.targets[0]?.kind ?? "work:root",
            path: ["work", "root"],
            stableIds: { workId: selectedArtifact._id },
            fallbackExcerpt: selectedArtifact.title,
            schemaVersion: definition.model.schemaVersion,
          },
        });
      }
      setCreating(false);
      setSourceArtifactId("");
      setSearch("");
      await refresh();
      toast.success("Reference added.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not add this reference.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function changeMode(
    embed: SpectraArtifactEmbed,
    nextMode: "compact" | "expanded",
  ) {
    setBusy(`mode:${embed.embedId}`);
    try {
      await postSpectra({
        action: "updateArtifactEmbed",
        embedId: embed.embedId,
        mode: nextMode,
      });
      setEmbeds((current) =>
        current.map((entry) =>
          entry.embedId === embed.embedId
            ? { ...entry, mode: nextMode }
            : entry,
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not resize this reference.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeEmbed(embed: SpectraArtifactEmbed) {
    setBusy(`remove:${embed.embedId}`);
    try {
      await postSpectra({
        action: "removeArtifactEmbed",
        embedId: embed.embedId,
      });
      setEmbeds((current) =>
        current.filter((entry) => entry.embedId !== embed.embedId),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove this reference.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function resizeEmbed(
    embed: SpectraArtifactEmbed,
    size: { width: number; height: number },
  ) {
    const displayPreferences = { ...embed.displayPreferences, ...size };
    setEmbeds((current) =>
      current.map((entry) =>
        entry.embedId === embed.embedId
          ? { ...entry, displayPreferences }
          : entry,
      ),
    );
    try {
      await postSpectra({
        action: "updateArtifactEmbed",
        embedId: embed.embedId,
        displayPreferences,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save the reference size.",
      );
      await refresh();
    }
  }

  async function requestAccess(embed: SpectraArtifactEmbed) {
    setBusy(`request:${embed.embedId}`);
    try {
      await postSpectra({
        action: "requestArtifactAccess",
        embedId: embed.embedId,
        requestedLevel: "read",
      });
      await refresh();
      toast.success("Access request sent to the source owner.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not request source access.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function cancelAccessRequest(requestId: string, embedId: string) {
    setBusy(`request:${embedId}`);
    try {
      await postSpectra({ action: "cancelArtifactAccessRequest", requestId });
      await refresh();
      toast.success("Access request cancelled.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not cancel the request.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function recoverLiveVersion(embed: SpectraArtifactEmbed) {
    setBusy(`version:${embed.embedId}`);
    try {
      await postSpectra({
        action: "updateArtifactEmbed",
        embedId: embed.embedId,
        versionPolicy: "live",
      });
      await refresh();
      toast.success("Reference restored to the live source.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not restore this reference.",
      );
    } finally {
      setBusy(null);
    }
  }

  const motionLevel = useSpectraMotion();

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="embeds-backdrop"
          initial={motionLevel.disabled ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={motionLevel.disabled ? undefined : { opacity: 0 }}
          transition={
            motionLevel.disabled
              ? undefined
              : transitionFor("reveal", motionLevel.level)
          }
          className="absolute inset-0 z-[72] flex justify-end bg-[color-mix(in_oklab,var(--text-primary)_12%,transparent)] backdrop-blur-[1px]"
          onPointerDown={onClose}
        >
          <motion.aside
            key="embeds-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="artifact-embeds-title"
            initial={motionLevel.disabled ? false : { x: "10%", opacity: 0.65 }}
            animate={{ x: 0, opacity: 1 }}
            exit={motionLevel.disabled ? undefined : { x: "6%", opacity: 0 }}
            transition={
              motionLevel.disabled
                ? undefined
                : transitionFor("morph", motionLevel.level)
            }
            className="flex h-full w-full max-w-[520px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[-20px_0_60px_rgba(27,20,12,0.12)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between border-b border-[var(--border-default)] px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,#8b6ff0_9%,var(--bg-secondary))] text-[#765bd8]">
                  <Link2 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2
                    id="artifact-embeds-title"
                    className="font-display text-[18px] font-semibold text-[var(--text-primary)]"
                  >
                    References
                  </h2>
                  <p className="mt-0.5 truncate text-micro text-[var(--text-tertiary)]">
                    {canConfigure ? "Live references" : "Read-only references"}{" "}
                    inside {containerTitle}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                {canConfigure ? (
                  <button
                    type="button"
                    onClick={() => setCreating((value) => !value)}
                    className="flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-2.5 text-micro font-semibold text-[var(--bg-primary)]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  aria-label="Close references"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {creating ? (
              <section className="shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="text-micro font-semibold uppercase tracking-[.09em] text-[var(--text-tertiary)]">
                      Referenced work
                    </span>
                    <div className="relative mt-1.5">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search accessible work"
                        className="h-9 w-full rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-[11px] text-[var(--text-primary)] outline-none"
                      />
                    </div>
                  </label>
                  <div className="sm:col-span-2 max-h-32 overflow-y-auto rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
                    {candidates.map((artifact) => {
                      const meta = workTypeMeta[artifact.blueprintKey];
                      const Icon = meta.icon;
                      return (
                        <button
                          type="button"
                          key={artifact._id}
                          onClick={() => {
                            setSourceArtifactId(artifact._id);
                            setReferenceView("");
                            setVersions([]);
                            setPinnedVersionId("");
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left ${sourceArtifactId === artifact._id ? "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-hover))]" : "hover:bg-[var(--bg-hover)]"}`}
                        >
                          <Icon
                            className="h-3.5 w-3.5"
                            style={{ color: meta.color }}
                          />
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-primary)]">
                            {artifact.title}
                          </span>
                          {sourceArtifactId === artifact._id ? (
                            <Check className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                          ) : null}
                        </button>
                      );
                    })}
                    {candidates.length === 0 ? (
                      <p className="px-3 py-4 text-center text-micro text-[var(--text-tertiary)]">
                        No accessible work matches.
                      </p>
                    ) : null}
                  </div>
                  <SelectField
                    label="Anchor"
                    value={containerRegionId}
                    onChange={setContainerRegionId}
                    options={regions.map((region) => ({
                      value: region.regionId,
                      label: region.label,
                    }))}
                  />
                  {referenceViews.length ? (
                    <SelectField
                      label="Preview"
                      value={referenceView || referenceViews[0]!}
                      onChange={setReferenceView}
                      options={referenceViews.map((view) => ({
                        value: view,
                        label: view.replaceAll("_", " "),
                      }))}
                    />
                  ) : null}
                  <SelectField
                    label="Layout"
                    value={mode}
                    onChange={(value) => setMode(value as typeof mode)}
                    options={[
                      { value: "compact", label: "Compact" },
                      { value: "expanded", label: "Expanded" },
                    ]}
                  />
                  <SelectField
                    label="Interaction"
                    value={interaction}
                    onChange={(value) => setInteraction(value as Interaction)}
                    options={[
                      { value: "read", label: "Read-only preview" },
                      ...(supportsInteraction
                        ? [{ value: "interact", label: "Interactive practice" }]
                        : []),
                    ]}
                  />
                  <SelectField
                    label="Version"
                    value={versionPolicy}
                    onChange={(value) =>
                      setVersionPolicy(value as typeof versionPolicy)
                    }
                    options={[
                      { value: "live", label: "Live source" },
                      { value: "pinned", label: "Pinned version" },
                    ]}
                  />
                  {versionPolicy === "pinned" ? (
                    <div className="sm:col-span-2">
                      <SelectField
                        label="Pinned version"
                        value={pinnedVersionId}
                        onChange={setPinnedVersionId}
                        options={versions.map((version) => ({
                          value: version._id,
                          label: `${version.name || version.summary || "Saved version"} · ${new Date(version.createdAt).toLocaleString()}`,
                        }))}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="h-8 rounded-[7px] px-3 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      !sourceArtifactId ||
                      !containerRegionId ||
                      (versionPolicy === "pinned" && !pinnedVersionId) ||
                      busy === "create"
                    }
                    onClick={() => void createEmbed()}
                    className="flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-35"
                  >
                    {busy === "create" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add reference
                  </button>
                </div>
              </section>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : embeds.length === 0 ? (
                <div className="mx-auto flex max-w-[300px] flex-col items-center py-16 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-dashed border-[var(--border-strong)] text-[var(--text-tertiary)]">
                    <Link2 className="h-4 w-4" />
                  </span>
                  <h3 className="mt-4 text-[13px] font-semibold text-[var(--text-primary)]">
                    {canConfigure
                      ? "Compose with live references"
                      : "No references"}
                  </h3>
                  <p className="mt-1.5 text-micro leading-5 text-[var(--text-secondary)]">
                    {canConfigure
                      ? "Reference source work without copying it or changing who can access it. Live references update with their source; pinned references stay on a chosen version."
                      : "This work does not currently contain any references."}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {embeds.map((embed) => (
                    <div key={embed.embedId} className="group relative">
                      <ArtifactEmbed
                        embed={embed}
                        busy={busy?.includes(embed.embedId) ?? false}
                        onOpenSource={onOpenSource}
                        onRetry={() => void refresh()}
                        onModeChange={
                          embed.canConfigure
                            ? (nextMode) => void changeMode(embed, nextMode)
                            : undefined
                        }
                        onResize={
                          embed.canConfigure
                            ? (size) => void resizeEmbed(embed, size)
                            : undefined
                        }
                        onRequestAccess={() => void requestAccess(embed)}
                        onCancelAccessRequest={(requestId) =>
                          void cancelAccessRequest(requestId, embed.embedId)
                        }
                        onUseLiveVersion={() => void recoverLiveVersion(embed)}
                      />
                      {embed.canConfigure ? (
                        <button
                          type="button"
                          disabled={busy === `remove:${embed.embedId}`}
                          onClick={() => void removeEmbed(embed)}
                          className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-[6px] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] text-[var(--text-tertiary)] opacity-0 shadow-sm transition hover:text-[var(--danger)] group-hover:opacity-100 focus:opacity-100"
                          aria-label="Remove reference"
                        >
                          {busy === `remove:${embed.embedId}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

