import type { ArtifactLiveValue } from "./artifact-yjs-model";
import type {
  CollaborationCursor,
  CollaborationInteraction,
  CollaborationPresence,
} from "./types";
import {
  artifactLivePreviewPatches,
  buildArtifactLivePreviewFrames,
  lineAnchorForRewrite,
  primaryChangedLine,
  valueAtPath,
} from "./artifact-live-preview";

/**
 * One timed beat of AI (or mirrored human) presence. Gesture-only beats keep
 * the prior speculative value so peers see cursor/menu motion before content
 * changes — matching how a real collaborator opens a control first.
 */
export type AiStreamBeat = {
  delayMs: number;
  value: ArtifactLiveValue;
  previewGesture?: CollaborationPresence["previewGesture"];
  interaction?: CollaborationInteraction | null;
  cursorMode?: NonNullable<CollaborationCursor>["mode"];
  /** Peer-rendered fake open menu (native <select> cannot be opened remotely). */
  menu?: {
    open: boolean;
    label: string;
    options: Array<{ value: string; label: string }>;
    highlighted?: string;
  } | null;
  focusPath?: string;
  /** Exact caret character offset inside the focused text line/block. */
  caretOffset?: number;
  /** Visual line inside a multiline field (list bullets). */
  lineIndex?: number;
  /** When set, paint a non-collapsed selection 0..selectionEnd before typing. */
  selectionEnd?: number;
  /** Explicit phase for spatial gestures whose value changes over many beats. */
  gesturePhase?: "start" | "move" | "release";
  /** Exact sub-control for composite gestures, such as a resize handle. */
  focusPart?: string;
};

const ATOMIC_ENUM_FIELDS = new Set([
  "status",
  "priority",
  "difficulty",
  "confidence",
  "variant",
  "type",
  "kind",
  "tone",
  "alignment",
  "feedbackRelease",
  "estimateMinutes",
]);

const DROPDOWN_OPTION_LABELS: Record<string, Record<string, string>> = {
  status: {
    todo: "Todo",
    doing: "In progress",
    done: "Done",
  },
  priority: {
    low: "Low",
    medium: "Medium",
    high: "High",
  },
  difficulty: {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
  },
  confidence: {
    unknown: "Unknown",
    low: "Low",
    medium: "Medium",
    high: "High",
  },
};

type LeafChange = {
  path: Array<string | number>;
  before: unknown;
  after: unknown;
};

type CollectionChange = {
  path: Array<string | number>;
  kind: "insert" | "remove";
  index: number;
  item: unknown;
};

function pathKey(path: Array<string | number>) {
  return `/${path.map(String).join("/")}`;
}

/** UI / data-ai-path pointers are content-relative (`/status`), not `/content/status`. */
function uiFocusPath(path: Array<string | number>) {
  const key = pathKey(path);
  if (key === "/content") return "/";
  if (key.startsWith("/content/")) return key.slice("/content".length);
  return key;
}

function collectLeafChanges(
  before: unknown,
  after: unknown,
  path: Array<string | number> = [],
): LeafChange[] {
  if (Object.is(before, after)) return [];
  if (
    (typeof before === "string" && typeof after === "string") ||
    (typeof before === "number" && typeof after === "number") ||
    (typeof before === "boolean" && typeof after === "boolean") ||
    before === null ||
    after === null
  ) {
    return before !== after ? [{ path, before, after }] : [];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return [{ path, before, after }];
    return before.flatMap((value, index) =>
      collectLeafChanges(value, after[index], [...path, index]),
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
    const keys = new Set([
      ...Object.keys(beforeRecord),
      ...Object.keys(afterRecord),
    ]);
    return [...keys].flatMap((key) =>
      key in beforeRecord && key in afterRecord
        ? collectLeafChanges(beforeRecord[key], afterRecord[key], [
            ...path,
            key,
          ])
        : [
            {
              path: [...path, key],
              before: beforeRecord[key],
              after: afterRecord[key],
            },
          ],
    );
  }
  return [{ path, before, after }];
}

function stableItemIdentity(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "_id", "key", "address"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0)
      return `${key}:${candidate}`;
  }
  return null;
}

