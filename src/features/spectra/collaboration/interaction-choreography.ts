import type { ArtifactLiveValue } from "./artifact-yjs-model";
import type {
  CollaborationCursor,
  CollaborationInteraction,
  CollaborationPresence,
} from "./types";
import {
  collectStringChanges,
  pointer,
  valueAtPath,
  withStringAt,
} from "./artifact-live-preview";
import { hashSeed, seededRandom, type Random } from "./hand/random";
import { planTextHand } from "./hand/text";
import { pointForOffset } from "./text-transition";

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
  /** When set, paint a non-collapsed selection selectionStart..selectionEnd. */
  selectionEnd?: number;
  /** Start of that selection, in the same line as `caretOffset`; 0 when absent. */
  selectionStart?: number;
  /** Already given a human rhythm by the hand; the pacing pass leaves it. */
  paced?: boolean;
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
  /** `add` puts a new entry under `key` in a keyed collection (a sheet's cells). */
  kind: "insert" | "remove" | "add";
  index: number;
  key?: string;
  item: unknown;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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
    // A record whose entries are all items (a sheet's cells by address) is a
    // keyed collection: each new entry is made where it goes, one at a time.
    const entries = Object.values(beforeRecord);
    if (entries.length && entries.every(isPlainRecord))
      for (const key of Object.keys(afterRecord))
        if (!(key in beforeRecord) && isPlainRecord(afterRecord[key]))
          return { path, kind: "add", index: -1, key, item: afterRecord[key] };
  }
  return null;
}

const BOOKKEEPING_PATH = /\/(?:nativeBinding|rowIdentities|columnIdentities)(?:\/|$)/;

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

/**
 * A new keyed entry as it first appears: its formatting and identity are part
 * of it from the start, its words and numbers are still to be typed.
 */
function entryShell(item: unknown): unknown {
  if (!isPlainRecord(item)) return provisionalItem(item);
  return Object.fromEntries(
    Object.entries(item).map(([key, child]) => [
      key,
      typeof child === "number" || (typeof child === "string" && !STRUCTURAL_STRING_KEYS.has(key))
        ? ""
        : isPlainRecord(child)
          ? child
          : provisionalItem(child, key),
    ]),
  );
}

