"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Link2, Loader2, Plus, Search, X } from "@/components/icons/glyph-icons";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu, type OverflowItem } from "@/components/ui/dropdown-menu";
import { LifeKey } from "@/components/ui/life-moments";
import { EmptyState, LoadingRows } from "@/components/ui/page-state";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { RelatedResult, SemanticAnchor } from "../../../../shared/semantic-types";
import type { ArtifactTypeKey } from "../artifacts/types";
import type { CompatibilityProfile } from "../commands/types";
import {
  getSpectraArtifactLinks,
  postSpectra,
  type SpectraArtifact,
  type SpectraArtifactEmbed,
  type SpectraArtifactLink,
} from "../data/api";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { useRelated, useSemanticSearch } from "../semantic/use-semantic";
import type { ArtifactCommentRegion } from "./artifact-comments-panel";
import { workTypeMeta } from "./artifact-card";
import { useArtifactEmbedContainer } from "./artifact-embed-host";
import { rankEmbedCandidates } from "./embed-candidates";
import { artifactPlacements } from "./spectra-view-model";
import { useAddReference } from "./use-add-reference";
import { usePinVersionPicker } from "./use-pin-version-picker";

/*
 * What this work draws on. Two things live here and neither has to be accepted
 * first: work placed in the page, and work linked to it. Work plainly about the
 * same thing is linked already; taking a link away is the decision a person makes.
 */

/** The closeness at which two pieces of work are about the same thing, not merely alike. */
const SAME_SUBJECT = 0.5;
const MOST_ESTABLISHED = 4;
/** One look per work per sitting: a link someone removed stays removed on the server regardless. */
const establishedThisSession = new Set<string>();

function workIdOf(result: { itemId: string; anchor: SemanticAnchor }) {
  return result.anchor.kind === "artifact" ? result.anchor.artifactId : result.itemId;
}

function sameSubject(result: RelatedResult) {
  return result.reasons.some((reason) => reason.type === "similar" && reason.similarity >= SAME_SUBJECT);
}

/** Kept beside this work and tagged like it: linked even before its words are indexed. */
function sitsWith(work: SpectraArtifact, other: SpectraArtifact) {
  if (other._id === work._id || other.status !== "active") return false;
  const places = new Set(artifactPlacements(work).map((placement) => placement.workspaceId));
  if (!artifactPlacements(other).some((placement) => places.has(placement.workspaceId))) return false;
  return other.tags.some((tag) => work.tags.includes(tag));
}

function versionWords(embed: SpectraArtifactEmbed) {
  if (embed.versionPolicy !== "pinned") return "Follows the live artifact";
  const name = embed.version?.name || embed.version?.summary;
  if (name) return `Kept on ${name}`;
  return embed.version
    ? `Kept on the version from ${new Date(embed.version.createdAt).toLocaleDateString([], { day: "numeric", month: "short" })}`
    : "Kept on a saved version";
}

function stateWords(embed: SpectraArtifactEmbed) {
  switch (embed.state) {
    case "no_access":
      return embed.accessRequest ? "Access requested" : "You can't open this yet";
    case "deleted":
      return "This artifact was deleted";
    case "version_unavailable":
      return "The saved version is missing";
    case "removed":
      return "No longer linked";
    default:
      return versionWords(embed);
  }
}

function WorkGlyph({ type }: { type?: string }) {
  const meta = type ? workTypeMeta[type as ArtifactTypeKey] : null;
  return meta ? <Icon name={meta.glyph} size={16} accent={meta.color} /> : <Link2 className="size-4 text-[var(--text-tertiary)]" />;
}

function ReferenceRow({
  title,
  detail,
  type,
  onOpen,
  children,
}: {
  title: string;
  detail?: string;
  type?: string;
  onOpen?: () => void;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <WorkGlyph type={type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-[var(--text-primary)]">{title}</span>
        {detail ? <span className="block truncate text-micro text-[var(--text-tertiary)]">{detail}</span> : null}
      </span>
    </>
  );
  return (
    <li className="reference-row">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="reference-row-main">
          {body}
        </button>
      ) : (
        <span className="reference-row-main">{body}</span>
      )}
      {children}
    </li>
  );
}

