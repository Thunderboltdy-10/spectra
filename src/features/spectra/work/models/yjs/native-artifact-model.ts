import * as Y from "yjs";
import type { ArtifactTypeKey, SemanticRegion } from "../../../artifacts/types";
import type { ArtifactRegionController } from "../../../collaboration/region-controller";
import type { ArtifactCollaborationTransport } from "../../../collaboration/types";
import { boundedRegionClaims } from "../../../../../../shared/region-claim-policy";
import {
  changedArtifactRegionIds,
  readArtifactYjsDocument,
  type ArtifactLiveModelSnapshot,
  type ArtifactLiveValue,
  type StoredArtifactRegionDescriptor,
  type ArtifactYjsMutationPlan,
} from "../../../collaboration/artifact-yjs-model";
import { documentContentToProseMirrorJson } from "../../../lenses/document-projection";
import { workYjsAdapter } from "./registry";
import { plainToY, shareUnchanged, workMeta, workRoot, yToPlain } from "./shared";
import { workYjsOrigins } from "./origins";
import type { WorkActorIdentity, WorkYjsAdapter } from "./contracts";
import { describeSheetsCellRegion } from "../../../artifacts/registry";
import {
  applySheetsCellProjection,
  planSheetsCellProjection,
  type SheetsCellProjectionPlan,
} from "./structured-adapters";

export const NATIVE_WORK_LIVE_META_MAP = "spectra:work-v2:live-meta";
const SNAPSHOT_PROJECTION_DELAY_MS = 120;
const EMPTY: ArtifactLiveModelSnapshot = {
  initialized: false,
  validity: "uninitialized",
  value: null,
  regionIds: [],
};

function valueAtPath(value: unknown, path: readonly (string | number)[]) {
  let current = value as unknown;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function replaceAtPath(
  value: unknown,
  path: readonly (string | number)[],
  replacement: unknown,
) {
  if (path.length === 0) return replacement;
  if (value === null || typeof value !== "object")
    throw new Error(`NATIVE_PARTIAL_RESTORE_PATH_INVALID: ${path.join("/")}`);
  let current = value as Record<string | number, unknown>;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    const nextSegment = path[index + 1]!;
    const existing = current[segment];
    if (existing === null || typeof existing !== "object")
      current[segment] =
        typeof nextSegment === "number" ||
        (typeof nextSegment === "string" && /^\d+$/.test(nextSegment))
          ? []
          : {};
    current = current[segment] as Record<string | number, unknown>;
  }
  current[path[path.length - 1]!] = replacement;
  return value;
}

function descriptorMatches(left: SemanticRegion, right: SemanticRegion) {
  return (
    left.kind === right.kind &&
    left.overlapDomain === right.overlapDomain &&
    JSON.stringify(left.path) === JSON.stringify(right.path) &&
    left.parentRegionId === right.parentRegionId
  );
}

function actorFor(
  transport: ArtifactCollaborationTransport,
): WorkActorIdentity {
  const snapshot = transport.getSnapshot();
  return {
    clientId: transport.clientId,
    kind: "human",
    ...(snapshot.accountId ? { accountId: snapshot.accountId } : {}),
    ...(snapshot.displayName ? { name: snapshot.displayName } : {}),
  };
}

export class NativeArtifactYjsModel {
  readonly native = true;
  readonly adapter: WorkYjsAdapter<unknown>;
  readonly actor: WorkActorIdentity;
  readonly undoManager: Y.UndoManager;
  private readonly liveMeta: Y.Map<unknown>;
  private readonly listeners = new Set<() => void>();
  private snapshot: ArtifactLiveModelSnapshot = EMPTY;
  private regionsById = new Map<string, SemanticRegion>();
  private destroyed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scheduleRefresh: () => void;

