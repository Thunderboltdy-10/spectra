"use client";

import { describeFailure } from "@/components/ui/truthful-state";
import { Check, Link2, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { useMutation } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  postSpectra,
  type SpectraArtifact,
  type SpectraArtifactEmbed,
} from "../data/api";
import type { ArtifactTypeKey } from "../artifacts/types";
import type { CompatibilityProfile } from "../commands/types";
import type { ReferenceNode } from "../references";
import type { ArtifactEmbedInteraction } from "../../../../shared/artifact-embed";
import type { ArtifactCommentRegion } from "./artifact-comments-panel";
import { ArtifactEmbed } from "./artifact-embed";
import { workTypeMeta } from "./artifact-card";
import { isArtifactTypeKey } from "../artifacts/registry";
import { getWorkReferenceContract } from "../references";
import { getWorkDefinition } from "../work/registry";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { useSpectraMotion } from "../motion/motion-level";
import { transitionFor } from "../motion/grammar";
import { SelectField } from "@/components/ui/select";
import { embedCapabilitiesFor } from "../capabilities";
import { useArtifactEmbedContainer } from "./artifact-embed-host";
import { usePinVersionPicker } from "./use-pin-version-picker";
import { rankEmbedCandidates } from "./embed-candidates";
import { useRelated, useSemanticSearch } from "../semantic/use-semantic";
import type { SemanticAnchor } from "../../../../shared/semantic-types";

type Interaction = ArtifactEmbedInteraction;

