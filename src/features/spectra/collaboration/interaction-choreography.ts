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
  return typeof change.before === "boolean" && typeof change.after === "boolean";
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
      delayMs: 160,
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
      delayMs: 140,
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
      delayMs: 220,
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
      delayMs: 70,
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

function setAtPathSafe(
  value: ArtifactLiveValue,
  path: string,
  next: string,
) {
  const segments = path
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      /^\d+$/.test(segment) ? Number(segment) : segment.replaceAll("~1", "/").replaceAll("~0", "~"),
    );
  let current: unknown = value;
  for (const segment of segments.slice(0, -1)) {
    if (!current || typeof current !== "object") return;
    current = (current as Record<string | number, unknown>)[segment as string | number];
  }
  if (!current || typeof current !== "object") return;
  const last = segments.at(-1);
  if (last === undefined) return;
  (current as Record<string | number, unknown>)[last as string | number] = next;
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
  const leafChanges = collectLeafChanges(
    { title: before.title, summary: before.summary, tags: before.tags, content: before.content },
    { title: after.title, summary: after.summary, tags: after.tags, content: after.content },
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
      delayMs: 72,
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
