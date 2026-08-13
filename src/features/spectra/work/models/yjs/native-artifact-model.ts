import * as Y from "yjs";
import type { ArtifactTypeKey, SemanticRegion } from "../../../artifacts/types";
import type { ArtifactRegionController } from "../../../collaboration/region-controller";
import type { ArtifactCollaborationTransport } from "../../../collaboration/types";
import {
  changedArtifactRegionIds,
  readArtifactYjsDocument,
  type ArtifactLiveModelSnapshot,
  type ArtifactLiveValue,
  type StoredArtifactRegionDescriptor,
  type ArtifactYjsMutationPlan,
} from "../../../collaboration/artifact-yjs-model";
import { workYjsAdapter } from "./registry";
import { workMeta } from "./shared";
import { workYjsOrigins } from "./origins";
import type { WorkActorIdentity, WorkYjsAdapter } from "./contracts";

export const NATIVE_WORK_LIVE_META_MAP = "spectra:work-v2:live-meta";
const SNAPSHOT_PROJECTION_DELAY_MS = 120;
const EMPTY: ArtifactLiveModelSnapshot = {
  initialized: false,
  validity: "uninitialized",
  value: null,
  regionIds: [],
};

function actorFor(transport: ArtifactCollaborationTransport): WorkActorIdentity {
  const snapshot = transport.getSnapshot();
  return {
    clientId: transport.clientId,
    kind: "human",
    ...(snapshot.accountId ? { accountId: snapshot.accountId } : {}),
    ...(snapshot.displayName ? { name: snapshot.displayName } : {}),
  };
}

function regionClaims(regions: readonly SemanticRegion[]) {
  return regions.map((region) => ({
    regionId: region.regionId,
    overlapDomains: [region.overlapDomain],
  }));
}

export class NativeArtifactYjsModel {
  readonly native = true;
  readonly adapter: WorkYjsAdapter<unknown>;
  readonly actor: WorkActorIdentity;
  readonly undoManager: Y.UndoManager;
  private readonly liveMeta: Y.Map<unknown>;
  private readonly listeners = new Set<() => void>();
  private snapshot: ArtifactLiveModelSnapshot = EMPTY;
  private destroyed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scheduleRefresh: () => void;

