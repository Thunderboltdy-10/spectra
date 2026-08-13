import * as Y from "yjs";
import {
  enumerateArtifactRegions,
  requireArtifactTypeManifest,
  validateArtifactContent,
} from "../artifacts/registry";
import type { ArtifactTypeKey, SemanticRegion } from "../artifacts/types";
import { normalizeWhiteboardContent } from "../whiteboard/model";
import { normalizeArtifactContent } from "../ai/content-normalization";
import type { ArtifactRegionController } from "./region-controller";
import type { ArtifactCollaborationTransport } from "./types";

export const ARTIFACT_YJS_META_MAP = "spectra:artifact-meta";
export const ARTIFACT_YJS_REGION_MAP = "spectra:artifact-regions";
export const ARTIFACT_YJS_DESCRIPTOR_MAP =
  "spectra:artifact-region-descriptors";
const REGION_MARKER = "$spectraRegion";
const CODE_LINES_MARKER = "$spectraCodeLines";
const MODEL_VERSION = 1;

function coerceArtifactContent(typeKey: ArtifactTypeKey, content: unknown) {
  try {
    return normalizeArtifactContent(typeKey, content);
  } catch {
    // Last-resort whiteboard coerce keeps create/apply from hard-failing when
    // the shared normalizer rejects an incomplete draft.
    if (typeKey === "whiteboard") return normalizeWhiteboardContent(content);
    return content;
  }
}

export type ArtifactLiveValue = {
  title: string;
  summary?: string;
  tags: string[];
  content: unknown;
};

/**
 * Prefer a valid live Yjs projection over a Convex baseline record. Used when
 * the collaboration room is ahead of spectraArtifacts.content (common right
 * after a TipTap save before / without a durable projection write).
 */
export function overlayLiveArtifactRecord<T extends Record<string, unknown>>(
  baseline: T,
  live: ArtifactLiveValue | null | undefined,
): T {
  if (!live) return baseline;
  return {
    ...baseline,
    title: live.title,
    summary: live.summary ?? baseline.summary,
    tags: live.tags,
    content: live.content,
  };
}

export type ArtifactLiveModelSnapshot = {
  initialized: boolean;
  validity: "valid" | "invalid" | "uninitialized";
  value: ArtifactLiveValue | null;
  regionIds: readonly string[];
  error?: string;
};

export type StoredArtifactRegionDescriptor = Pick<
  SemanticRegion,
  "regionId" | "kind" | "label" | "path" | "parentRegionId" | "overlapDomain"
>;

export type DecomposedArtifact = {
  rootTemplate: string;
  descriptors: Map<string, StoredArtifactRegionDescriptor>;
  regionValues: Map<string, string>;
};

export type ArtifactYjsMutationRegion = {
  regionId: string;
  overlapDomains: string[];
};

export type ArtifactYjsMutationPlan = {
  regions: ArtifactYjsMutationRegion[];
  apply: () => void;
};

export type ArtifactRegionSnapshot = {
  artifactType: ArtifactTypeKey;
  regions: Array<{
    regionId: string;
    label: string;
    value: unknown;
    truncated?: boolean;
  }>;
};

const UNINITIALIZED_SNAPSHOT: ArtifactLiveModelSnapshot = {
  initialized: false,
  validity: "uninitialized",
  value: null,
  regionIds: [],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function marker(regionId: string) {
  return { [REGION_MARKER]: regionId };
}

function codeLinesMarker(regionIds: readonly string[]) {
  return { [CODE_LINES_MARKER]: [...regionIds] };
}

function encodeRegionValue(value: unknown) {
  return JSON.stringify({ value });
}

function decodeRegionValue(encoded: string) {
  return (JSON.parse(encoded) as { value?: unknown }).value;
}

function boundedSnapshotValue(value: unknown) {
  const encoded = JSON.stringify(value);
  // Optional metadata (most often summary) is legitimately undefined. JSON
  // has no undefined token, and calling `.length` on JSON.stringify's
  // undefined result used to crash an otherwise valid AI mutation at commit.
  if (encoded === undefined) return { value: null };
  if (encoded.length <= 48_000) return { value };
  return {
    value: {
      preview: encoded.slice(0, 48_000),
      omittedCharacters: encoded.length - 48_000,
    },
    truncated: true as const,
  };
}

function isMarker(value: unknown): value is { [REGION_MARKER]: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[REGION_MARKER] === "string",
  );
}

