import * as Y from "yjs";
import { canonicalJsonValue } from "../../../../shared/canonical-json";
export { canonicalJsonValue };
import {
  enumerateArtifactRegions,
  requireArtifactTypeManifest,
  validateArtifactContent,
} from "../artifacts/registry";
import type { ArtifactTypeKey, SemanticRegion } from "../artifacts/types";
import { normalizeWhiteboardContent } from "../whiteboard/model";
import { withoutDerivedNativeBinding } from "../artifacts/native-binding";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { planSheetsCellProjection } from "../work/models/yjs/structured-adapters";

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
    // A rename the live document hasn't caught up with yet still stands.
    title: baseline.renamedFromTitle === live.title ? baseline.title : live.title,
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

function valueAtPath(value: unknown, path: readonly (string | number)[]) {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/**
 * `source` with a region marker written at each relative path, copying only
 * the containers on those paths. Deep-cloning every region's subtree (and
 * then the whole artifact for the root) before writing markers made a
 * decomposition cost the artifact's size times its depth. `source` is never
 * mutated. Sheets/presentation regions can address containers that are
 * optional on the schema (e.g. rowIdentities); missing parents are
 * materialized so decompose never throws "Cannot set properties of undefined".
 */
function withRegionMarkers(
  source: unknown,
  markers: ReadonlyArray<readonly [readonly (string | number)[], string]>,
) {
  if (!markers.length) return source;
  const owned = new Set<object>();
  const own = (value: object) => {
    const copy = Array.isArray(value) ? [...value] : { ...value };
    owned.add(copy);
    return copy as Record<string | number, unknown>;
  };
  let root = source;
  for (const [path, regionId] of markers) {
    if (path.length === 0) {
      root = marker(regionId);
      continue;
    }
    if (root === null || typeof root !== "object")
      throw new Error(
        `ARTIFACT_REGION_PATH_INVALID: cannot write ${path.join("/")} onto a non-object root`,
      );
    if (!owned.has(root)) root = own(root);
    let current = root as Record<string | number, unknown>;
    for (let index = 0; index < path.length - 1; index += 1) {
      const segment = path[index]!;
      const nextSegment = path[index + 1]!;
      const existing = current[segment];
      let next: Record<string | number, unknown>;
      if (existing === null || typeof existing !== "object") {
        next = (
          typeof nextSegment === "number" ||
          (typeof nextSegment === "string" && /^\d+$/.test(nextSegment))
            ? []
            : {}
        ) as Record<string | number, unknown>;
        owned.add(next);
      } else
        next = owned.has(existing)
          ? (existing as Record<string | number, unknown>)
          : own(existing);
      current[segment] = next;
      current = next;
    }
    current[path[path.length - 1]!] = marker(regionId);
  }
  return root;
}

/**
 * Each region's nearest ancestor (the region whose path is the longest strict
 * prefix of its own; the first such region wins a tie) and each region's
 * direct children, in region order. Built from a path index in one pass: the
 * pairwise scan it replaces cost ~400 ms for a 200-question quiz (3,600
 * regions), and the studio runs it twice on every keystroke.
 */
function regionHierarchy(regions: readonly SemanticRegion[]) {
  const byPath = new Map<string, SemanticRegion>();
  for (const region of regions) {
    const key = JSON.stringify(region.path);
    if (!byPath.has(key)) byPath.set(key, region);
  }
  const ancestors = new Map<string, SemanticRegion | undefined>();
  const children = new Map<string, SemanticRegion[]>();
  for (const candidate of regions) {
    let ancestor: SemanticRegion | undefined;
    for (let length = candidate.path.length - 1; length >= 0 && !ancestor; length -= 1)
      ancestor = byPath.get(JSON.stringify(candidate.path.slice(0, length)));
    ancestors.set(candidate.regionId, ancestor);
    if (!ancestor) continue;
    const siblings = children.get(ancestor.regionId);
    if (siblings) siblings.push(candidate);
    else children.set(ancestor.regionId, [candidate]);
  }
  return { ancestors, children };
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
  const { ancestors, children } = regionHierarchy(regions);

  for (const candidate of regions) {
    const template = withRegionMarkers(
      valueAtPath(parsed, candidate.path),
      (children.get(candidate.regionId) ?? []).map((child) => [
        child.path.slice(candidate.path.length),
        child.regionId,
      ]),
    );
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

  const root = withRegionMarkers(
    parsed,
    regions
      .filter((entry) => !ancestors.get(entry.regionId))
      .map((entry) => [entry.path, entry.regionId]),
  );
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
  beforeContent: unknown,
  afterContent: unknown,
) {
  // A native save re-derives the file's hashes; that is not a structural edit.
  const before = withoutDerivedNativeBinding(beforeContent);
  const after = withoutDerivedNativeBinding(afterContent);
  if (typeKey === "sheets") {
    const cellPlan = planSheetsCellProjection(before, after);
    if (cellPlan) return cellPlan.changes.map((change) => change.regionId);
  }
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
    const previousBlockIds = documentBlockIds(before);
    const nextBlockIds = documentBlockIds(after);
    if (
      previousBlockIds.size !== nextBlockIds.size ||
      [...nextBlockIds].some((regionId) => !previousBlockIds.has(regionId)) ||
      [...previousBlockIds].some((regionId) => !nextBlockIds.has(regionId))
    )
      return ["artifact:structure"];
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

function documentBlockIds(content: unknown) {
  const blocks = (content as { blocks?: unknown } | null)?.blocks;
  const ids = new Set<string>();
  if (!Array.isArray(blocks)) return ids;
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const id = (block as { id?: unknown }).id;
    if (typeof id === "string" && id) ids.add(id);
  }
  return ids;
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
  return structureSignature(
    rootTemplate,
    [...value.descriptors.values()].map(
      ({ label: _label, ...descriptor }) => descriptor,
    ),
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
  return structureSignature(rootTemplate, [...value.descriptors.values()]);
}

/**
 * Descriptors are built by `decomposeArtifactContent` with a fixed key order,
 * so only their order needs canonicalizing; canonicalizing each of thousands
 * of descriptors object by object dominated a keystroke's region diff.
 */
function structureSignature(
  rootTemplate: unknown,
  descriptors: Array<Omit<StoredArtifactRegionDescriptor, "label">>,
) {
  return JSON.stringify([
    canonicalJsonValue(rootTemplate),
    descriptors.sort((left, right) =>
      compareCodeUnits(left.regionId, right.regionId),
    ),
  ]);
}

/**
 * Canonical forms are only ever compared with each other, so any total order
 * works. Locale collation was the dominant cost of a region signature, and it
 * can rank two distinct keys as equal, leaving their order to the input.
 */
function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalJsonEqual(left: unknown, right: unknown) {
  if (left === right) return true;
  return (
    JSON.stringify(canonicalJsonValue(left)) ===
    JSON.stringify(canonicalJsonValue(right))
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
      label = "Whole artifact";
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

/** Prepare a restore without changing the document. Server admission can use
 * this same selection logic on a reconstructed room before committing bytes. */
export function planArtifactYjsRestore(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
  value: ArtifactLiveValue,
  regionIds?: readonly string[],
): ArtifactYjsMutationPlan {
  if (!regionIds || regionIds.includes("artifact:structure"))
    return planArtifactYjsMutation(document, typeKey, value);
  const { metadata, regions, descriptors } = documentMaps(document);
  const next = decomposeArtifactContent(typeKey, value.content);
  const selected = [...new Set(regionIds)];
  const claims: ArtifactYjsMutationRegion[] = [];
  const assertDescriptors = () => {
    for (const regionId of selected) {
      if (["metadata:title", "metadata:summary", "metadata:tags"].includes(regionId)) continue;
      const encoded = descriptors.get(regionId);
      const current = encoded ? JSON.parse(encoded) as StoredArtifactRegionDescriptor : null;
      const historical = next.descriptors.get(regionId);
      if (!current || !historical || !next.regionValues.has(regionId) ||
        JSON.stringify(current) !== JSON.stringify(historical))
        throw new Error(`ARTIFACT_PARTIAL_RESTORE_STRUCTURE_CHANGED: ${regionId}`);
    }
  };
  assertDescriptors();
  for (const regionId of selected) {
    const descriptor = next.descriptors.get(regionId);
    claims.push({ regionId, overlapDomains: [descriptor?.overlapDomain ?? regionId] });
  }
  return {
    regions: claims,
    apply: () => {
      // A claim may have waited. Validate all paths again before the first write.
      assertDescriptors();
      for (const regionId of selected) {
        if (regionId === "metadata:title") metadata.set("title", value.title);
        else if (regionId === "metadata:summary") metadata.set("summary", value.summary ?? "");
        else if (regionId === "metadata:tags") metadata.set("tags", [...value.tags]);
        else regions.set(regionId, next.regionValues.get(regionId)!);
      }
    },
  };
}