  constructor(
    readonly typeKey: ArtifactTypeKey,
    readonly transport: ArtifactCollaborationTransport,
  ) {
    this.adapter = workYjsAdapter(typeKey);
    this.actor = actorFor(transport);
    this.liveMeta = transport.document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    this.undoManager = this.adapter.createUndoManager(transport.document, this.actor);
    // Document and Code editors bind to native Yjs types directly. Projecting
    // their entire body in the synchronous Y.Doc update callback duplicated the
    // editor work on every keystroke and put JSON allocation on the input path.
    // Metadata/semantic consumers can tolerate a short coalescing window, so a
    // burst of updates now pays for one projection after the input task yields.
    this.scheduleRefresh = () => {
      if (this.destroyed || this.refreshTimer !== null) return;
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.rebuildSnapshot();
      }, SNAPSHOT_PROJECTION_DELAY_MS);
    };
    transport.document.on("update", this.scheduleRefresh);
    this.rebuildSnapshot();
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!this.transport.document.isDestroyed) {
      this.transport.document.off("update", this.scheduleRefresh);
      this.undoManager.destroy();
    }
    this.listeners.clear();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private rebuildSnapshot() {
    if (workMeta(this.transport.document).get("initialized") !== true) {
      this.snapshot = EMPTY;
      this.emit();
      return;
    }
    try {
      const content = this.adapter.project(this.transport.document);
      const validation = this.adapter.validate(this.transport.document);
      if (!validation.valid) throw new Error(validation.issues.join("; "));
      const title = this.liveMeta.get("title");
      const summary = this.liveMeta.get("summary");
      const tags = this.liveMeta.get("tags");
      if (typeof title !== "string" || !Array.isArray(tags))
        throw new Error("NATIVE_WORK_METADATA_INVALID");
      const regions = this.adapter.deriveSemanticRegions(this.transport.document);
      this.snapshot = {
        initialized: true,
        validity: "valid",
        value: {
          title,
          ...(typeof summary === "string" && summary ? { summary } : {}),
          tags: tags.filter((tag): tag is string => typeof tag === "string"),
          content,
        },
        regionIds: regions.map((region) => region.regionId).sort(),
      };
    } catch (error) {
      this.snapshot = {
        initialized: true,
        validity: "invalid",
        value: null,
        regionIds: [],
        error: error instanceof Error ? error.message : "Native work state is invalid.",
      };
    }
    this.emit();
  }

  private writeMetadata(value: ArtifactLiveValue) {
    this.liveMeta.set("title", value.title);
    this.liveMeta.set("summary", value.summary ?? "");
    this.liveMeta.set("tags", [...value.tags]);
  }

  async initialize(value: ArtifactLiveValue, controller: ArtifactRegionController) {
    if (this.snapshot.initialized)
      return { applied: false as const, reason: "already_initialized" as const };
    let source = value;
    try {
      source = readArtifactYjsDocument(this.transport.document, this.typeKey) ?? value;
    } catch {
      // A malformed legacy room is not allowed to replace the validated Convex
      // baseline. Its maps remain available for rollback/diagnostics.
    }
    const result = await controller.edit("artifact:structure", ["artifact:structure"], () => {
      if (workMeta(this.transport.document).get("initialized") === true) return;
      const migrated = this.adapter.migrateLegacy({
        workType: this.typeKey,
        content: source.content,
      });
      Y.applyUpdate(
        this.transport.document,
        Y.encodeStateAsUpdate(migrated.document),
        workYjsOrigins(this.actor).migration,
      );
      this.writeMetadata(source);
    });
    return result.applied
      ? { applied: true as const }
      : { applied: false as const, reason: "conflict" as const, claim: result.claim };
  }

  descriptor(regionId: string): StoredArtifactRegionDescriptor | null {
    const region = this.adapter
      .deriveSemanticRegions(this.transport.document)
      .find((candidate) => candidate.regionId === regionId);
    return region
      ? {
          regionId: region.regionId,
          kind: region.kind,
          label: region.label,
          path: [...region.path],
          overlapDomain: region.overlapDomain,
          ...(region.parentRegionId ? { parentRegionId: region.parentRegionId } : {}),
        }
      : null;
  }

  async replaceMetadata(
    field: "title" | "summary" | "tags",
    value: string | string[],
    controller: ArtifactRegionController,
  ) {
    const regionId = `metadata:${field}`;
    return controller.edit(regionId, [regionId], () => {
      this.liveMeta.set(field, Array.isArray(value) ? [...value] : value);
    });
  }

  async replaceMetadataSnapshot(
    value: ArtifactLiveValue,
    controller: ArtifactRegionController,
  ) {
    const current = this.snapshot.value;
    const claims = [
      ...(current?.title !== value.title
        ? [{ regionId: "metadata:title", overlapDomains: ["metadata:title"] }]
        : []),
      ...((current?.summary ?? "") !== (value.summary ?? "")
        ? [{ regionId: "metadata:summary", overlapDomains: ["metadata:summary"] }]
        : []),
      ...(JSON.stringify(current?.tags ?? []) !== JSON.stringify(value.tags)
        ? [{ regionId: "metadata:tags", overlapDomains: ["metadata:tags"] }]
        : []),
    ];
    if (!claims.length) return { applied: true as const, claims: [] };
    return controller.editMany(claims, () => this.writeMetadata(value));
  }

  async replaceRegion(
    _regionId: string,
    _value: unknown,
    _controller: ArtifactRegionController,
  ) {
    throw new Error("NATIVE_WORK_REGION_REPLACEMENT_REQUIRES_SEMANTIC_ACTION");
  }

  async replaceSnapshot(value: ArtifactLiveValue, controller: ArtifactRegionController) {
    if (!this.snapshot.initialized) return this.initialize(value, controller);
    const current = this.snapshot.value;
    const contentChanged = JSON.stringify(current?.content) !== JSON.stringify(value.content);
    const regions = contentChanged
      ? regionClaims(this.adapter.deriveSemanticRegions(this.transport.document))
      : [];
    const metadataClaims = [
      ...(current?.title !== value.title
        ? [{ regionId: "metadata:title", overlapDomains: ["metadata:title"] }]
        : []),
      ...((current?.summary ?? "") !== (value.summary ?? "")
        ? [{ regionId: "metadata:summary", overlapDomains: ["metadata:summary"] }]
        : []),
      ...(JSON.stringify(current?.tags ?? []) !== JSON.stringify(value.tags)
        ? [{ regionId: "metadata:tags", overlapDomains: ["metadata:tags"] }]
        : []),
    ];
    const claims = [...regions, ...metadataClaims];
    if (!claims.length) return { applied: true as const, claims: [] };
    return controller.editMany(claims.slice(0, 128), () => {
      if (contentChanged)
        this.adapter.applyProjection(
          this.transport.document,
          value.content,
          workYjsOrigins(this.actor).localHuman,
        );
      this.writeMetadata(value);
    });
  }

  async replaceRegionsFromSnapshot(
    value: ArtifactLiveValue,
    regionIds: readonly string[],
    controller: ArtifactRegionController,
  ) {
    const selected = new Set(regionIds);
    const onlyMetadata = [...selected].every((id) => id.startsWith("metadata:"));
    if (onlyMetadata) {
      const claims = [...selected].map((regionId) => ({ regionId, overlapDomains: [regionId] }));
      return controller.editMany(claims, () => {
        if (selected.has("metadata:title")) this.liveMeta.set("title", value.title);
        if (selected.has("metadata:summary")) this.liveMeta.set("summary", value.summary ?? "");
        if (selected.has("metadata:tags")) this.liveMeta.set("tags", [...value.tags]);
      });
    }
    return this.replaceSnapshot(value, controller);
  }
}

