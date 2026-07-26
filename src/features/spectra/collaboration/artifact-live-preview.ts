import type { ArtifactLiveValue } from "./artifact-yjs-model";

type StringChange = {
  path: Array<string | number>;
  before: string;
  after: string;
};

function sharedEdgeLength(before: string, after: string) {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;
  return prefix + suffix;
}

const NON_STREAMING_STRING_FIELDS = new Set([
  "_id",
  "id",
  "type",
  "kind",
  "variant",
  "status",
  "role",
  "tone",
  "alignment",
  "language",
  "url",
  "href",
  "path",
]);

function collectStringChanges(
  before: unknown,
  after: unknown,
  path: Array<string | number> = [],
): StringChange[] {
  if (typeof before === "string" && typeof after === "string") {
    const field = String(path.at(-1) ?? "");
    const codeBody =
      before.length > 400 &&
      (field === "content" || field === "source") &&
      path.some((segment) => String(segment) === "files");
    // Never animate a broad source-file rewrite by deleting the middle of the
    // program first. Local edits keep their surrounding source and stream;
    // broad rewrites settle atomically until a line-aware patch is available.
    const safeCodeStream =
      !codeBody ||
      sharedEdgeLength(before, after) >=
        Math.min(before.length, after.length) * 0.72;
    return before !== after &&
      !NON_STREAMING_STRING_FIELDS.has(field) &&
      safeCodeStream
      ? [{ path, before, after }]
      : [];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return [];
    return before.flatMap((value, index) =>
      collectStringChanges(value, after[index], [...path, index]),
    );
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    return Object.keys(beforeRecord).flatMap((key) =>
      key in afterRecord
        ? collectStringChanges(beforeRecord[key], afterRecord[key], [
            ...path,
            key,
          ])
        : [],
    );
  }
  return [];
}

function setAtPath(
  value: unknown,
  path: readonly (string | number)[],
  next: string,
) {
  let current = value;
  for (const segment of path.slice(0, -1)) {
    if (!current || typeof current !== "object") return;
    current = (current as Record<string | number, unknown>)[segment];
  }
  if (!current || typeof current !== "object") return;
  (current as Record<string | number, unknown>)[path.at(-1)!] = next;
}

