import type { ArtifactLiveValue } from "./artifact-yjs-model";

/**
 * Spreadsheet previews travel over the live collaboration document. Copying
 * their complete canonical content into every durable preview frame repeats
 * the whole workbook (and can exceed Convex's mutation body limit); the final
 * artifact write remains responsible for canonical persistence.
 */
export function shouldStageAiPreviewContent(blueprintKey: string) {
  return blueprintKey !== "sheets";
}

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

/**
 * `root` with the string at `path` replaced. Only the containers on that path
 * are copied; everything else is shared, and `root` itself is never written.
 * A missing parent leaves `root` unchanged.
 */
function withStringAt(
  root: unknown,
  path: readonly (string | number)[],
  next: string,
): unknown {
  const containers: unknown[] = [];
  let current = root;
  for (const segment of path) {
    if (!current || typeof current !== "object") return root;
    containers.push(current);
    current = (current as Record<string | number, unknown>)[segment];
  }
  let child: unknown = next;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const container = containers[index] as object;
    const copy = (
      Array.isArray(container) ? [...(container as unknown[])] : { ...container }
    ) as Record<string | number, unknown>;
    copy[path[index]!] = child;
    child = copy;
  }
  return child;
}

function stringAt(root: unknown, path: readonly (string | number)[]) {
  let current = root;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/**
 * Select-then-replace rewrite: after the line is selected, frames are prefixes
 * of the new text only. Never keep an old-tail overlap (that reads as garbled
 * double-writing). Height stays stable because selection already reserved the
 * line; the first typed chunk replaces it wholesale.
 */
function buildSelectReplaceFrames(before: string, after: string): string[] {
  if (before === after) return [];
  if (!after) return [after];
  const frames: string[] = [];
  // Awareness and rich-editor projection both have a render cadence. Six
  // 72-ms frames can be coalesced into a single visible replacement even
  // though the server technically streamed them. Keep enough meaningful
  // bursts for a short label to be legible, while bounding long prose so the
  // actor remains quick rather than theatrical.
  const targetFrames = Math.min(12, Math.max(10, Math.ceil(after.length / 12)));
  const stepChars = Math.max(1, Math.floor(after.length / targetFrames));
  for (let typed = stepChars; typed < after.length; typed += stepChars) {
    frames.push(after.slice(0, typed));
  }
  frames.push(after);
  return frames;
}

/**
 * List / outline fields store several visual lines in one string. Rewrite each
 * changed line via select→replace so earlier bullets stay still.
 */
function buildLineAwareRewriteFrames(before: string, after: string): string[] {
  if (before === after) return [];
  if (!before.includes("\n") && !after.includes("\n"))
    return buildSelectReplaceFrames(before, after);
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (beforeLines.length !== afterLines.length)
    return buildSelectReplaceFrames(before, after);
  const changed: number[] = [];
  for (let index = 0; index < afterLines.length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) changed.push(index);
  }
  if (changed.length === 0) return [];
  const frames: string[] = [];
  const lines = [...beforeLines];
  for (const lineIndex of changed) {
    const lineFrames = buildSelectReplaceFrames(
      beforeLines[lineIndex]!,
      afterLines[lineIndex]!,
    );
    for (const nextLine of lineFrames) {
      lines[lineIndex] = nextLine;
      frames.push(lines.join("\n"));
    }
    lines[lineIndex] = afterLines[lineIndex]!;
  }
  return frames;
}

/** Caret sits at the typed boundary of an in-place full-line rewrite. */
export function caretOffsetForRewrite(
  before: string,
  after: string,
  current: string,
): number {
  const anchor = lineAnchorForRewrite(before, after, current);
  return anchor.contentOffset;
}

/**
 * Map a rewrite frame onto the visual line peers should paint. Offsets inside
 * the line ignore leading newlines so list-item DOM ranges stay exact.
 */