function itemsMatch(left: unknown, right: unknown) {
  const leftIdentity = stableItemIdentity(left);
  const rightIdentity = stableItemIdentity(right);
  if (leftIdentity || rightIdentity) return leftIdentity === rightIdentity;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Return only the next structural mutation. Re-running this after every beat
 * gives collections a visible, ordered lifecycle instead of replacing a whole
 * array (and lighting every sibling) in one frame.
 */
function firstCollectionChange(
  before: unknown,
  after: unknown,
  path: Array<string | number> = [],
): CollectionChange | null {
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      let prefix = 0;
      while (
        prefix < before.length &&
        prefix < after.length &&
        itemsMatch(before[prefix], after[prefix])
      )
        prefix += 1;

      if (after.length > before.length)
        return {
          path,
          kind: "insert",
          index: prefix,
          item: after[prefix],
        };
      return {
        path,
        kind: "remove",
        index: prefix,
        item: before[prefix],
      };
    }
    for (let index = 0; index < before.length; index += 1) {
      const nested = firstCollectionChange(before[index], after[index], [
        ...path,
        index,
      ]);
      if (nested) return nested;
    }
    return null;
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
      if (!(key in beforeRecord)) continue;
      const nested = firstCollectionChange(
        beforeRecord[key],
        afterRecord[key],
        [...path, key],
      );
      if (nested) return nested;
    }
  }
  return null;
}

const STRUCTURAL_STRING_KEYS = new Set([
  "id",
  "_id",
  "key",
  "type",
  "kind",
  "variant",
  "layoutId",
  "role",
  "format",
]);

/**
 * A valid-enough provisional body for a newly introduced structured item.
 * Identity, geometry and discriminants exist immediately so the native editor
 * can render and locate it; authored prose and nested collections then form in
 * their own observable beats.
 */
function provisionalItem(value: unknown, key = ""): unknown {
  if (typeof value === "string")
    return STRUCTURAL_STRING_KEYS.has(key) ? value : "";
  if (Array.isArray(value)) return [];
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([childKey, child]) => [childKey, provisionalItem(child, childKey)],
    ),
  );
}

function collectionLabel(path: readonly (string | number)[]) {
  const name = String(path.at(-1) ?? "item")
    .replaceAll("_", " ")
    .replace(/s$/, "");
  return `Add ${name || "item"}`;
}

function collectionBeats(
  base: ArtifactLiveValue,
  change: CollectionChange,
): AiStreamBeat[] {
  const collectionPath = uiFocusPath(change.path);
  const itemPath = `${collectionPath === "/" ? "" : collectionPath}/${change.index}`;
  const label = collectionLabel(change.path);
  const staged = structuredClone(base) as ArtifactLiveValue;
  const collection = valueAtPath(staged, pathKey(change.path));
  if (!Array.isArray(collection)) return [];

  if (change.kind === "insert")
    collection.splice(change.index, 0, provisionalItem(change.item));
  else collection.splice(change.index, 1);

  return [
    ...approachBeats(base, collectionPath, label),
    {
      delayMs: 260,
      value: staged,
      previewGesture: "selecting",
      cursorMode: "pointer",
      interaction: {
        kind: change.kind === "insert" ? "create" : "remove",
        targetId: itemPath,
        targetKind: "path",
        label,
      },
      focusPath: itemPath,
      menu: null,
    },
  ];
}

function setAtPath(
  value: unknown,
  path: readonly (string | number)[],
  next: unknown,
) {
  let current = value;
  for (const segment of path.slice(0, -1)) {
    if (!current || typeof current !== "object") return;
    current = (current as Record<string | number, unknown>)[segment];
  }
  if (!current || typeof current !== "object") return;
  (current as Record<string | number, unknown>)[path.at(-1)!] = next;
}