function interpolateString(before: string, after: string, progress: number) {
  const wordCharacter = (value: string | undefined) =>
    Boolean(value && /[\p{L}\p{N}_]/u.test(value));
  let prefixLength = 0;
  const sharedLimit = Math.min(before.length, after.length);
  while (
    prefixLength < sharedLimit &&
    before[prefixLength] === after[prefixLength]
  ) {
    prefixLength += 1;
  }
  // A human replaces the whole token. Do not leave a shared word fragment
  // selected on either side (for example, preserving "ing" while replacing
  // "analysing" with "interpreting").
  while (
    prefixLength > 0 &&
    ((wordCharacter(before[prefixLength - 1]) &&
      wordCharacter(before[prefixLength])) ||
      (wordCharacter(after[prefixLength - 1]) &&
        wordCharacter(after[prefixLength])))
  ) {
    prefixLength -= 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < sharedLimit - prefixLength &&
    before[before.length - 1 - suffixLength] ===
      after[after.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  while (suffixLength > 0) {
    const beforeStart = before.length - suffixLength;
    const afterStart = after.length - suffixLength;
    const cutsBeforeWord =
      wordCharacter(before[beforeStart]) &&
      wordCharacter(before[beforeStart - 1]);
    const cutsAfterWord =
      wordCharacter(after[afterStart]) && wordCharacter(after[afterStart - 1]);
    if (!cutsBeforeWord && !cutsAfterWord) break;
    suffixLength -= 1;
  }
  const prefix = after.slice(0, prefixLength);
  const sharedSuffix = suffixLength > 0 ? after.slice(-suffixLength) : "";
  // A shared final full stop/closing punctuation belongs to the completed
  // sentence, not every partial frame. Painting it throughout produces
  // machine-like fragments such as "accelerat." and "lowering a.".
  const suffix =
    sharedSuffix.trim() &&
    /^[\p{P}\p{S}]+$/u.test(sharedSuffix.trim()) &&
    progress < 1
      ? ""
      : sharedSuffix;
  const replacement = after.slice(
    prefixLength,
    suffixLength > 0 ? after.length - suffixLength : after.length,
  );
  const typedReplacement = replacement.slice(
    0,
    Math.ceil(replacement.length * progress),
  );
  // When a word is inserted immediately before a preserved word suffix, keep
  // a temporary visual separator until the inserted word's real trailing
  // whitespace arrives. This avoids machine-like frames such as `dwith` and
  // `directlywith` while preserving the same final durable string.
  const previewSeparator =
    progress < 1 &&
    /\s$/u.test(replacement) &&
    wordCharacter(typedReplacement.at(-1)) &&
    wordCharacter(suffix[0])
      ? " "
      : "";
  return `${prefix}${typedReplacement}${previewSeparator}${suffix}`;
}

/**
 * Produces transient, non-durable visual frames for every artifact type.
 * Semantic-region snapshots carry these frames through awareness; the final
 * value is still committed once through Yjs and remains the only durable fact.
 */
export function buildArtifactLivePreviewFrames(
  before: ArtifactLiveValue,
  after: ArtifactLiveValue,
): ArtifactLiveValue[] {
  const changes = collectStringChanges(before, after);
  const longest = Math.max(
    0,
    ...changes.map((change) =>
      Math.max(change.before.length, change.after.length),
    ),
  );
  const frameCount =
    changes.length > 0 ? Math.max(5, Math.min(12, Math.ceil(longest / 8))) : 0;
  const frames: ArtifactLiveValue[] = [];
  let previousKey = JSON.stringify(before);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const value = structuredClone(before);
    const progress = frame / frameCount;
    for (const change of changes) {
      setAtPath(
        value,
        change.path,
        interpolateString(change.before, change.after, progress),
      );
    }
    const key = JSON.stringify(value);
    if (key === previousKey) continue;
    frames.push(value);
    previousKey = key;
  }

  const finalKey = JSON.stringify(after);
  if (finalKey !== previousKey) frames.push(structuredClone(after));
  return frames;
}

export type ArtifactLivePreviewPatch = {
  path: string;
  value: unknown;
};

function pointer(path: readonly (string | number)[]) {
  return `/${path
    .map((segment) =>
      String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
    )
    .join("/")}`;
}

function collectPreviewPatches(
  before: unknown,
  after: unknown,
  path: Array<string | number>,
  patches: ArtifactLivePreviewPatch[],
) {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index += 1) {
      collectPreviewPatches(
        before[index],
        after[index],
        [...path, index],
        patches,
      );
    }
    for (let index = shared; index < after.length; index += 1) {
      patches.push({
        path: pointer([...path, index]),
        value: structuredClone(after[index]),
      });
    }
    if (after.length < before.length) {
      patches.push({ path: pointer(path), value: structuredClone(after) });
    }
    return;
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    for (const key of Object.keys(afterRecord)) {
      if (!(key in beforeRecord)) {
        patches.push({
          path: pointer([...path, key]),
          value: structuredClone(afterRecord[key]),
        });
        continue;
      }
      collectPreviewPatches(
        beforeRecord[key],
        afterRecord[key],
        [...path, key],
        patches,
      );
    }
    return;
  }
  patches.push({ path: pointer(path), value: structuredClone(after) });
}

/** Minimal awareness payload for a transient frame, relative to live state. */
export function artifactLivePreviewPatches(
  before: ArtifactLiveValue,
  frame: ArtifactLiveValue,
): ArtifactLivePreviewPatch[] {
  const patches: ArtifactLivePreviewPatch[] = [];
  collectPreviewPatches(before, frame, [], patches);
  return patches.slice(0, 96);
}