export function lineAnchorForRewrite(
  before: string,
  after: string,
  current: string,
): { lineIndex: number; offsetInLine: number; contentOffset: number } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (
    beforeLines.length === afterLines.length &&
    beforeLines.length > 1 &&
    before.includes("\n")
  ) {
    let lineIndex = 0;
    for (; lineIndex < afterLines.length; lineIndex += 1) {
      if (beforeLines[lineIndex] !== afterLines[lineIndex]) break;
    }
    if (lineIndex >= afterLines.length) lineIndex = afterLines.length - 1;
    const prefix = afterLines.slice(0, lineIndex).join("\n");
    const prefixLength = lineIndex === 0 ? 0 : prefix.length + 1;
    const currentLine = current.slice(prefixLength).split("\n")[0] ?? "";
    const targetLine = afterLines[lineIndex] ?? "";
    let typed = 0;
    const limit = Math.min(targetLine.length, currentLine.length);
    while (typed < limit && currentLine[typed] === targetLine[typed])
      typed += 1;
    if (
      typed === 0 &&
      (beforeLines[lineIndex] ?? "").length > 0 &&
      currentLine === (beforeLines[lineIndex] ?? "")
    ) {
      return { lineIndex, offsetInLine: 0, contentOffset: prefixLength };
    }
    return {
      lineIndex,
      offsetInLine: typed,
      contentOffset: prefixLength + typed,
    };
  }
  let typed = 0;
  const limit = Math.min(after.length, current.length);
  while (typed < limit && current[typed] === after[typed]) typed += 1;
  if (typed === 0 && before.length > 0 && current === before) {
    return { lineIndex: 0, offsetInLine: 0, contentOffset: 0 };
  }
  return { lineIndex: 0, offsetInLine: typed, contentOffset: typed };
}

/** First visual line that differs between before/after (for select → type). */
export function primaryChangedLine(
  before: string,
  after: string,
): { lineIndex: number; beforeLine: string; afterLine: string } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (beforeLines.length === afterLines.length && beforeLines.length > 0) {
    for (let index = 0; index < afterLines.length; index += 1) {
      if (beforeLines[index] !== afterLines[index]) {
        return {
          lineIndex: index,
          beforeLine: beforeLines[index] ?? "",
          afterLine: afterLines[index] ?? "",
        };
      }
    }
  }
  return { lineIndex: 0, beforeLine: before, afterLine: after };
}

export function valueAtPath(value: unknown, path: string): unknown {
  if (!path || path === "/") return value;
  const segments = path
    .replace(/^\//, "")
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current: unknown = value;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Produces transient, non-durable visual frames for every artifact type.
 * Semantic-region snapshots carry these frames through awareness; the final
 * value is still committed once through Yjs and remains the only durable fact.
 *
 * Edits animate one field/region at a time with a select→replace rewrite
 * at a human-readable pace. Parallel multi-field typing reads as machine noise
 * and lights every touched control at once.
 */
export function buildArtifactLivePreviewFrames(
  before: ArtifactLiveValue,
  after: ArtifactLiveValue,
): ArtifactLiveValue[] {
  const changes = collectStringChanges(before, after);
  if (changes.length === 0) {
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [structuredClone(after)];
  }

  // Frames share every untouched subtree with `before` and with each other
  // (they are read-only snapshots). Cloning and serializing the whole value
  // for every typed prefix cost ~190 ms for five edits on a 1,000-object
  // board, and made each later frame diff walk the entire artifact.
  const frames: ArtifactLiveValue[] = [];
  let current: unknown = before;
  let lastPushed: unknown = before;

  // Every candidate is `current` with one string changed at `path`, and the
  // last pushed frame differs from `current` at most at that same kind of
  // leaf, so comparing the string at `path` is the whole-value comparison.
  const pushFrame = (value: unknown, path: readonly (string | number)[]) => {
    if (stringAt(value, path) === stringAt(lastPushed, path)) return;
    frames.push(value as ArtifactLiveValue);
    lastPushed = value;
  };

  for (const change of changes) {
    // Select-then-replace: after approach/select beats, stream prefixes of the
    // new line only — never leave old glyphs overlapping the typed head.
    const rewriteFrames = buildLineAwareRewriteFrames(
      change.before,
      change.after,
    );
    for (const nextText of rewriteFrames)
      pushFrame(withStringAt(current, change.path, nextText), change.path);
    current = withStringAt(current, change.path, change.after);
    pushFrame(current, change.path);
  }

  if (JSON.stringify(after) !== JSON.stringify(lastPushed))
    frames.push(structuredClone(after));
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