export function readNativeArtifactYjsDocument(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
): ArtifactLiveValue | null {
  if (workMeta(document).get("initialized") !== true) return null;
  const adapter = workYjsAdapter(typeKey);
  const validation = adapter.validate(document);
  if (!validation.valid)
    throw new Error(`NATIVE_WORK_INVALID: ${validation.issues.join("; ")}`);
  const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
  const title = liveMeta.get("title");
  const summary = liveMeta.get("summary");
  const tags = liveMeta.get("tags");
  if (typeof title !== "string" || !Array.isArray(tags))
    throw new Error("NATIVE_WORK_METADATA_INVALID");
  return {
    title,
    ...(typeof summary === "string" && summary ? { summary } : {}),
    tags: tags.filter((entry): entry is string => typeof entry === "string"),
    content: adapter.project(document),
  };
}

export function planNativeArtifactYjsMutation(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
  value: ArtifactLiveValue,
  actor: WorkActorIdentity,
): ArtifactYjsMutationPlan {
  const adapter = workYjsAdapter(typeKey);
  const current = readNativeArtifactYjsDocument(document, typeKey);
  if (!current) {
    return {
      regions: [{ regionId: "artifact:structure", overlapDomains: ["artifact:structure"] }],
      apply: () => {
        adapter.applyProjection(document, value.content, workYjsOrigins(actor).migration);
        const meta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
        meta.set("title", value.title);
        meta.set("summary", value.summary ?? "");
        meta.set("tags", [...value.tags]);
      },
    };
  }
  const changed = changedArtifactRegionIds(typeKey, current.content, value.content);
  const descriptors = new Map(
    adapter
      .deriveSemanticRegions(document)
      .map((region) => [region.regionId, region] as const),
  );
  const regions = changed.map((regionId) => ({
    regionId,
    overlapDomains: [
      regionId === "artifact:structure"
        ? "artifact:structure"
        : descriptors.get(regionId)?.overlapDomain ?? regionId,
    ],
  }));
  if (current.title !== value.title)
    regions.push({ regionId: "metadata:title", overlapDomains: ["metadata:title"] });
  if ((current.summary ?? "") !== (value.summary ?? ""))
    regions.push({ regionId: "metadata:summary", overlapDomains: ["metadata:summary"] });
  if (JSON.stringify(current.tags) !== JSON.stringify(value.tags))
    regions.push({ regionId: "metadata:tags", overlapDomains: ["metadata:tags"] });
  return {
    regions,
    apply: () => {
      if (changed.length)
        adapter.applyProjection(document, value.content, workYjsOrigins(actor).ai);
      const meta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
      meta.set("title", value.title);
      meta.set("summary", value.summary ?? "");
      meta.set("tags", [...value.tags]);
    },
  };
}