function isCodeLinesMarker(
  value: unknown,
): value is { [CODE_LINES_MARKER]: string[] } {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Array.isArray((value as Record<string, unknown>)[CODE_LINES_MARKER]) &&
    ((value as Record<string, unknown>)[CODE_LINES_MARKER] as unknown[]).every(
      (entry) => typeof entry === "string",
    ),
  );
}

function pathStartsWith(
  path: readonly (string | number)[],
  prefix: readonly (string | number)[],
) {
  return (
    prefix.length < path.length &&
    prefix.every((segment, index) => path[index] === segment)
  );
}

function valueAtPath(value: unknown, path: readonly (string | number)[]) {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function replaceAtPath(
  value: unknown,
  path: readonly (string | number)[],
  replacement: unknown,
) {
  if (path.length === 0) return replacement;
  if (value === null || typeof value !== "object") {
    throw new Error(
      `ARTIFACT_REGION_PATH_INVALID: cannot write ${path.join("/")} onto a non-object root`,
    );
  }
  let current = value as Record<string | number, unknown>;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    const nextSegment = path[index + 1]!;
    const existing = current[segment];
    if (existing === null || typeof existing !== "object") {
      // Sheets/presentation regions can address containers that are optional
      // on the schema (e.g. rowIdentities). Materialize missing parents so
      // decompose never throws "Cannot set properties of undefined".
      current[segment] =
        typeof nextSegment === "number" ||
        (typeof nextSegment === "string" && /^\d+$/.test(nextSegment))
          ? []
          : {};
    }
    current = current[segment] as Record<string | number, unknown>;
  }
  current[path[path.length - 1]!] = replacement;
  return value;
}

function nearestAncestor(
  candidate: SemanticRegion,
  regions: readonly SemanticRegion[],
) {
  return regions
    .filter(
      (other) =>
        other.regionId !== candidate.regionId &&
        pathStartsWith(candidate.path, other.path),
    )
    .sort((left, right) => right.path.length - left.path.length)[0];
}

export function decomposeArtifactContent(
  typeKey: ArtifactTypeKey,
  content: unknown,
): DecomposedArtifact {
  const manifest = requireArtifactTypeManifest(typeKey);
  const parsed = manifest.schemas.content.parse(
    coerceArtifactContent(typeKey, content),
  );
  if (typeKey === "code") return decomposeCodeContent(parsed);
  const regions = enumerateArtifactRegions(typeKey, parsed);
  const descriptors = new Map<string, StoredArtifactRegionDescriptor>();
  const regionValues = new Map<string, string>();
  const ancestors = new Map(
    regions.map((candidate) => [
      candidate.regionId,
      nearestAncestor(candidate, regions),
    ]),
  );

  for (const candidate of regions) {
    const source = clone(valueAtPath(parsed, candidate.path));
    const children = regions.filter(
      (other) => ancestors.get(other.regionId)?.regionId === candidate.regionId,
    );
    let template = source;
    for (const child of children) {
      template = replaceAtPath(
        template,
        child.path.slice(candidate.path.length),
        marker(child.regionId),
      );
    }
    const descriptor: StoredArtifactRegionDescriptor = {
      regionId: candidate.regionId,
      kind: candidate.kind,
      label: candidate.label,
      path: [...candidate.path],
      overlapDomain: candidate.overlapDomain,
      ...(candidate.parentRegionId
        ? { parentRegionId: candidate.parentRegionId }
        : {}),
    };
    descriptors.set(candidate.regionId, descriptor);
    regionValues.set(candidate.regionId, encodeRegionValue(template));
  }

  let root = clone(parsed) as unknown;
  for (const candidate of regions.filter(
    (entry) => !ancestors.get(entry.regionId),
  )) {
    root = replaceAtPath(root, candidate.path, marker(candidate.regionId));
  }
  return { rootTemplate: JSON.stringify(root), descriptors, regionValues };
}