type EmbedAction = "compact" | "expanded" | "pin" | "live" | "request" | "cancel" | "remove";

function PlacedReference({
  embed,
  regionLabel,
  onOpenSource,
  onUpdate,
  onRemove,
  onRequestAccess,
  onCancelAccess,
}: {
  embed: SpectraArtifactEmbed;
  regionLabel?: string;
  onOpenSource?: (artifactId: string) => void;
  onUpdate: (patch: { mode?: "compact" | "expanded"; versionPolicy?: "live" | "pinned"; pinnedVersionId?: string }) => Promise<void>;
  onRemove: () => Promise<void>;
  onRequestAccess: () => Promise<void>;
  onCancelAccess: (requestId: string) => Promise<void>;
}) {
  const [pinning, setPinning] = useState(false);
  const pinned = usePinVersionPicker(embed.sourceArtifactId, pinning);
  const items: OverflowItem<EmbedAction>[] = [];
  if (embed.canConfigure && embed.state === "ready") {
    items.push(
      embed.mode === "expanded" ? { key: "compact", label: "Show smaller", icon: "chevronUp" } : { key: "expanded", label: "Show larger", icon: "chevronDown" },
    );
    if (embed.versionPolicy !== "pinned") items.push({ key: "pin", label: "Keep on a saved version", icon: "activity" });
  }
  if (embed.canConfigure && embed.versionPolicy === "pinned") items.push({ key: "live", label: "Follow the live artifact", icon: "activity" });
  if (embed.state === "no_access" && embed.canRequestAccess && !embed.accessRequest) items.push({ key: "request", label: "Ask for access", icon: "reply" });
  if (embed.accessRequest) items.push({ key: "cancel", label: "Cancel the request", icon: "close" });
  if (embed.canConfigure) items.push({ key: "remove", label: "Remove from this artifact", icon: "close" });

  function choose(action: EmbedAction) {
    if (action === "compact" || action === "expanded") void onUpdate({ mode: action });
    else if (action === "pin") setPinning(true);
    else if (action === "live") void onUpdate({ versionPolicy: "live" });
    else if (action === "request") void onRequestAccess();
    else if (action === "cancel" && embed.accessRequest) void onCancelAccess(embed.accessRequest.requestId);
    else if (action === "remove") void onRemove();
  }

  return (
    <>
      <LifeKey id={`embed:${embed.embedId}`} />
      <ReferenceRow
        title={embed.source?.title ?? "Artifact you can't see"}
        detail={[stateWords(embed), regionLabel].filter(Boolean).join(", ")}
        type={embed.source?.blueprintKey}
        onOpen={embed.source && onOpenSource ? () => onOpenSource(embed.sourceArtifactId) : undefined}
      >
        <OverflowMenu label={`More for ${embed.source?.title ?? "this reference"}`} items={items} onSelect={choose} size={28} />
      </ReferenceRow>
      {pinning ? (
        <li className="px-2 pb-2">
          <SelectField
            ariaLabel="Saved version to keep"
            size="sm"
            value={pinned.selectedId}
            onChange={pinned.select}
            disabled={pinned.versions.length === 0}
            options={pinned.versions.map((version) => ({
              value: version._id,
              label: version.name || version.summary || new Date(version.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
            }))}
          />
          {pinned.isDone && pinned.versions.length === 0 ? (
            <p role="status" className="mt-1.5 text-micro text-[var(--text-secondary)]">
              {embed.source?.title ?? "This artifact"} has no saved versions yet.
            </p>
          ) : pinned.error ? (
            <p role="alert" className="mt-1.5 text-micro text-[var(--text-secondary)]">
              {pinned.error}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" className="reference-text-action" onClick={() => setPinning(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="reference-text-action"
              data-strong
              disabled={!pinned.selectedId}
              onClick={() => void onUpdate({ versionPolicy: "pinned", pinnedVersionId: pinned.selectedId }).then(() => setPinning(false))}
            >
              Keep this version
            </button>
          </div>
        </li>
      ) : null}
    </>
  );
}

export function ArtifactEmbedsPanel({
  containerType = "artifact",
  containerId,
  containerWorkType,
  compatibilityProfile = "spectra-native",
  artifact,
  artifacts,
  regions,
  onOpenSource,
}: {
  containerType?: "artifact" | "thread";
  containerId: string;
  containerWorkType?: ArtifactTypeKey;
  compatibilityProfile?: CompatibilityProfile;
  /** The work these belong to, when they belong to a work. */
  artifact?: SpectraArtifact;
  artifacts: SpectraArtifact[];
  regions: readonly ArtifactCommentRegion[];
  onOpenSource?: (artifactId: string) => void;
}) {
  const live = useArtifactEmbedContainer(containerType, containerId, true);
  const embeds = useMemo(() => live?.embeds ?? [], [live?.embeds]);
  const canConfigure = live?.canConfigure ?? false;
  const nativeOnly = compatibilityProfile === "strict-native";
  const canLink = containerType === "artifact" && artifact?.accessLevel !== "read";
  const addReference = useAddReference({ containerType, containerId, containerWorkType, compatibilityProfile });
  const updateReference = useMutation(api.artifactEmbeds.update);
  const removeReference = useMutation(api.artifactEmbeds.remove);
  const establish = useMutation(api.spectraArtifactLinks.establish);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [regionId, setRegionId] = useState(regions[0]?.regionId ?? "artifact:structure");
  const [adding, setAdding] = useState<string | null>(null);
  const [links, setLinks] = useState<SpectraArtifactLink[] | null>(containerType === "artifact" ? null : []);

  const failed = useCallback((error: unknown, fallback: string) => {
    toast.error(describeFailure(error, { fallback }).message);
  }, []);

  const loadLinks = useCallback(async () => {
    if (containerType !== "artifact") return;
    const result = await getSpectraArtifactLinks(containerId);
    setLinks(result.links.filter((link) => link.artifact));
  }, [containerId, containerType]);

  useEffect(() => {
    void loadLinks().catch(() => setLinks([]));
  }, [loadLinks]);

  const related = useRelated(containerType === "artifact" ? containerId : null, { limit: 12 });

  // Work about the same thing is simply linked. This asks once a sitting, and
  // only writes when there is something new to say.
  const establishing = useRef(false);
  useEffect(() => {
    if (!artifact || !canLink || links === null || related.status === "loading" || related.status === "idle") return;
    if (establishing.current || establishedThisSession.has(containerId)) return;
    const linked = new Set(links.flatMap((link) => (link.artifact?.id ? [link.artifact.id] : [])));
    const known = new Set(embeds.map((embed) => embed.sourceArtifactId));
    const targets = [
      ...related.results.filter((result) => result.kind === "artifact" && sameSubject(result)).map(workIdOf),
      ...artifacts.filter((other) => sitsWith(artifact, other)).map((other) => other._id),
    ].filter((id, index, all) => id !== containerId && !linked.has(id) && !known.has(id) && all.indexOf(id) === index);
    establishedThisSession.add(containerId);
    if (!targets.length) return;
    establishing.current = true;
    void establish({ artifactId: containerId as Id<"spectraArtifacts">, targetIds: targets.slice(0, MOST_ESTABLISHED) as Id<"spectraArtifacts">[] })
      .then((result) => (result.created ? loadLinks() : undefined))
      .catch(() => undefined)
      .finally(() => {
        establishing.current = false;
      });
  }, [artifact, artifacts, canLink, containerId, embeds, establish, links, loadLinks, related.results, related.status]);

  const semantic = useSemanticSearch(query, {
    kinds: ["artifact"],
    limit: 20,
    openItemIds: containerType === "artifact" ? [containerId] : undefined,
    enabled: searching,
  });
  const candidates = useMemo(() => {
    if (!searching) return [];
    return rankEmbedCandidates({
      artifacts,
      containerId,
      query,
      searchIds: semantic.results.map(workIdOf),
      relatedIds: related.results.map(workIdOf),
    }).slice(0, 8);
  }, [artifacts, containerId, query, related.results, searching, semantic.results]);

  async function place(source: SpectraArtifact) {
    setAdding(source._id);
    try {
      await addReference(source, { containerRegionId: regionId });
      setQuery("");
      setSearching(false);
    } catch (error) {
      failed(error, "Could not add this reference. Try again, or place it from inside the artifact.");
    } finally {
      setAdding(null);
    }
  }

  async function link(source: SpectraArtifact) {
    setAdding(source._id);
    try {
      await postSpectra({
        action: "createArtifactLink",
        sourceArtifactId: containerId,
        targetArtifactId: source._id,
        relationType: "related",
        workspaceId: artifact ? artifactPlacements(artifact)[0]?.workspaceId : undefined,
      });
      await loadLinks();
      setQuery("");
      setSearching(false);
    } catch (error) {
      failed(error, "Could not link this artifact. Check that you can still open it, then try again.");
    } finally {
      setAdding(null);
    }
  }

  async function removeLink(entry: SpectraArtifactLink) {
    const was = links;
    setLinks((current) => current?.filter((candidate) => candidate._id !== entry._id) ?? current);
    try {
      await postSpectra({ action: "removeArtifactLink", linkId: entry._id });
    } catch (error) {
      setLinks(was);
      failed(error, "Could not remove this link. Try again in a moment.");
    }
  }

  async function removeEmbed(embed: SpectraArtifactEmbed) {
    try {
      if (containerType === "artifact" && (containerWorkType === "document" || containerWorkType === "whiteboard")) {
        const dispatched = await spectraBus.commandAsyncResults("reference.remove", { hostWorkId: containerId, embedId: embed.embedId });
        const outcome = [...dispatched.results].reverse().find(
          (value): value is SpectraCommandOutcome =>
            value !== null &&
            typeof value === "object" &&
            "status" in value &&
            ["completed", "pending", "needs-human", "failed"].includes(String(value.status)) &&
            "message" in value &&
            typeof value.message === "string",
        );
        if (dispatched.listeners === 0) throw new Error("The editor is still opening. Try again once the artifact has loaded.");
        if (outcome?.status !== "completed") throw new Error(outcome?.message ?? "The reference is still in the artifact. Delete it there, or try again.");
      }
      await removeReference({ embedId: embed.embedId as Id<"artifactEmbeds"> });
    } catch (error) {
      failed(error, "Could not remove this reference. Try again, or delete it inside the artifact.");
    }
  }

  async function updateEmbed(
    embed: SpectraArtifactEmbed,
    patch: { mode?: "compact" | "expanded"; versionPolicy?: "live" | "pinned"; pinnedVersionId?: string },
  ) {
    try {
      await updateReference({
        embedId: embed.embedId as Id<"artifactEmbeds">,
        ...patch,
        pinnedVersionId: patch.pinnedVersionId as Id<"spectraArtifactVersions"> | undefined,
      });
    } catch (error) {
      failed(error, "Could not change this reference. Try again in a moment.");
    }
  }

  async function requestAccess(embed: SpectraArtifactEmbed) {
    try {
      await postSpectra({ action: "requestArtifactAccess", embedId: embed.embedId, requestedLevel: "read" });
    } catch (error) {
      failed(error, "Could not ask for access. Try again, or ask the owner to share it.");
    }
  }

  async function cancelAccess(requestId: string) {
    try {
      await postSpectra({ action: "cancelArtifactAccessRequest", requestId });
    } catch (error) {
      failed(error, "Could not cancel the request. Try again in a moment.");
    }
  }

  const placedIds = new Set(embeds.map((embed) => embed.sourceArtifactId));
  const canPlace = canConfigure && !nativeOnly;
  const canSearch = canPlace || canLink;
  const loading = live === undefined;
  const linkedRows = (links ?? []).filter((entry) => !placedIds.has(entry.artifact?.id ?? ""));
  const nothing = !loading && links !== null && embeds.length === 0 && linkedRows.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {canSearch ? (
        <div className="shrink-0 px-3 pb-2 pt-3">
          <div className="reference-search">
            <Search className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
            <input
              value={query}
              aria-label="Find artifacts to add"
              placeholder="Find artifacts to add"
              onFocus={() => setSearching(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearching(true);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !searching) return;
                event.stopPropagation();
                setQuery("");
                setSearching(false);
                event.currentTarget.blur();
              }}
            />
            {searching ? (
              <IconButton
                icon={<X className="size-4" />}
                size="compact"
                label="Stop searching"
                onClick={() => {
                  setQuery("");
                  setSearching(false);
                }}
              />
            ) : null}
          </div>
          {searching && canPlace && regions.length > 1 ? (
            <SelectField
              ariaLabel="Where to place it"
              size="sm"
              value={regionId}
              onChange={setRegionId}
              className="mt-2"
              options={regions.map((region) => ({ value: region.regionId, label: `Place in ${region.label}` }))}
            />
          ) : null}
        </div>
      ) : null}

      {nativeOnly && canConfigure ? (
        <p className="shrink-0 px-4 pb-2 text-micro leading-5 text-[var(--text-secondary)]">
          This file stays exactly as its app writes it, so an artifact is linked beside it rather than placed inside it.
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {searching ? (
          candidates.length ? (
            <ul aria-label="Artifacts you can add">
              {candidates.map((candidate) => {
                const busy = adding === candidate._id;
                return (
                  <ReferenceRow
                    key={candidate._id}
                    title={candidate.title}
                    detail={workTypeMeta[candidate.blueprintKey]?.label}
                    type={candidate.blueprintKey}
                    onOpen={canPlace ? () => void place(candidate) : canLink ? () => void link(candidate) : undefined}
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin text-[var(--text-tertiary)]" />
                    ) : canPlace && canLink ? (
                      <IconButton icon={<Link2 className="size-4" />} size="compact" label={`Link ${candidate.title} without placing it`} onClick={() => void link(candidate)} />
                    ) : (
                      <Plus className="mr-1.5 size-3.5 text-[var(--text-tertiary)]" />
                    )}
                  </ReferenceRow>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-micro text-[var(--text-tertiary)]">
              {semantic.status === "loading" ? "Searching your artifacts" : query.trim() ? "Nothing you can open matches that." : "Type to find an artifact."}
            </p>
          )
        ) : loading ? (
          <LoadingRows label="Loading references" count={3} className="px-2 pt-2" />
        ) : nothing ? (
          <EmptyState
            compact
            icon="link"
            title="Nothing linked yet"
            detail={canSearch ? "Search above, or right click in the artifact to place something right where you are." : "This artifact doesn't draw on anything else."}
          />
        ) : (
          <>
            {embeds.length ? (
              <section className="reference-section">
                <h3>In this artifact</h3>
                <ul>
                  {embeds.map((embed) => (
                    <PlacedReference
                      key={embed.embedId}
                      embed={embed}
                      regionLabel={regions.length > 1 ? regions.find((region) => region.regionId === embed.containerRegionId)?.label : undefined}
                      onOpenSource={onOpenSource}
                      onUpdate={(patch) => updateEmbed(embed, patch)}
                      onRemove={() => removeEmbed(embed)}
                      onRequestAccess={() => requestAccess(embed)}
                      onCancelAccess={cancelAccess}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {linkedRows.length ? (
              <section className="reference-section">
                <h3>Linked artifact</h3>
                <ul>
                  {linkedRows.map((entry) => (
                    <ReferenceRow
                      key={entry._id}
                      title={entry.artifact?.title ?? "Linked artifact"}
                      detail={entry.createdBy === "system" ? "About the same thing" : entry.relationType === "related" ? "Linked" : entry.relationType.replaceAll("_", " ")}
                      type={entry.artifact?.blueprintKey}
                      onOpen={entry.artifact && onOpenSource ? () => onOpenSource(entry.artifact!.id) : undefined}
                    >
                      {canLink ? <IconButton icon={<X className="size-4" />} size="compact" label={`Remove the link to ${entry.artifact?.title ?? "this artifact"}`} onClick={() => void removeLink(entry)} /> : null}
                    </ReferenceRow>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