function fieldName(path: Array<string | number>) {
  return String(path.at(-1) ?? "");
}

function isDropdownChange(change: LeafChange) {
  const field = fieldName(change.path);
  if (!ATOMIC_ENUM_FIELDS.has(field)) return false;
  return (
    (typeof change.before === "string" || typeof change.before === "number") &&
    (typeof change.after === "string" || typeof change.after === "number")
  );
}

function isToggleChange(change: LeafChange) {
  return (
    typeof change.before === "boolean" && typeof change.after === "boolean"
  );
}

function dropdownOptions(change: LeafChange) {
  const field = fieldName(change.path);
  const labels = DROPDOWN_OPTION_LABELS[field] ?? {};
  const values = new Set<string>([
    ...Object.keys(labels),
    String(change.before),
    String(change.after),
  ]);
  return [...values].map((value) => ({
    value,
    label: labels[value] ?? value,
  }));
}

function approachBeats(
  value: ArtifactLiveValue,
  focusPath: string,
  label: string,
): AiStreamBeat[] {
  return [
    {
      delayMs: 200,
      value,
      previewGesture: "selecting",
      cursorMode: "pointer",
      interaction: {
        kind: "pointer",
        targetId: focusPath,
        targetKind: "path",
        label,
      },
      focusPath,
      menu: null,
    },
    {
      delayMs: 240,
      value,
      previewGesture: "selecting",
      cursorMode: "pointer",
      interaction: {
        kind: "focus",
        targetId: focusPath,
        targetKind: "path",
        label,
      },
      focusPath,
      menu: null,
    },
  ];
}

function dropdownBeats(
  base: ArtifactLiveValue,
  change: LeafChange,
): AiStreamBeat[] {
  const focusPath = uiFocusPath(change.path);
  const field = fieldName(change.path);
  const options = dropdownOptions(change);
  const afterValue = String(change.after);
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  const beats: AiStreamBeat[] = [
    ...approachBeats(base, focusPath, label),
    {
      delayMs: 260,
      value: base,
      previewGesture: "selecting",
      cursorMode: "selecting",
      interaction: {
        kind: "menu",
        targetId: focusPath,
        targetKind: "path",
        label,
      },
      focusPath,
      menu: {
        open: true,
        label,
        options,
        highlighted: String(change.before),
      },
    },
  ];
  // Pause on the open menu, then walk highlight toward the chosen option.
  beats.push({
    delayMs: 280,
    value: base,
    previewGesture: "selecting",
    cursorMode: "selecting",
    interaction: {
      kind: "menu",
      targetId: focusPath,
      targetKind: "path",
      label,
    },
    focusPath,
    menu: {
      open: true,
      label,
      options,
      highlighted: String(change.before),
    },
  });
  if (String(change.before) !== afterValue) {
    beats.push({
      delayMs: 240,
      value: base,
      previewGesture: "selecting",
      cursorMode: "selecting",
      interaction: {
        kind: "menu",
        targetId: focusPath,
        targetKind: "path",
        label,
      },
      focusPath,
      menu: {
        open: true,
        label,
        options,
        highlighted: afterValue,
      },
    });
  }
  const committed = structuredClone(base) as ArtifactLiveValue;
  setAtPath(committed, change.path, change.after);
  beats.push({
    delayMs: 220,
    value: committed,
    previewGesture: "typing",
    cursorMode: "pointer",
    interaction: {
      kind: "menu",
      targetId: focusPath,
      targetKind: "path",
      label,
    },
    focusPath,
    menu: {
      open: true,
      label,
      options,
      highlighted: afterValue,
    },
  });
  beats.push({
    delayMs: 200,
    value: committed,
    previewGesture: "typing",
    cursorMode: "pointer",
    interaction: {
      kind: "focus",
      targetId: focusPath,
      targetKind: "path",
      label,
    },
    focusPath,
    menu: null,
  });
  return beats;
}