export function ArtifactEmbedsPanel({
  open,
  containerType = "artifact",
  containerId,
  containerTitle,
  containerWorkType,
  compatibilityProfile = "spectra-native",
  artifacts,
  regions,
  onOpenSource,
  onClose,
}: {
  open: boolean;
  containerType?: "artifact" | "thread";
  containerId: string;
  containerTitle: string;
  containerWorkType?: ArtifactTypeKey;
  compatibilityProfile?: CompatibilityProfile;
  artifacts: SpectraArtifact[];
  regions: readonly ArtifactCommentRegion[];
  onOpenSource?: (artifactId: string) => void;
  onClose: () => void;
}) {
  const liveResult = useArtifactEmbedContainer(
    containerType,
    containerId,
    open,
  );
  const embeds = liveResult?.embeds ?? [];
  const canConfigure = liveResult?.canConfigure ?? false;
  const loading = open && liveResult === undefined;
  const createReference = useMutation(api.artifactEmbeds.create);
  const updateReference = useMutation(api.artifactEmbeds.update);
  const removeReference = useMutation(api.artifactEmbeds.remove);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceArtifactId, setSourceArtifactId] = useState("");
  const [containerRegionId, setContainerRegionId] = useState("");
  const [mode, setMode] = useState<"compact" | "expanded">("compact");
  const [interaction, setInteraction] = useState<Interaction>("read");
  const [versionPolicy, setVersionPolicy] = useState<"live" | "pinned">("live");
  const [referenceView, setReferenceView] = useState("");
  const pinnedVersions = usePinVersionPicker(
    sourceArtifactId,
    open && creating && versionPolicy === "pinned",
  );
  const pinnedVersionId = pinnedVersions.selectedId;

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setSearch("");
    setSourceArtifactId("");
    setContainerRegionId(regions[0]?.regionId ?? "artifact:structure");
    setMode("compact");
    setInteraction("read");
    setVersionPolicy("live");
    setReferenceView("");
  }, [open, regions]);

  const picking = open && creating;
  const semantic = useSemanticSearch(search, {
    kinds: ["artifact"],
    limit: 20,
    openItemIds: containerType === "artifact" ? [containerId] : undefined,
    enabled: picking,
  });
  const related = useRelated(
    containerType === "artifact" ? containerId : null,
    { limit: 12, enabled: picking },
  );
  const candidates = useMemo(
    () =>
      rankEmbedCandidates({
        artifacts,
        containerId,
        query: search,
        searchIds: semantic.results.map(workIdOf),
        relatedIds: related.results.map(workIdOf),
      }),
    [artifacts, containerId, search, semantic.results, related.results],
  );
  const searching = semantic.status === "loading" && candidates.length === 0;
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
  const supportsInteraction = Boolean(
    selectedArtifact &&
    isArtifactTypeKey(selectedArtifact.blueprintKey) &&
    embedCapabilitiesFor(selectedArtifact.blueprintKey, "interact").length,
  );

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
    if (compatibilityProfile === "strict-native") {
      toast.error(
        "This file keeps strict native compatibility. Change it to Enhanced before adding a live reference.",
      );
      return;
    }
    setBusy("create");
    let createdEmbedId: string | undefined;
    const placementOperationId =
      containerType === "artifact" ? crypto.randomUUID() : undefined;
    try {
      const result = await createReference({
        containerType,
        containerId,
        containerRegionId,
        sourceArtifactId: sourceArtifactId as Id<"spectraArtifacts">,
        mode,
        interaction,
        versionPolicy,
        pinnedVersionId:
          versionPolicy === "pinned"
            ? (pinnedVersionId as Id<"spectraArtifactVersions">)
            : undefined,
        contextPolicy: "summary",
        displayPreferences:
          referenceView || referenceViews[0]
            ? { view: referenceView || referenceViews[0] }
            : undefined,
        placementOperationId,
      });
      createdEmbedId = result.embedId;
      if (
        containerType === "artifact" &&
        (containerWorkType === "document" ||
          containerWorkType === "whiteboard") &&
        selectedArtifact &&
        isArtifactTypeKey(selectedArtifact.blueprintKey)
      ) {
        const reference: ReferenceNode = {
          embedId: result.embedId,
          placementOperationId,
          containerType,
          containerId,
          containerRegionId,
          sourceArtifactId,
          mode,
          interaction,
          versionPolicy,
          ...(versionPolicy === "pinned" ? { pinnedVersionId } : {}),
          contextPolicy: "summary",
          displayPreferences:
            referenceView || referenceViews[0]
              ? { view: referenceView || referenceViews[0] }
              : undefined,
          state: "ready",
        };
        const definition = getWorkDefinition(selectedArtifact.blueprintKey);
        const listeners = await spectraBus.commandAsync("reference.insert", {
          hostWorkId: containerId,
          reference,
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
        if (listeners === 0)
          throw new Error("The document editor is not ready for reference insertion.");
      }
      setCreating(false);
      setSourceArtifactId("");
      setSearch("");
      toast.success("Reference added.");
    } catch (error) {
      if (createdEmbedId)
        await removeReference({
          embedId: createdEmbedId as Id<"artifactEmbeds">,
        }).catch(() => undefined);
      toast.error(
        describeFailure(error, { fallback: "Could not add this reference." }).message,
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
      await updateReference({
        embedId: embed.embedId as Id<"artifactEmbeds">,
        mode: nextMode,
      });
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not resize this reference." }).message,
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeEmbed(embed: SpectraArtifactEmbed) {
    setBusy(`remove:${embed.embedId}`);
    try {
      if (
        containerType === "artifact" &&
        (containerWorkType === "document" || containerWorkType === "whiteboard")
      ) {
        const dispatched = await spectraBus.commandAsyncResults("reference.remove", {
          hostWorkId: containerId,
          embedId: embed.embedId,
        });
        const outcome = [...dispatched.results].reverse().find(
          (value): value is SpectraCommandOutcome =>
            value !== null &&
            typeof value === "object" &&
            "status" in value &&
            ["completed", "pending", "needs-human", "failed"].includes(
              String(value.status),
            ) &&
            "message" in value &&
            typeof value.message === "string",
        );
        if (dispatched.listeners === 0)
          throw new Error("The editor is not ready to remove this reference.");
        if (outcome?.status !== "completed")
          throw new Error(
            outcome?.message ?? "The reference could not be removed from the editor.",
          );
      }
      await removeReference({
        embedId: embed.embedId as Id<"artifactEmbeds">,
      });
      toast.success("Reference removed.");
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not remove this reference." }).message,
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
    try {
      await updateReference({
        embedId: embed.embedId as Id<"artifactEmbeds">,
        displayPreferences,
      });
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not save the reference size." }).message,
      );
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
      toast.success("Access request sent to the source owner.");
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not request source access." }).message,
      );
    } finally {
      setBusy(null);
    }
  }

  async function cancelAccessRequest(requestId: string, embedId: string) {
    setBusy(`request:${embedId}`);
    try {
      await postSpectra({ action: "cancelArtifactAccessRequest", requestId });
      toast.success("Access request cancelled.");
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not cancel the request." }).message,
      );
    } finally {
      setBusy(null);
    }
  }

  async function recoverLiveVersion(embed: SpectraArtifactEmbed) {
    setBusy(`version:${embed.embedId}`);
    try {
      await updateReference({
        embedId: embed.embedId as Id<"artifactEmbeds">,
        versionPolicy: "live",
      });
      toast.success("Reference restored to the live source.");
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not restore this reference." }).message,
      );
    } finally {
      setBusy(null);
    }
  }

  const motionLevel = useSpectraMotion();
  const sheetRef = useRef<HTMLElement>(null);
  useModalFocus(sheetRef, { open, onClose });

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
          className="absolute inset-0 z-panel flex justify-end"
          onPointerDown={onClose}
        >
          <motion.aside
            key="embeds-sheet"
            ref={sheetRef}
            tabIndex={-1}
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
            className="flex h-full w-full max-w-[520px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between border-b border-[var(--border-default)] px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-secondary))] text-[var(--brand-primary)]">
                  <Link2 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2
                    id="artifact-embeds-title"
                    className="font-display text-heading font-semibold text-[var(--text-primary)]"
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
                    onClick={() => {
                      if (compatibilityProfile === "strict-native") {
                        toast.error(
                          "This file keeps strict native compatibility. Change it to Enhanced before adding a live reference.",
                        );
                        return;
                      }
                      setCreating((value) => !value);
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-control bg-[var(--text-primary)] px-2.5 text-micro font-semibold text-[var(--bg-primary)]"
                    title={
                      compatibilityProfile === "strict-native"
                        ? "Live references need Enhanced compatibility."
                        : "Add a live reference"
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  aria-label="Close references"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {compatibilityProfile === "strict-native" && canConfigure ? (
              <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-3 text-micro leading-4 text-[var(--text-secondary)]">
                This file keeps strict native compatibility. Live references are
                available after changing compatibility to Enhanced.
              </div>
            ) : null}

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
                        className="h-9 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-micro text-[var(--text-primary)] outline-none"
                      />
                    </div>
                  </label>
                  <div className="sm:col-span-2 max-h-32 overflow-y-auto rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
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
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-chip px-2.5 py-2 text-left ${sourceArtifactId === artifact._id ? "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-hover))]" : "hover:bg-[var(--bg-hover)]"}`}
                        >
                          <Icon
                            className="h-3.5 w-3.5"
                            style={{ color: meta.color }}
                          />
                          <span className="min-w-0 flex-1 truncate text-micro font-medium text-[var(--text-primary)]">
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
                        {searching ? "Searching…" : "No accessible work matches."}
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
                        onChange={pinnedVersions.select}
                        disabled={pinnedVersions.versions.length === 0}
                        options={pinnedVersions.versions.map((version) => ({
                          value: version._id,
                          label: `${version.name || version.summary || "Saved version"} · ${new Date(version.createdAt).toLocaleString()}`,
                        }))}
                      />
                      {pinnedVersions.loading ? (
                        <p
                          role="status"
                          className="mt-2 text-micro text-[var(--text-secondary)]"
                        >
                          Loading saved versions…
                        </p>
                      ) : pinnedVersions.error ? (
                        <p
                          role="alert"
                          className="mt-2 text-micro text-[var(--text-secondary)]"
                        >
                          {pinnedVersions.error}
                        </p>
                      ) : pinnedVersions.isDone &&
                        pinnedVersions.versions.length === 0 ? (
                        <p
                          role="status"
                          className="mt-2 text-micro text-[var(--text-secondary)]"
                        >
                          No saved versions.
                        </p>
                      ) : null}
                      {!pinnedVersions.loading &&
                      (pinnedVersions.error ||
                        (!pinnedVersions.isDone &&
                          pinnedVersions.cursor !== null)) ? (
                        <button
                          type="button"
                          onClick={pinnedVersions.loadMore}
                          className="mt-2 h-7 rounded-control border border-[var(--border-default)] px-2.5 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          {pinnedVersions.error
                            ? "Retry loading versions"
                            : "Load older versions"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="h-8 rounded-control px-3 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
                    className="flex h-8 items-center gap-1.5 rounded-control bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-35"
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
                  <span className="flex h-12 w-12 items-center justify-center rounded-surface border border-dashed border-[var(--border-strong)] text-[var(--text-tertiary)]">
                    <Link2 className="h-4 w-4" />
                  </span>
                  <h3 className="mt-4 text-ui font-semibold text-[var(--text-primary)]">
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
                    <div key={embed.embedId}>
                      <ArtifactEmbed
                        embed={embed}
                        busy={busy?.includes(embed.embedId) ?? false}
                        onOpenSource={onOpenSource}
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
                        onRemove={
                          embed.canConfigure
                            ? () => void removeEmbed(embed)
                            : undefined
                        }
                      />
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

/** A search or related hit names its work by the anchor; other kinds never match a work id. */
function workIdOf(result: { itemId: string; anchor: SemanticAnchor }) {
  return result.anchor.kind === "artifact" ? result.anchor.artifactId : result.itemId;
}