function decomposeCodeContent(content: unknown): DecomposedArtifact {
  const parsed = clone(content) as { files?: Array<Record<string, unknown>> };
  const semanticRegions = enumerateArtifactRegions("code", parsed);
  const descriptors = new Map<string, StoredArtifactRegionDescriptor>();
  const regionValues = new Map<string, string>();
  const root = clone(parsed) as { files?: Array<Record<string, unknown>> };
  const files = Array.isArray(parsed.files) ? parsed.files : [];

  files.forEach((file, fileIndex) => {
    const fileRegion = semanticRegions.find(
      (candidate) =>
        candidate.kind === "code_file" && candidate.path[1] === fileIndex,
    );
    if (!fileRegion) return;
    const lineRegions = semanticRegions
      .filter(
        (candidate) =>
          candidate.kind === "code_line" &&
          candidate.parentRegionId === fileRegion.regionId,
      )
      .sort(
        (left, right) =>
          Number(left.path[left.path.length - 1]) -
          Number(right.path[right.path.length - 1]),
      );
    const source = typeof file.source === "string" ? file.source : "";
    const sourceLines = source.split("\n");
    const fileTemplate = clone(file);
    fileTemplate.lineIds = lineRegions.map((candidate) => candidate.regionId);
    fileTemplate.source = codeLinesMarker(
      lineRegions.map((candidate) => candidate.regionId),
    );
    descriptors.set(fileRegion.regionId, {
      regionId: fileRegion.regionId,
      kind: fileRegion.kind,
      label: fileRegion.label,
      path: [...fileRegion.path],
      overlapDomain: fileRegion.overlapDomain,
    });
    regionValues.set(fileRegion.regionId, encodeRegionValue(fileTemplate));
    lineRegions.forEach((candidate, lineIndex) => {
      descriptors.set(candidate.regionId, {
        regionId: candidate.regionId,
        kind: candidate.kind,
        label: candidate.label,
        path: [...candidate.path],
        overlapDomain: candidate.overlapDomain,
        parentRegionId: fileRegion.regionId,
      });
      regionValues.set(
        candidate.regionId,
        encodeRegionValue(sourceLines[lineIndex] ?? ""),
      );
    });
    if (root.files) root.files[fileIndex] = marker(fileRegion.regionId);
  });
  return {
    rootTemplate: JSON.stringify(root),
    descriptors,
    regionValues,
  };
}

function expandTemplate(
  value: unknown,
  regionValues: ReadonlyMap<string, string>,
  active = new Set<string>(),
): unknown {
  if (isMarker(value)) {
    const regionId = value[REGION_MARKER];
    if (active.has(regionId))
      throw new Error(`ARTIFACT_REGION_CYCLE: ${regionId}`);
    const encoded = regionValues.get(regionId);
    if (encoded === undefined)
      throw new Error(`ARTIFACT_REGION_MISSING: ${regionId}`);
    const nextActive = new Set(active);
    nextActive.add(regionId);
    return expandTemplate(decodeRegionValue(encoded), regionValues, nextActive);
  }
  if (isCodeLinesMarker(value)) {
    return value[CODE_LINES_MARKER].map((regionId) => {
      if (active.has(regionId))
        throw new Error(`ARTIFACT_REGION_CYCLE: ${regionId}`);
      const encoded = regionValues.get(regionId);
      if (encoded === undefined)
        throw new Error(`ARTIFACT_REGION_MISSING: ${regionId}`);
      const nextActive = new Set(active);
      nextActive.add(regionId);
      const line = expandTemplate(
        decodeRegionValue(encoded),
        regionValues,
        nextActive,
      );
      return typeof line === "string" ? line : String(line ?? "");
    }).join("\n");
  }
  if (Array.isArray(value))
    return value.map((entry) => expandTemplate(entry, regionValues, active));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        expandTemplate(entry, regionValues, active),
      ]),
    );
  }
  return value;
}

export function recomposeArtifactContent(
  rootTemplate: string,
  regionValues: ReadonlyMap<string, string>,
) {
  return expandTemplate(JSON.parse(rootTemplate), regionValues);
}