function toggleBeats(
  base: ArtifactLiveValue,
  change: LeafChange,
): AiStreamBeat[] {
  const focusPath = uiFocusPath(change.path);
  const label = fieldName(change.path);
  const committed = structuredClone(base) as ArtifactLiveValue;
  setAtPath(committed, change.path, change.after);
  return [
    ...approachBeats(base, focusPath, label),
    {
      delayMs: 200,
      value: base,
      previewGesture: "selecting",
      cursorMode: "pointer",
      interaction: {
        kind: "toggle",
        targetId: focusPath,
        targetKind: "path",
        label,
      },
      focusPath,
      menu: null,
    },
    {
      delayMs: 220,
      value: committed,
      previewGesture: "typing",
      cursorMode: "pointer",
      interaction: {
        kind: "toggle",
        targetId: focusPath,
        targetKind: "path",
        label,
      },
      focusPath,
      menu: null,
    },
  ];
}

function textApproachBeats(
  value: ArtifactLiveValue,
  focusPath: string,
  beforeLength: number,
  lineIndex = 0,
): AiStreamBeat[] {
  const cleared = structuredClone(value) as ArtifactLiveValue;
  const beforeRaw = valueAtPath(value, focusPath);
  if (typeof beforeRaw === "string" && beforeRaw.includes("\n")) {
    const lines = beforeRaw.split("\n");
    lines[lineIndex] = "";
    setAtPathSafe(cleared, focusPath, lines.join("\n"));
  } else if (typeof beforeRaw === "string") {
    setAtPathSafe(cleared, focusPath, "");
  }
  return [
    {
      delayMs: 160,
      value,
      previewGesture: "selecting",
      cursorMode: "pointer",
      interaction: {
        kind: "pointer",
        targetId: focusPath,
        targetKind: "path",
      },
      focusPath,
      caretOffset: 0,
      lineIndex,
      menu: null,
    },
    {
      delayMs: 180,
      value,
      previewGesture: "selecting",
      cursorMode: "selecting",
      interaction: {
        kind: "focus",
        targetId: focusPath,
        targetKind: "path",
      },
      focusPath,
      caretOffset: 0,
      lineIndex,
      menu: null,
    },
    {
      delayMs: 300,
      value,
      previewGesture: "selecting",
      cursorMode: "selecting",
      interaction: {
        kind: "selecting",
        targetId: focusPath,
        targetKind: "path",
      },
      focusPath,
      caretOffset: 0,
      lineIndex,
      selectionEnd: Math.max(1, beforeLength),
      menu: null,
    },
    // Clear the selected line before typing so peers never see old+new overlap.
    {
      delayMs: 110,
      value: cleared,
      previewGesture: "typing",
      cursorMode: "typing",
      interaction: {
        kind: "typing",
        targetId: focusPath,
        targetKind: "path",
      },
      focusPath,
      caretOffset: 0,
      lineIndex,
      menu: null,
    },
  ];
}

function setAtPathSafe(value: ArtifactLiveValue, path: string, next: unknown) {
  const segments = path
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      /^\d+$/.test(segment)
        ? Number(segment)
        : segment.replaceAll("~1", "/").replaceAll("~0", "~"),
    );
  let current: unknown = value;
  for (const segment of segments.slice(0, -1)) {
    if (!current || typeof current !== "object") return;
    current = (current as Record<string | number, unknown>)[
      segment as string | number
    ];
  }
  if (!current || typeof current !== "object") return;
  const last = segments.at(-1);
  if (last === undefined) return;
  (current as Record<string | number, unknown>)[last as string | number] = next;
}

function spatialNodeChange(change: LeafChange) {
  const key = pathKey(change.path);
  const match = key.match(/^\/content\/nodes\/(\d+)\/(x|y|width|height)$/);
  return match &&
    typeof change.before === "number" &&
    typeof change.after === "number"
    ? { index: Number(match[1]), field: match[2]!, key }
    : null;
}