/** The entry with its numbers as the digits a person types. */
function typedEntry(item: unknown): unknown {
  if (!isPlainRecord(item)) return item;
  return Object.fromEntries(
    Object.entries(item).map(([key, child]) => [key, typeof child === "number" ? String(child) : child]),
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
  if (change.kind === "add") {
    if (!isPlainRecord(collection) || change.key === undefined) return [];
    // Click into the place, then the entry exists, still empty of words.
    const entryPath = `${collectionPath === "/" ? "" : collectionPath}/${change.key}`;
    const provisional = entryShell(change.item) as Record<string, unknown>;
    // A formula's result appears when the formula does, not before it.
    if (typeof provisional.formula === "string") delete provisional.value;
    collection[change.key] = provisional;
    return [
      {
        delayMs: 220,
        value: base,
        previewGesture: "selecting",
        cursorMode: "pointer",
        interaction: { kind: "pointer", targetId: entryPath, targetKind: "path" },
        focusPath: entryPath,
        menu: null,
      },
      {
        delayMs: 110,
        value: staged,
        previewGesture: "typing",
        cursorMode: "typing",
        interaction: { kind: "focus", targetId: entryPath, targetKind: "path" },
        focusPath: entryPath,
        menu: null,
      },
    ];
  }
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
export type HandPacing = {
  /** Same seed, same performance: every viewer of one edit sees the same hand. */
  seed?: number | string;
  /** Below 1 compresses (work is waiting), above 1 relaxes. */
  tempo?: number;
};

type Pacing = { random: Random; tempo: number };

export function buildArtifactLivePreviewBeats(
  before: ArtifactLiveValue,
  after: ArtifactLiveValue,
  choreography?: { target: string; region?: string },
  options: HandPacing = {},
): AiStreamBeat[] {
  const pacing: Pacing = {
    random: seededRandom(options.seed ?? hashSeed(JSON.stringify([before.title, after.title]))),
    tempo: Math.max(0.2, Math.min(1.6, options.tempo ?? 1)),
  };
  const beats = applyIrChoreography(
    before,
    buildArtifactLivePreviewBeatsFromDiff(before, after, pacing),
    choreography,
  );
  // Fixed gesture holds (menus, toggles, approaches) get the same human
  // unevenness as typing, so nothing ticks on an interval.
  for (const beat of beats)
    if (!beat.paced) beat.delayMs = Math.round(pacing.random.around(beat.delayMs, 0.24) * pacing.tempo);
  return beats;
}

function applyIrChoreography(
  before: ArtifactLiveValue,
  beats: AiStreamBeat[],
  choreography?: { target: string; region?: string },
): AiStreamBeat[] {
  if (!choreography || beats.length === 0) return beats;
  if (beats[0]?.interaction?.kind === "pointer") return beats;
  const targetId = choreography.region ?? choreography.target;
  return [
    {
      delayMs: 120,
      value: structuredClone(before) as ArtifactLiveValue,
      previewGesture: "selecting",
      interaction: {
        kind: "pointer",
        targetId,
        targetKind: choreography.target.startsWith("workbar")
          ? "selector"
          : "path",
      },
      ...(choreography.region ? { focusPath: `/${choreography.region}` } : {}),
      menu: null,
    },
    ...beats,
  ];
}

function buildArtifactLivePreviewBeatsFromDiff(
  before: ArtifactLiveValue,
  after: ArtifactLiveValue,
  pacing: Pacing,
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
  if (structuralChange?.kind === "add" && structuralChange.key !== undefined) {
    const structuralBeats = collectionBeats(before, structuralChange);
    const staged = structuralBeats.at(-1)?.value;
    if (staged) {
      // The new entry is written in full before the hand moves on.
      const withEntry = (item: unknown) => {
        const value = structuredClone(staged) as ArtifactLiveValue;
        (valueAtPath(value, pathKey(structuralChange.path)) as Record<string, unknown>)[structuralChange.key!] =
          structuredClone(item);
        return value;
      };
      // Numbers are typed as their digits; the rest goes on from the real entry.
      const filled = withEntry(structuralChange.item);
      const beats = [
        ...structuralBeats,
        ...buildArtifactLivePreviewBeatsFromDiff(staged, withEntry(typedEntry(structuralChange.item)), pacing),
        ...buildArtifactLivePreviewBeatsFromDiff(filled, after, pacing),
      ];
      // Typed digits become the numbers they stand for as the hand leaves.
      if (JSON.stringify(beats.at(-1)?.value) !== JSON.stringify(after))
        beats.push({ delayMs: 120, value: structuredClone(after), previewGesture: "typing", cursorMode: "typing", interaction: null, menu: null });
      // A beat that only lands the untyped rest keeps the hand where it was.
      let resting: string | undefined;
      return beats.map((beat) => {
        if (beat.focusPath || beat.interaction) {
          resting = beat.focusPath ?? resting;
          return beat;
        }
        return resting ? { ...beat, focusPath: resting } : beat;
      });
    }
  } else if (structuralChange) {
    const structuralBeats = collectionBeats(before, structuralChange);
    const staged = structuralBeats.at(-1)?.value;
    if (staged && JSON.stringify(staged) !== JSON.stringify(before)) {
      return [
        ...structuralBeats,
        ...buildArtifactLivePreviewBeatsFromDiff(staged, after, pacing),
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

  // Text: each field is edited where it differs, with the gesture a person
  // would use (backspace, double-click, drag) and a typing rhythm.
  const textTarget = structuredClone(after) as ArtifactLiveValue;
  let value: unknown = current;
  for (const change of collectStringChanges(current, textTarget)) {
    const focusPath = pointer(change.path);
    // The file's own bookkeeping is never on screen; it lands with the rest.
    if (BOOKKEEPING_PATH.test(focusPath)) continue;
    const code = /\/(?:files|source|code)(?:\/|$)/.test(focusPath);
    for (const step of planTextHand(change.before, change.after, pacing.random, { tempo: pacing.tempo, code })) {
      value = withStringAt(value, change.path, step.value);
      const caret = pointForOffset(step.value, step.caret);
      const selection = step.selection
        ? { start: pointForOffset(step.value, step.selection.start), end: pointForOffset(step.value, step.selection.end) }
        : undefined;
      const kind = step.gesture === "pointer" ? "pointer" : step.gesture === "selecting" ? "selecting" : "typing";
      beats.push({
        delayMs: step.delayMs,
        paced: true,
        value: value as ArtifactLiveValue,
        previewGesture: step.gesture === "pointer" ? "selecting" : step.gesture,
        cursorMode: step.gesture === "pointer" ? "pointer" : step.gesture === "selecting" ? "selecting" : "typing",
        interaction: { kind, targetId: focusPath, targetKind: "path" },
        focusPath,
        caretOffset: caret.offset,
        lineIndex: caret.line,
        ...(selection && selection.start.line === selection.end.line
          ? { selectionStart: selection.start.offset, selectionEnd: Math.max(selection.start.offset + 1, selection.end.offset) }
          : {}),
        menu: null,
      });
    }
    value = withStringAt(value, change.path, change.after);
  }

  if (JSON.stringify(value) !== JSON.stringify(after)) {
    // What is left is not typed; the hand stays where it last worked.
    const resting = beats.findLast((beat) => beat.focusPath)?.focusPath;
    beats.push({
      delayMs: 220,
      value: structuredClone(after),
      previewGesture: "typing",
      cursorMode: "typing",
      interaction: null,
      ...(resting ? { focusPath: resting } : {}),
      menu: null,
    });
  }
  return beats;
}