export function changedArtifactRegionIds(
  typeKey: ArtifactTypeKey,
  before: unknown,
  after: unknown,
) {
  const previous = decomposeArtifactContent(typeKey, before);
  const next = decomposeArtifactContent(typeKey, after);
  const previousStructure =
    typeKey === "document"
      ? documentDescriptorSignature(previous)
      : descriptorSignature(previous);
  const nextStructure =
    typeKey === "document"
      ? documentDescriptorSignature(next)
      : descriptorSignature(next);
  if (previousStructure !== nextStructure) return ["artifact:structure"];
  const changed = new Set<string>();
  for (const [regionId, encoded] of next.regionValues)
    if (previous.regionValues.get(regionId) !== encoded) changed.add(regionId);
  if (typeKey === "document") {
    const previousNodes = documentTiptapRegionSignatures(before);
    const nextNodes = documentTiptapRegionSignatures(after);
    if (
      previousNodes.size !== nextNodes.size ||
      [...previousNodes.keys()].some((regionId) => !nextNodes.has(regionId))
    )
      return ["artifact:structure"];
    for (const [regionId, signature] of nextNodes)
      if (previousNodes.get(regionId) !== signature) changed.add(regionId);
  }
  return [...changed];
}

function documentDescriptorSignature(value: DecomposedArtifact) {
  let rootTemplate: unknown = value.rootTemplate;
  try {
    const parsed = JSON.parse(value.rootTemplate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { tiptap: _tiptap, ...semanticRoot } = parsed as Record<
        string,
        unknown
      >;
      rootTemplate = semanticRoot;
    } else rootTemplate = parsed;
  } catch {
    // Projection validation reports malformed templates separately.
  }
  return JSON.stringify(
    canonicalJsonValue({
      rootTemplate,
      descriptors: [...value.descriptors.values()]
        .sort((left, right) => left.regionId.localeCompare(right.regionId))
        .map(({ label: _label, ...descriptor }) => descriptor),
    }),
  );
}

function documentTiptapRegionSignatures(content: unknown) {
  const value =
    content && typeof content === "object" && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};
  const blocks = Array.isArray(value.blocks) ? value.blocks : [];
  const tiptap =
    value.tiptap &&
    typeof value.tiptap === "object" &&
    !Array.isArray(value.tiptap)
      ? (value.tiptap as Record<string, unknown>)
      : {};
  const nodes = Array.isArray(tiptap.content) ? tiptap.content : [];
  return new Map(
    nodes.flatMap((node, index) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return [];
      const record = node as Record<string, unknown>;
      const attrs =
        record.attrs &&
        typeof record.attrs === "object" &&
        !Array.isArray(record.attrs)
          ? (record.attrs as Record<string, unknown>)
          : {};
      const block =
        blocks[index] &&
        typeof blocks[index] === "object" &&
        !Array.isArray(blocks[index])
          ? (blocks[index] as Record<string, unknown>)
          : {};
      const regionId =
        typeof attrs.blockId === "string" && attrs.blockId
          ? attrs.blockId
          : typeof block.id === "string" && block.id
            ? block.id
            : null;
      return regionId
        ? [[regionId, JSON.stringify(canonicalJsonValue(record))] as const]
        : [];
    }),
  );
}

function descriptorSignature(value: DecomposedArtifact) {
  let rootTemplate: unknown = value.rootTemplate;
  try {
    rootTemplate = JSON.parse(value.rootTemplate) as unknown;
  } catch {
    // A malformed template is handled by the normal projection validation.
    // Keeping the original string here preserves a deterministic signature.
  }
  return JSON.stringify(
    canonicalJsonValue({
      rootTemplate,
      descriptors: [...value.descriptors.values()].sort((left, right) =>
        left.regionId.localeCompare(right.regionId),
      ),
    }),
  );
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
}

function documentMaps(document: Y.Doc) {
  return {
    metadata: document.getMap<unknown>(ARTIFACT_YJS_META_MAP),
    regions: document.getMap<string>(ARTIFACT_YJS_REGION_MAP),
    descriptors: document.getMap<string>(ARTIFACT_YJS_DESCRIPTOR_MAP),
  };
}

function writeCompleteDocument(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
  value: ArtifactLiveValue,
  decomposed: DecomposedArtifact,
) {
  const { metadata, regions, descriptors } = documentMaps(document);
  metadata.set("modelVersion", MODEL_VERSION);
  metadata.set("typeKey", typeKey);
  metadata.set(
    "schemaVersion",
    requireArtifactTypeManifest(typeKey).schemas.currentVersion,
  );
  metadata.set("title", value.title);
  metadata.set("summary", value.summary ?? "");
  metadata.set("tags", [...value.tags]);
  metadata.set("rootTemplate", decomposed.rootTemplate);
  for (const key of [...descriptors.keys()])
    if (!decomposed.descriptors.has(key)) descriptors.delete(key);
  for (const key of [...regions.keys()])
    if (!decomposed.regionValues.has(key)) regions.delete(key);
  for (const [regionId, descriptor] of decomposed.descriptors)
    descriptors.set(regionId, JSON.stringify(descriptor));
  for (const [regionId, encoded] of decomposed.regionValues)
    regions.set(regionId, encoded);
  metadata.set("initialized", true);
}