function spatialBeats(
  current: ArtifactLiveValue,
  changes: LeafChange[],
): AiStreamBeat[] {
  const grouped = new Map<number, LeafChange[]>();
  for (const change of changes) {
    const spatial = spatialNodeChange(change);
    if (!spatial) continue;
    const rows = grouped.get(spatial.index) ?? [];
    rows.push(change);
    grouped.set(spatial.index, rows);
  }
  const beats: AiStreamBeat[] = [];
  let value = structuredClone(current) as ArtifactLiveValue;
  for (const [index, nodeChanges] of grouped) {
    const position = nodeChanges.filter((change) =>
      /\/(?:x|y)$/.test(pathKey(change.path)),
    );
    const size = nodeChanges.filter((change) =>
      /\/(?:width|height)$/.test(pathKey(change.path)),
    );
    const focusPath = `/content/nodes/${index}`;
    const perform = (
      kind: "dragging" | "resizing",
      activeChanges: LeafChange[],
    ) => {
      if (!activeChanges.length) return;
      beats.push({
        delayMs: 190,
        value: structuredClone(value),
        previewGesture: "selecting",
        interaction: {
          kind,
          targetId: focusPath,
          targetKind: "path",
        },
        focusPath,
        ...(kind === "resizing" ? { focusPart: "handle:se" } : {}),
        gesturePhase: "start",
        menu: null,
      });
      const start = structuredClone(value) as ArtifactLiveValue;
      for (let frame = 1; frame <= 6; frame += 1) {
        const next = structuredClone(start) as ArtifactLiveValue;
        for (const change of activeChanges) {
          const interpolated =
            Number(change.before) +
            (Number(change.after) - Number(change.before)) * (frame / 6);
          setAtPathSafe(next, pathKey(change.path), interpolated);
        }
        value = next;
        beats.push({
          delayMs: frame === 6 ? 150 : 78,
          value: structuredClone(value),
          previewGesture: "selecting",
          interaction: {
            kind,
            targetId: focusPath,
            targetKind: "path",
          },
          focusPath,
          ...(kind === "resizing" ? { focusPart: "handle:se" } : {}),
          gesturePhase: frame === 6 ? "release" : "move",
          menu: null,
        });
      }
    };
    perform("dragging", position);
    perform("resizing", size);
  }
  return beats;
}

/**
 * Expands a before→after artifact mutation into human-paced beats:
 * approach the control, perform the native gesture (menu / toggle / type),
 * then settle. Content frames still come from the string animator; enum and
 * boolean fields get hard-coded dropdown/toggle choreography.
 */