  constructor(
    readonly typeKey: ArtifactTypeKey,
    readonly transport: ArtifactCollaborationTransport,
  ) {
    this.adapter = workYjsAdapter(typeKey);
    this.actor = actorFor(transport);
    this.liveMeta = transport.document.getMap<unknown>(
      NATIVE_WORK_LIVE_META_MAP,
    );
    this.undoManager = this.adapter.createUndoManager(
      transport.document,
      this.actor,
    );
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

  /**
   * Native document/code bodies are written straight into Yjs. The coalesced
   * snapshot is a render/index optimization, not the promotion source. Flush
   * before metadata-only save or Bridge recovery so materialize sees the live
   * fragment rather than the last projected echo.
   */
  flushSnapshot() {
    this.rebuildSnapshotImmediately();
    return this.snapshot;
  }

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
    this.regionsById.clear();
    this.listeners.clear();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private rebuildSnapshot() {
    if (workMeta(this.transport.document).get("initialized") !== true) {
      this.snapshot = EMPTY;
      this.regionsById.clear();
      this.emit();
      return;
    }
    try {
      const content = shareUnchanged(
        this.snapshot.value?.content,
        this.adapter.project(this.transport.document),
      );
      const validation = this.adapter.validate(
        this.transport.document,
        content,
      );
      if (!validation.valid) throw new Error(validation.issues.join("; "));
      const title = this.liveMeta.get("title");
      const summary = this.liveMeta.get("summary");
      const tags = this.liveMeta.get("tags");
      if (typeof title !== "string" || !Array.isArray(tags))
        throw new Error("NATIVE_WORK_METADATA_INVALID");
      const regions = this.adapter.deriveSemanticRegions(
        this.transport.document,
        content,
      );
      this.regionsById = new Map(
        regions.map((region) => [region.regionId, region]),
      );
      this.snapshot = shareUnchanged(this.snapshot, {
        initialized: true,
        validity: "valid",
        value: {
          title,
          ...(typeof summary === "string" && summary ? { summary } : {}),
          tags: tags.filter((tag): tag is string => typeof tag === "string"),
          content,
        },
        regionIds: regions.map((region) => region.regionId).sort(),
      } satisfies ArtifactLiveModelSnapshot);
    } catch (error) {
      this.regionsById.clear();
      this.snapshot = {
        initialized: true,
        validity: "invalid",
        value: null,
        regionIds: [],
        error:
          error instanceof Error
            ? error.message
            : "Native work state is invalid.",
      };
    }
    this.emit();
  }

  private rebuildSnapshotImmediately() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.rebuildSnapshot();
  }

  private exposeAppliedSheetSnapshot(
    value: ArtifactLiveValue,
    plan: SheetsCellProjectionPlan,
  ) {
    this.snapshot = {
      initialized: true,
      validity: "valid",
      value: {
        title: value.title,
        ...(value.summary ? { summary: value.summary } : {}),
        tags: [...value.tags],
        // No deep share here: comparing every cell of a dense workbook cost
        // more than the cell write itself, and the scheduled projection
        // refresh shares unchanged values anyway.
        content: plan.content,
      },
      // A cell-only edit keeps the existing semantic index usable until the
      // scheduled bounded projection refresh accounts for an added/deleted
      // address. Crucially, native materialization can read the new cell now.
      regionIds: this.snapshot.regionIds,
    };
    this.emit();
  }

  private writeMetadata(value: ArtifactLiveValue) {
    if (this.liveMeta.get("title") !== value.title)
      this.liveMeta.set("title", value.title);
    if (this.liveMeta.get("summary") !== (value.summary ?? ""))
      this.liveMeta.set("summary", value.summary ?? "");
    const currentTags = this.liveMeta.get("tags");
    if (
      !Array.isArray(currentTags) ||
      currentTags.length !== value.tags.length ||
      currentTags.some((tag, index) => tag !== value.tags[index])
    )
      this.liveMeta.set("tags", [...value.tags]);

    // Native document bodies live in the XML fragment, but page chrome is an
    // adapter extra beside that fragment. Keep it in the same durable Yjs
    // transaction as the title/summary/tags metadata so a header or footer
    // cannot disappear on the metadata-only save path.
    if (this.typeKey === "document") {
      const root = workRoot(this.transport.document);
      const currentExtras = record(yToPlain(root.get("extras")));
      const nextPageSetup = record(value.content).pageSetup;
      if (
        nextPageSetup !== undefined &&
        JSON.stringify(currentExtras.pageSetup) !== JSON.stringify(nextPageSetup)
      ) {
        root.set(
          "extras",
          plainToY({ ...currentExtras, pageSetup: nextPageSetup }),
        );
      }
    }
  }