export function readArtifactYjsDocument(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
): ArtifactLiveValue | null {
  const { metadata, regions } = documentMaps(document);
  if (metadata.get("initialized") !== true) return null;
  if (metadata.get("typeKey") !== typeKey)
    throw new Error("ARTIFACT_TYPE_MISMATCH");
  const rootTemplate = metadata.get("rootTemplate");
  const title = metadata.get("title");
  const summary = metadata.get("summary");
  const tags = metadata.get("tags");
  if (
    typeof rootTemplate !== "string" ||
    typeof title !== "string" ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string")
  ) {
    throw new Error("ARTIFACT_LIVE_STATE_INVALID");
  }
  const validation = validateArtifactContent(
    typeKey,
    coerceArtifactContent(
      typeKey,
      recomposeArtifactContent(rootTemplate, new Map(regions.entries())),
    ),
  );
  if (!validation.success) {
    const issue = validation.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "";
    const detail = issue?.message ?? "Artifact content is invalid.";
    // Include the Zod path so live sparse-schema misses (e.g. sheets
    // rowIdentities.<n> after HMR / "Access removed") are diagnosable and
    // quiet-retryable via isQuietRetryableApplyFailure.
    throw new Error(
      path
        ? `Invalid input at ${path}: ${detail}`
        : detail.startsWith("Invalid input")
          ? detail
          : `Invalid input: ${detail}`,
    );
  }
  return {
    title,
    ...(typeof summary === "string" && summary ? { summary } : {}),
    tags,
    content: validation.data,
  };
}

/**
 * Captures only the semantic regions involved in a proposed mutation. Conflict
 * records stay useful and bounded instead of duplicating an entire workbook,
 * presentation, or canvas into every paused operation.
 */
export function snapshotArtifactRegions(
  typeKey: ArtifactTypeKey,
  value: ArtifactLiveValue,
  regionIds: readonly string[],
): ArtifactRegionSnapshot {
  const decomposed = decomposeArtifactContent(typeKey, value.content);
  const regions = [...new Set(regionIds)].map((regionId) => {
    let label = regionId;
    let regionValue: unknown;
    if (regionId === "artifact:structure") {
      label = "Artifact structure";
      regionValue = value.content;
    } else if (regionId === "metadata:title") {
      label = "Title";
      regionValue = value.title;
    } else if (regionId === "metadata:summary") {
      label = "Summary";
      regionValue = value.summary ?? "";
    } else if (regionId === "metadata:tags") {
      label = "Tags";
      regionValue = value.tags;
    } else {
      const descriptor = decomposed.descriptors.get(regionId);
      const encoded = decomposed.regionValues.get(regionId);
      label = descriptor?.label ?? regionId;
      regionValue = encoded === undefined ? null : decodeRegionValue(encoded);
    }
    return { regionId, label, ...boundedSnapshotValue(regionValue) };
  });
  return { artifactType: typeKey, regions };
}

/**
 * Plans one atomic semantic mutation without touching the Y.Doc until every
 * returned region has been authorized and claimed. Browser editors and AI
 * workers therefore share one region decomposition contract.
 */