export function buildArtifactLivePreviewBeats(
  before: ArtifactLiveValue,
  after: ArtifactLiveValue,
): AiStreamBeat[] {
  const structuralChange = firstCollectionChange(
    {
      title: before.title,
      summary: before.summary,
      tags: before.tags,
      content: before.content,
    },
    {
      title: after.title,
      summary: after.summary,
      tags: after.tags,
      content: after.content,
    },
  );
  if (structuralChange) {
    const structuralBeats = collectionBeats(before, structuralChange);
    const staged = structuralBeats.at(-1)?.value;
    if (staged && JSON.stringify(staged) !== JSON.stringify(before)) {
      return [
        ...structuralBeats,
        ...buildArtifactLivePreviewBeats(staged, after),
      ];
    }
  }

  const leafChanges = collectLeafChanges(
    {
      title: before.title,
      summary: before.summary,
      tags: before.tags,
      content: before.content,
    },
    {
      title: after.title,
      summary: after.summary,
      tags: after.tags,
      content: after.content,
    },
  );
  if (leafChanges.length === 0) return [];

  const beats: AiStreamBeat[] = [];
  let current = structuredClone(before) as ArtifactLiveValue;

  // Prefer explicit dropdown/toggle choreography for atomic controls first.
  const atomic = leafChanges.filter(
    (change) => isDropdownChange(change) || isToggleChange(change),
  );
  const remainingPaths = new Set(
    leafChanges
      .filter((change) => !isDropdownChange(change) && !isToggleChange(change))
      .map((change) => pathKey(change.path)),
  );
  const spatialChanges = leafChanges.filter((change) =>
    Boolean(spatialNodeChange(change)),
  );
  for (const change of spatialChanges) {
    remainingPaths.delete(pathKey(change.path));
  }

  for (const change of atomic) {
    if (isDropdownChange(change)) {
      const sequence = dropdownBeats(current, change);
      beats.push(...sequence);
      current = structuredClone(sequence.at(-1)!.value) as ArtifactLiveValue;
      continue;
    }
    if (isToggleChange(change)) {
      const sequence = toggleBeats(current, change);
      beats.push(...sequence);
      current = structuredClone(sequence.at(-1)!.value) as ArtifactLiveValue;
    }
  }

  if (spatialChanges.length) {
    const sequence = spatialBeats(current, spatialChanges);
    beats.push(...sequence);
    current = structuredClone(sequence.at(-1)!.value) as ArtifactLiveValue;
  }

  if (remainingPaths.size === 0) {
    if (JSON.stringify(current) !== JSON.stringify(after)) {
      beats.push({
        delayMs: 380,
        value: structuredClone(after),
        previewGesture: "typing",
        cursorMode: "typing",
        interaction: null,
        menu: null,
      });
    }
    return beats;
  }

  // Textual / remaining fields: select the whole line, then in-place rewrite.
  const textTarget = structuredClone(after) as ArtifactLiveValue;
  const frames = buildArtifactLivePreviewFrames(current, textTarget);
  if (frames.length === 0) {
    if (JSON.stringify(current) !== JSON.stringify(after)) {
      beats.push({
        delayMs: 520,
        value: structuredClone(after),
        previewGesture: "typing",
        cursorMode: "typing",
        menu: null,
      });
    }
    return beats;
  }

  let previous = current;
  let introducedPath: string | undefined;
  let baselineBefore = "";
  let baselineAfter = "";
  let activeLineIndex = 0;
  for (const frame of frames) {
    const delta = artifactLivePreviewPatches(previous, frame);
    const focusPath = delta[0]?.path;
    const focusValue = delta[0]?.value;
    if (focusPath && focusPath !== introducedPath) {
      const beforeRaw = valueAtPath(previous, focusPath);
      const afterRaw = valueAtPath(textTarget, focusPath);
      baselineBefore = typeof beforeRaw === "string" ? beforeRaw : "";
      baselineAfter = typeof afterRaw === "string" ? afterRaw : "";
      const changedLine = primaryChangedLine(baselineBefore, baselineAfter);
      activeLineIndex = changedLine.lineIndex;
      beats.push(
        ...textApproachBeats(
          previous,
          focusPath,
          changedLine.beforeLine.length,
          activeLineIndex,
        ),
      );
      introducedPath = focusPath;
    }
    const caret =
      typeof focusValue === "string"
        ? lineAnchorForRewrite(baselineBefore, baselineAfter, focusValue)
        : { lineIndex: activeLineIndex, offsetInLine: 0, contentOffset: 0 };
    beats.push({
      // Stay above the collaboration/editor coalescing window. This is the
      // visible typing cadence, not an artificial post-hoc animation: every
      // beat carries the actor's current caret and speculative native value.
      delayMs: 104,
      value: frame,
      previewGesture: "typing",
      cursorMode: "typing",
      interaction: focusPath
        ? {
            kind: "typing",
            targetId: focusPath,
            targetKind: "path",
          }
        : { kind: "typing" },
      focusPath,
      caretOffset: caret.offsetInLine,
      lineIndex: caret.lineIndex,
      menu: null,
    });
    previous = frame;
  }

  if (JSON.stringify(previous) !== JSON.stringify(after)) {
    beats.push({
      delayMs: 280,
      value: structuredClone(after),
      previewGesture: "typing",
      cursorMode: "typing",
      interaction: null,
      menu: null,
    });
  }
  return beats;
}