  private async initialize(
    value: ArtifactLiveValue,
    controller: ArtifactRegionController,
  ) {
    let source = value;
    try {
      source =
        readArtifactYjsDocument(this.transport.document, this.typeKey) ?? value;
    } catch {
      // A malformed legacy room is not allowed to replace the validated Convex
      // baseline. Its maps remain available for rollback/diagnostics.
    }
    await controller.edit(
      "artifact:structure",
      ["artifact:structure"],
      () => {
        if (workMeta(this.transport.document).get("initialized") === true)
          return;
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
      },
    );
    this.rebuildSnapshotImmediately();
    return { applied: true as const };
  }

  descriptor(regionId: string): StoredArtifactRegionDescriptor | null {
    const region =
      this.regionsById.get(regionId) ??
      (this.typeKey === "sheets" && this.snapshot.value
        ? describeSheetsCellRegion(this.snapshot.value.content, regionId)
        : undefined);
    return region
      ? {
          regionId: region.regionId,
          kind: region.kind,
          label: region.label,
          path: [...region.path],
          overlapDomain: region.overlapDomain,
          ...(region.parentRegionId
            ? { parentRegionId: region.parentRegionId }
            : {}),
        }
      : null;
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
        ? [
            {
              regionId: "metadata:summary",
              overlapDomains: ["metadata:summary"],
            },
          ]
        : []),
      ...(JSON.stringify(current?.tags ?? []) !== JSON.stringify(value.tags)
        ? [{ regionId: "metadata:tags", overlapDomains: ["metadata:tags"] }]
        : []),
      ...(this.typeKey === "document" &&
      JSON.stringify(record(current?.content).pageSetup) !==
        JSON.stringify(record(value.content).pageSetup)
        ? [
            {
              regionId: "document:page-setup",
              overlapDomains: ["document:page-setup"],
            },
          ]
        : []),
    ];
    if (!claims.length) {
      this.rebuildSnapshotImmediately();
      return { applied: true as const };
    }
    const result = await controller.editMany(claims, () =>
      this.writeMetadata(value),
    );
    this.rebuildSnapshotImmediately();
    return result;
  }

  async replaceSnapshot(
    value: ArtifactLiveValue,
    controller: ArtifactRegionController,
  ) {
    if (!this.snapshot.initialized) {
      if (workMeta(this.transport.document).get("initialized") === true)
        this.rebuildSnapshotImmediately();
      else return this.initialize(value, controller);
    }
    const current = this.snapshot.value;
    const sheetPlan =
      this.typeKey === "sheets" && current
        ? planSheetsCellProjection(current.content, value.content)
        : null;
    let contentChanged = sheetPlan
      ? sheetPlan.changes.length > 0
      : current
        ? changedArtifactRegionIds(
            this.typeKey,
            current.content,
            value.content,
          ).length > 0
        : true;
    if (
      !contentChanged &&
      this.typeKey === "document" &&
      current &&
      JSON.stringify(
        documentContentToProseMirrorJson(
          current.content as Record<string, unknown>,
        ),
      ) !==
        JSON.stringify(
          documentContentToProseMirrorJson(
            value.content as Record<string, unknown>,
          ),
        )
    )
      contentChanged = true;
    // This is an explicit edit/restore API, not a bootstrap hydration path.
    // Valid clears and short/nontext bodies must produce the requested Yjs edit.
    const regions = contentChanged
      ? sheetPlan
        ? sheetPlan.changes.map((change) => ({
            regionId: change.regionId,
            overlapDomains: [change.regionId],
          }))
        : [
            {
              regionId: "artifact:structure",
              overlapDomains: ["artifact:structure"],
            },
          ]
      : [];
    const metadataClaims = [
      ...(current?.title !== value.title
        ? [{ regionId: "metadata:title", overlapDomains: ["metadata:title"] }]
        : []),
      ...((current?.summary ?? "") !== (value.summary ?? "")
        ? [
            {
              regionId: "metadata:summary",
              overlapDomains: ["metadata:summary"],
            },
          ]
        : []),
      ...(JSON.stringify(current?.tags ?? []) !== JSON.stringify(value.tags)
        ? [{ regionId: "metadata:tags", overlapDomains: ["metadata:tags"] }]
        : []),
    ];
    const claims = [...regions, ...metadataClaims];
    if (!claims.length) return { applied: true as const };
    const result = await controller.editMany(boundedRegionClaims(claims), () => {
      if (contentChanged && sheetPlan)
        applySheetsCellProjection(
          this.transport.document,
          sheetPlan,
          workYjsOrigins(this.actor).localHuman,
        );
      else if (contentChanged) {
        this.adapter.applyProjection(
          this.transport.document,
          value.content,
          this.typeKey === "document"
            ? workYjsOrigins(this.actor).sourceUpdate
            : workYjsOrigins(this.actor).localHuman,
        );
      }
      this.writeMetadata(value);
    });
    if (sheetPlan) this.exposeAppliedSheetSnapshot(value, sheetPlan);
    else this.rebuildSnapshotImmediately();
    return result;
  }

  async replaceRegionsFromSnapshot(
    value: ArtifactLiveValue,
    regionIds: readonly string[],
    controller: ArtifactRegionController,
  ) {
    const selected = [...new Set(regionIds)];
    if (selected.length === 0) return { applied: true as const };
    if (selected.includes("artifact:structure"))
      return this.replaceSnapshot(value, controller);
    const plan = planNativeArtifactYjsRestore(this.transport.document, this.typeKey, value, this.actor, selected);
    const result = await controller.editMany(plan.regions, plan.apply);
    this.rebuildSnapshotImmediately();
    return result;
  }
}