export function planArtifactYjsMutation(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
  value: ArtifactLiveValue,
): ArtifactYjsMutationPlan {
  const { metadata, regions, descriptors } = documentMaps(document);
  const next = decomposeArtifactContent(typeKey, value.content);
  if (metadata.get("initialized") !== true) {
    return {
      regions: [
        {
          regionId: "artifact:structure",
          overlapDomains: ["artifact:structure"],
        },
      ],
      apply: () => writeCompleteDocument(document, typeKey, value, next),
    };
  }
  if (metadata.get("typeKey") !== typeKey)
    throw new Error("ARTIFACT_TYPE_MISMATCH");
  const currentDescriptors = new Map<string, StoredArtifactRegionDescriptor>();
  for (const [regionId, encoded] of descriptors)
    currentDescriptors.set(
      regionId,
      JSON.parse(encoded) as StoredArtifactRegionDescriptor,
    );
  const rootTemplate = metadata.get("rootTemplate");
  const current: DecomposedArtifact = {
    rootTemplate: typeof rootTemplate === "string" ? rootTemplate : "null",
    descriptors: currentDescriptors,
    regionValues: new Map(regions.entries()),
  };
  if (descriptorSignature(current) !== descriptorSignature(next)) {
    return {
      regions: [
        {
          regionId: "artifact:structure",
          overlapDomains: ["artifact:structure"],
        },
      ],
      apply: () => writeCompleteDocument(document, typeKey, value, next),
    };
  }

  const claimedRegions: ArtifactYjsMutationRegion[] = [];
  const mutations: Array<() => void> = [];
  for (const [regionId, encoded] of next.regionValues) {
    if (regions.get(regionId) === encoded) continue;
    const descriptor = next.descriptors.get(regionId)!;
    claimedRegions.push({
      regionId,
      overlapDomains: [descriptor.overlapDomain],
    });
    mutations.push(() => regions.set(regionId, encoded));
  }
  if (metadata.get("title") !== value.title) {
    claimedRegions.push({
      regionId: "metadata:title",
      overlapDomains: ["metadata:title"],
    });
    mutations.push(() => metadata.set("title", value.title));
  }
  if (metadata.get("summary") !== (value.summary ?? "")) {
    claimedRegions.push({
      regionId: "metadata:summary",
      overlapDomains: ["metadata:summary"],
    });
    mutations.push(() => metadata.set("summary", value.summary ?? ""));
  }
  if (JSON.stringify(metadata.get("tags")) !== JSON.stringify(value.tags)) {
    claimedRegions.push({
      regionId: "metadata:tags",
      overlapDomains: ["metadata:tags"],
    });
    mutations.push(() => metadata.set("tags", [...value.tags]));
  }
  return {
    regions: claimedRegions,
    apply: () => {
      for (const mutation of mutations) mutation();
    },
  };
}

export class ArtifactYjsModel {
  private readonly metadata: Y.Map<unknown>;
  private readonly regions: Y.Map<string>;
  private readonly descriptors: Y.Map<string>;
  private readonly listeners = new Set<() => void>();
  private snapshot: ArtifactLiveModelSnapshot = UNINITIALIZED_SNAPSHOT;
  private readonly refresh: () => void;
  private destroyed = false;