/** A prepared selection has no Yjs effect until apply runs. The server uses
 * the same region identity checks when preparing an admitted history restore. */
export function planNativeArtifactYjsRestore(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
  value: ArtifactLiveValue,
  actor: WorkActorIdentity,
  regionIds?: readonly string[],
): ArtifactYjsMutationPlan {
  if (!regionIds || regionIds.includes("artifact:structure"))
    return planNativeArtifactYjsMutation(document, typeKey, value, actor);
  const selected = [...new Set(regionIds)];
  const metadataRegions = new Set(["metadata:title", "metadata:summary", "metadata:tags"]);
  const contentRegions = selected.filter(regionId => !metadataRegions.has(regionId));
  const adapter = workYjsAdapter(typeKey);
  const historicalRegions = new Map(adapter.deriveSemanticRegions(document, value.content)
    .map(region => [region.regionId, region]));
  const currentRegions = new Map(adapter.deriveSemanticRegions(document, adapter.project(document))
    .map(region => [region.regionId, region]));
  const claims = selected.map(regionId => {
    if (metadataRegions.has(regionId)) return { regionId, overlapDomains: [regionId] };
    const current = currentRegions.get(regionId);
    const historical = historicalRegions.get(regionId);
    if (!current || !historical || !descriptorMatches(current, historical))
      throw new Error(`NATIVE_PARTIAL_RESTORE_STRUCTURE_CHANGED: ${regionId}`);
    return { regionId, overlapDomains: [current.overlapDomain] };
  });
  return {
    regions: claims,
    apply: () => {
      const live = adapter.project(document);
      let merged = structuredClone(live);
      const liveRegions = new Map(adapter.deriveSemanticRegions(document, live)
        .map(region => [region.regionId, region]));
      for (const regionId of contentRegions) {
        const current = liveRegions.get(regionId);
        const historical = historicalRegions.get(regionId);
        if (!current || !historical || !descriptorMatches(current, historical))
          throw new Error(`NATIVE_PARTIAL_RESTORE_STRUCTURE_CHANGED: ${regionId}`);
        const historicalValue = valueAtPath(value.content, historical.path);
        if (historicalValue === undefined)
          throw new Error(`NATIVE_PARTIAL_RESTORE_VALUE_MISSING: ${regionId}`);
        merged = replaceAtPath(merged, current.path, structuredClone(historicalValue));
      }
      if (contentRegions.length) adapter.applyProjection(document, merged, workYjsOrigins(actor).localHuman);
      const meta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
      if (selected.includes("metadata:title")) meta.set("title", value.title);
      if (selected.includes("metadata:summary")) meta.set("summary", value.summary ?? "");
      if (selected.includes("metadata:tags")) meta.set("tags", [...value.tags]);
    },
  };
}

export function readNativeArtifactYjsDocument(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
): ArtifactLiveValue | null {
  if (workMeta(document).get("initialized") !== true) return null;
  const adapter = workYjsAdapter(typeKey);
  const content = adapter.project(document);
  const validation = adapter.validate(document, content);
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
    content,
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
      regions: [
        {
          regionId: "artifact:structure",
          overlapDomains: ["artifact:structure"],
        },
      ],
      apply: () => {
        adapter.applyProjection(
          document,
          value.content,
          workYjsOrigins(actor).migration,
        );
        const meta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
        meta.set("title", value.title);
        meta.set("summary", value.summary ?? "");
        meta.set("tags", [...value.tags]);
      },
    };
  }
  const sheetPlan =
    typeKey === "sheets"
      ? planSheetsCellProjection(current.content, value.content)
      : null;
  const changed = sheetPlan
    ? sheetPlan.changes.map((change) => change.regionId)
    : changedArtifactRegionIds(typeKey, current.content, value.content);
  const descriptors = sheetPlan
    ? null
    : new Map(
        adapter
          .deriveSemanticRegions(document, current.content)
          .map((region) => [region.regionId, region] as const),
      );
  const regions = changed.map((regionId) => ({
    regionId,
    overlapDomains: [
      regionId === "artifact:structure"
        ? "artifact:structure"
        : (descriptors?.get(regionId)?.overlapDomain ?? regionId),
    ],
  }));
  if (current.title !== value.title)
    regions.push({
      regionId: "metadata:title",
      overlapDomains: ["metadata:title"],
    });
  if ((current.summary ?? "") !== (value.summary ?? ""))
    regions.push({
      regionId: "metadata:summary",
      overlapDomains: ["metadata:summary"],
    });
  if (JSON.stringify(current.tags) !== JSON.stringify(value.tags))
    regions.push({
      regionId: "metadata:tags",
      overlapDomains: ["metadata:tags"],
    });
  return {
    regions,
    apply: () => {
      if (changed.length && sheetPlan)
        applySheetsCellProjection(
          document,
          sheetPlan,
          workYjsOrigins(actor).ai,
        );
      else if (changed.length)
        adapter.applyProjection(
          document,
          value.content,
          workYjsOrigins(actor).ai,
        );
      const meta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
      if (meta.get("title") !== value.title) meta.set("title", value.title);
      if (meta.get("summary") !== (value.summary ?? ""))
        meta.set("summary", value.summary ?? "");
      const currentTags = meta.get("tags");
      if (
        !Array.isArray(currentTags) ||
        currentTags.length !== value.tags.length ||
        currentTags.some((tag, index) => tag !== value.tags[index])
      )
        meta.set("tags", [...value.tags]);
    },
  };
}