  constructor(
    private readonly typeKey: ArtifactTypeKey,
    private readonly transport: ArtifactCollaborationTransport,
  ) {
    this.metadata = transport.document.getMap(ARTIFACT_YJS_META_MAP);
    this.regions = transport.document.getMap(ARTIFACT_YJS_REGION_MAP);
    this.descriptors = transport.document.getMap(ARTIFACT_YJS_DESCRIPTOR_MAP);
    this.refresh = () => this.rebuildSnapshot();
    this.metadata.observe(this.refresh);
    this.regions.observe(this.refresh);
    this.descriptors.observe(this.refresh);
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
    // React tears down the transport and the live model through independent
    // effects. If the Y.Doc closed first, Yjs already removed every observer;
    // calling unobserve again produces a noisy error for each artifact map.
    if (!this.transport.document.isDestroyed) {
      this.metadata.unobserve(this.refresh);
      this.regions.unobserve(this.refresh);
      this.descriptors.unobserve(this.refresh);
    }
    this.listeners.clear();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private rebuildSnapshot() {
    if (this.metadata.get("initialized") !== true) {
      this.snapshot = UNINITIALIZED_SNAPSHOT;
      this.emit();
      return;
    }
    try {
      if (this.metadata.get("typeKey") !== this.typeKey)
        throw new Error("ARTIFACT_TYPE_MISMATCH");
      const rootTemplate = this.metadata.get("rootTemplate");
      if (typeof rootTemplate !== "string")
        throw new Error("ARTIFACT_ROOT_TEMPLATE_MISSING");
      const content = coerceArtifactContent(
        this.typeKey,
        recomposeArtifactContent(rootTemplate, new Map(this.regions.entries())),
      );
      const validation = validateArtifactContent(this.typeKey, content);
      if (!validation.success)
        throw new Error(
          validation.error.issues[0]?.message || "Artifact content is invalid.",
        );
      const title = this.metadata.get("title");
      const summary = this.metadata.get("summary");
      const tags = this.metadata.get("tags");
      if (
        typeof title !== "string" ||
        !Array.isArray(tags) ||
        !tags.every((tag) => typeof tag === "string")
      ) {
        throw new Error("ARTIFACT_METADATA_INVALID");
      }
      this.snapshot = {
        initialized: true,
        validity: "valid",
        value: {
          title,
          ...(typeof summary === "string" && summary ? { summary } : {}),
          tags,
          content: validation.data,
        },
        regionIds: [...this.regions.keys()].sort(),
      };
    } catch (error) {
      this.snapshot = {
        initialized: true,
        validity: "invalid",
        value: null,
        regionIds: [...this.regions.keys()].sort(),
        error:
          error instanceof Error
            ? error.message
            : "Artifact live state is invalid.",
      };
    }
    this.emit();
  }

  private writeComplete(
    value: ArtifactLiveValue,
    decomposed: DecomposedArtifact,
  ) {
    this.metadata.set("modelVersion", MODEL_VERSION);
    this.metadata.set("typeKey", this.typeKey);
    this.metadata.set(
      "schemaVersion",
      requireArtifactTypeManifest(this.typeKey).schemas.currentVersion,
    );
    this.metadata.set("title", value.title);
    this.metadata.set("summary", value.summary ?? "");
    this.metadata.set("tags", [...value.tags]);
    this.metadata.set("rootTemplate", decomposed.rootTemplate);
    for (const key of [...this.descriptors.keys()])
      if (!decomposed.descriptors.has(key)) this.descriptors.delete(key);
    for (const key of [...this.regions.keys()])
      if (!decomposed.regionValues.has(key)) this.regions.delete(key);
    for (const [regionId, descriptor] of decomposed.descriptors)
      this.descriptors.set(regionId, JSON.stringify(descriptor));
    for (const [regionId, encoded] of decomposed.regionValues)
      this.regions.set(regionId, encoded);
    this.metadata.set("initialized", true);
  }

  async initialize(
    value: ArtifactLiveValue,
    controller: ArtifactRegionController,
  ) {
    if (this.snapshot.initialized)
      return {
        applied: false as const,
        reason: "already_initialized" as const,
      };
    const nextValue =
      this.typeKey === "whiteboard"
        ? {
            ...value,
            content: coerceArtifactContent(this.typeKey, value.content),
          }
        : value;
    const decomposed = decomposeArtifactContent(
      this.typeKey,
      nextValue.content,
    );
    const result = await controller.edit(
      "artifact:structure",
      ["artifact:structure"],
      () => {
        if (this.metadata.get("initialized") === true) return;
        this.writeComplete(nextValue, decomposed);
      },
    );
    return result.applied
      ? { applied: true as const }
      : {
          applied: false as const,
          reason: "conflict" as const,
          claim: result.claim,
        };
  }

  descriptor(regionId: string): StoredArtifactRegionDescriptor | null {
    const encoded = this.descriptors.get(regionId);
    if (!encoded) return null;
    return JSON.parse(encoded) as StoredArtifactRegionDescriptor;
  }

  async replaceRegion(
    regionId: string,
    value: unknown,
    controller: ArtifactRegionController,
  ) {
    const descriptor = this.descriptor(regionId);
    if (!descriptor) throw new Error(`ARTIFACT_REGION_UNKNOWN: ${regionId}`);
    return controller.edit(regionId, [descriptor.overlapDomain], () => {
      this.regions.set(regionId, encodeRegionValue(value));
    });
  }

  async replaceMetadata(
    field: "title" | "summary" | "tags",
    value: string | string[],
    controller: ArtifactRegionController,
  ) {
    const regionId = `metadata:${field}`;
    return controller.edit(regionId, [regionId], () =>
      this.metadata.set(field, Array.isArray(value) ? [...value] : value),
    );
  }

  async replaceSnapshot(
    value: ArtifactLiveValue,
    controller: ArtifactRegionController,
  ) {
    const next = decomposeArtifactContent(this.typeKey, value.content);
    const currentRoot = this.metadata.get("rootTemplate");
    const currentDescriptors = new Map<
      string,
      StoredArtifactRegionDescriptor
    >();
    for (const [regionId, encoded] of this.descriptors)
      currentDescriptors.set(
        regionId,
        JSON.parse(encoded) as StoredArtifactRegionDescriptor,
      );
    const current: DecomposedArtifact = {
      rootTemplate: typeof currentRoot === "string" ? currentRoot : "null",
      descriptors: currentDescriptors,
      regionValues: new Map(this.regions.entries()),
    };
    if (descriptorSignature(current) !== descriptorSignature(next)) {
      return controller.edit("artifact:structure", ["artifact:structure"], () =>
        this.writeComplete(value, next),
      );
    }

    const claimedRegions: Array<{
      regionId: string;
      overlapDomains: string[];
    }> = [];
    const mutations: Array<() => void> = [];
    for (const [regionId, encoded] of next.regionValues) {
      if (this.regions.get(regionId) === encoded) continue;
      const descriptor = next.descriptors.get(regionId)!;
      claimedRegions.push({
        regionId,
        overlapDomains: [descriptor.overlapDomain],
      });
      mutations.push(() => this.regions.set(regionId, encoded));
    }
    if (this.metadata.get("title") !== value.title) {
      claimedRegions.push({
        regionId: "metadata:title",
        overlapDomains: ["metadata:title"],
      });
      mutations.push(() => this.metadata.set("title", value.title));
    }
    if (this.metadata.get("summary") !== (value.summary ?? "")) {
      claimedRegions.push({
        regionId: "metadata:summary",
        overlapDomains: ["metadata:summary"],
      });
      mutations.push(() => this.metadata.set("summary", value.summary ?? ""));
    }
    if (
      JSON.stringify(this.metadata.get("tags")) !== JSON.stringify(value.tags)
    ) {
      claimedRegions.push({
        regionId: "metadata:tags",
        overlapDomains: ["metadata:tags"],
      });
      mutations.push(() => this.metadata.set("tags", [...value.tags]));
    }
    if (claimedRegions.length === 0)
      return { applied: true as const, claims: [] };
    return controller.editMany(claimedRegions, () => {
      for (const mutation of mutations) mutation();
    });
  }

  async replaceRegionsFromSnapshot(
    value: ArtifactLiveValue,
    regionIds: readonly string[],
    controller: ArtifactRegionController,
  ) {
    const selected = [...new Set(regionIds)];
    if (selected.length === 0) return { applied: true as const, claims: [] };
    const next = decomposeArtifactContent(this.typeKey, value.content);
    if (selected.includes("artifact:structure")) {
      return controller.edit("artifact:structure", ["artifact:structure"], () =>
        this.writeComplete(value, next),
      );
    }
    const claimedRegions: Array<{
      regionId: string;
      overlapDomains: string[];
    }> = [];
    const mutations: Array<() => void> = [];
    for (const regionId of selected) {
      if (regionId === "metadata:title") {
        claimedRegions.push({ regionId, overlapDomains: [regionId] });
        mutations.push(() => this.metadata.set("title", value.title));
        continue;
      }
      if (regionId === "metadata:summary") {
        claimedRegions.push({ regionId, overlapDomains: [regionId] });
        mutations.push(() => this.metadata.set("summary", value.summary ?? ""));
        continue;
      }
      if (regionId === "metadata:tags") {
        claimedRegions.push({ regionId, overlapDomains: [regionId] });
        mutations.push(() => this.metadata.set("tags", [...value.tags]));
        continue;
      }
      const currentDescriptor = this.descriptor(regionId);
      const nextDescriptor = next.descriptors.get(regionId);
      const encoded = next.regionValues.get(regionId);
      if (
        !currentDescriptor ||
        !nextDescriptor ||
        encoded === undefined ||
        JSON.stringify(currentDescriptor) !== JSON.stringify(nextDescriptor)
      ) {
        throw new Error(
          `ARTIFACT_PARTIAL_RESTORE_STRUCTURE_CHANGED: ${regionId}`,
        );
      }
      claimedRegions.push({
        regionId,
        overlapDomains: [currentDescriptor.overlapDomain],
      });
      mutations.push(() => this.regions.set(regionId, encoded));
    }
    return controller.editMany(claimedRegions, () => {
      for (const mutation of mutations) mutation();
    });
  }
}
