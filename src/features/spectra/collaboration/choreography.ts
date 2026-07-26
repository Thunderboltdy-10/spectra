/**
 * Control choreography.
 *
 * A choreography is the sequence of semantic interaction frames that *performing*
 * an edit looks like. It is defined once per control primitive and shared by AI
 * and by replayed human gestures, which is what stops artifact-specific AI
 * animation code from accumulating: a new artifact type declares its controls in
 * `control-descriptors.ts` and inherits every choreography here.
 *
 * Frames carry semantics and a provisional value — never pixels and never raw
 * model output. The renderer turns them into a travelling cursor, a caret, a
 * selection, an observed menu, a drag ghost or a resize frame.
 */

import {
  type InteractionAct,
  type InteractionLifecycle,
  type MenuObservation,
  type SemanticTarget,
  type TextPoint,
} from "./interaction-model";
import { planTextTransition, pointForOffset } from "./text-transition";

export type ChoreographyFrame = {
  act: InteractionAct;
  /** Milliseconds to hold this frame. */
  hold: number;
  /** Provisional value for `target.path`, if this frame changes it. */
  value?: unknown;
  note?: string;
  menu?: MenuObservation | null;
  dropTarget?: SemanticTarget | null;
  lifecycle?: InteractionLifecycle;
};

export type ChoreographyPlan = {
  target: SemanticTarget;
  frames: ChoreographyFrame[];
  totalMs: number;
};

/**
 * Time for the cursor to travel to a control before acting. Short enough to feel
 * immediate, long enough that the movement is legible as intent.
 */
const APPROACH_MS = 180;
const SETTLE_MS = 260;

export type ChoreographyRequest = {
  target: SemanticTarget;
  /** Current value at `target.path`. */
  before?: unknown;
  /** Intended value at `target.path`. */
  after?: unknown;
  /** Options a dropdown offers, needed to animate walking to the chosen one. */
  menuOptions?: Array<{ value: string; label: string }>;
  /** Where a dragged object ends up. */
  dropTarget?: SemanticTarget | null;
  /** Provisional size for a resize, in the artifact's own units. */
  size?: { width: number; height: number };
  /** Which handle a resize grabs. */
  handle?: string;
  /** Structural intent when it cannot be inferred from values. */
  intent?: "create" | "remove" | "reorder" | "group" | "switchView";
  reorder?: { from: number; to: number };
  members?: string[];
  /** Total animation budget for the value transition. */
  budgetMs?: number;
};

/**
 * Plan the native choreography for one operation. Returns null when there is
 * nothing to perform, so a no-op operation cannot produce a phantom
 * "AI is working" presence.
 */
export function planChoreography(
  request: ChoreographyRequest,
): ChoreographyPlan | null {
  const { target } = request;

  if (request.intent) {
    const structural = planStructural(request);
    if (structural) return finalize(target, structural);
  }

  switch (target.primitive) {
    case "text":
    case "richtext":
    case "code":
    case "gridCell": {
      const frames = planTextEdit(request);
      return frames ? finalize(target, frames) : null;
    }
    case "dropdown":
    case "viewSwitch": {
      const frames = planDropdown(request);
      return frames ? finalize(target, frames) : null;
    }
    case "toggle": {
      const frames = planToggle(request);
      return frames ? finalize(target, frames) : null;
    }
    case "button": {
      return finalize(target, planPress());
    }
    case "slider": {
      const frames = planSlider(request);
      return frames ? finalize(target, frames) : null;
    }
    case "canvasObject":
    case "timelineEvent": {
      const frames = planSpatial(request);
      return frames ? finalize(target, frames) : null;
    }
    case "listItem": {
      const frames = planListItem(request);
      return frames ? finalize(target, frames) : null;
    }
    case "surface":
      return null;
    default:
      return null;
  }
}

function finalize(
  target: SemanticTarget,
  frames: ChoreographyFrame[],
): ChoreographyPlan {
  return {
    target,
    frames,
    totalMs: frames.reduce((sum, frame) => sum + frame.hold, 0),
  };
}

/** Every choreography opens by moving to the control. */
function approach(note?: string): ChoreographyFrame {
  return {
    act: { kind: "hover" },
    hold: APPROACH_MS,
    ...(note ? { note } : {}),
  };
}

function settle(value?: unknown): ChoreographyFrame {
  return {
    act: { kind: "focus" },
    hold: SETTLE_MS,
    lifecycle: "settled",
    ...(value !== undefined ? { value } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Text: move → focus → place caret or select → clear → type → settle
 * ------------------------------------------------------------------ */

function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function planTextEdit(request: ChoreographyRequest): ChoreographyFrame[] | null {
  const before = asText(request.before);
  const after = asText(request.after);
  if (before === null || after === null || before === after) return null;

  const isCode = request.target.primitive === "code";
  const plan = planTextTransition(before, after, {
    code: isCode,
    ...(request.budgetMs !== undefined ? { budgetMs: request.budgetMs } : {}),
  });
  if (!plan) return null;

  const multiline = before.includes("\n") || after.includes("\n");
  const point = (value: string, offset: number): TextPoint => {
    if (!multiline) return { offset };
    const located = pointForOffset(value, offset);
    return { offset: located.offset, line: located.line };
  };

  const frames: ChoreographyFrame[] = [approach()];
  frames.push({ act: { kind: "focus" }, hold: 110 });

  for (const frame of plan.frames) {
    switch (frame.phase) {
      case "select": {
        const span = frame.span!;
        frames.push({
          act: {
            kind: "select",
            span: {
              anchor: point(frame.value, span.start),
              head: point(frame.value, span.end),
            },
          },
          hold: frame.hold,
          value: frame.value,
          note: "Selecting the text to replace",
        });
        break;
      }
      case "delete": {
        frames.push({
          act: { kind: "delete", span: { anchor: point(frame.value, frame.caret), head: point(frame.value, frame.caret) } },
          hold: frame.hold,
          value: frame.value,
        });
        break;
      }
      case "insert":
      case "type": {
        frames.push({
          act: { kind: frame.phase, point: point(frame.value, frame.caret) },
          hold: frame.hold,
          value: frame.value,
        });
        break;
      }
      case "settle": {
        frames.push({
          act: { kind: "caret", point: point(frame.value, frame.caret) },
          hold: frame.hold,
          value: frame.value,
        });
        break;
      }
    }
  }

  frames.push(settle(after));
  return frames;
}

/* ------------------------------------------------------------------ *
 * Dropdown: move → press → open → walk options → select → close
 * ------------------------------------------------------------------ */

function planDropdown(request: ChoreographyRequest): ChoreographyFrame[] | null {
  const after = request.after;
  const chosen =
    typeof after === "string" || typeof after === "number"
      ? String(after)
      : null;
  if (chosen === null) return null;
  const before =
    typeof request.before === "string" || typeof request.before === "number"
      ? String(request.before)
      : null;
  if (before === chosen) return null;

  const options =
    request.menuOptions && request.menuOptions.length
      ? request.menuOptions
      : buildImpliedOptions(before, chosen);
  const menu = (highlighted: string): MenuObservation => ({
    label: request.target.label ?? "Options",
    options,
    highlighted,
  });

  const frames: ChoreographyFrame[] = [approach()];
  frames.push({ act: { kind: "press" }, hold: 120 });
  frames.push({
    act: { kind: "menuOpen" },
    hold: 220,
    menu: menu(before ?? chosen),
    note: `Opening ${request.target.label ?? "the menu"}`,
  });

  // Walk from the current option to the chosen one so the movement reads as a
  // real selection rather than a value blinking into place.
  const startIndex = Math.max(
    0,
    options.findIndex((option) => option.value === before),
  );
  const endIndex = Math.max(
    0,
    options.findIndex((option) => option.value === chosen),
  );
  const step = endIndex >= startIndex ? 1 : -1;
  const walked: string[] = [];
  for (let index = startIndex; index !== endIndex; index += step) {
    const next = options[index + step];
    if (!next) break;
    walked.push(next.value);
    if (walked.length >= 6) break;
  }
  const perStep = walked.length ? Math.max(70, Math.round(420 / walked.length)) : 0;
  for (const option of walked) {
    frames.push({
      act: { kind: "menuNavigate", option },
      hold: perStep,
      menu: menu(option),
    });
  }

  frames.push({
    act: { kind: "menuSelect", option: chosen },
    hold: 200,
    menu: menu(chosen),
    value: after,
    note: `Choosing ${labelFor(options, chosen)}`,
  });
  frames.push({ act: { kind: "menuClose" }, hold: 140, value: after });
  frames.push(settle(after));
  return frames;
}

/**
 * When the caller does not supply the real option list, show only what is
 * certainly true — the previous and the chosen value. Fabricating plausible
 * options would make the observed menu a lie.
 */
function buildImpliedOptions(
  before: string | null,
  chosen: string,
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  if (before && before !== chosen)
    options.push({ value: before, label: humanize(before) });
  options.push({ value: chosen, label: humanize(chosen) });
  return options;
}

function labelFor(
  options: Array<{ value: string; label: string }>,
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? humanize(value);
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (character) => character.toUpperCase());
}

/* ------------------------------------------------------------------ *
 * Toggle, button, slider
 * ------------------------------------------------------------------ */

function planToggle(request: ChoreographyRequest): ChoreographyFrame[] | null {
  const after = request.after;
  if (after === undefined) return null;
  if (request.before === after) return null;
  const value =
    typeof after === "boolean" || typeof after === "string"
      ? after
      : Boolean(after);
  return [
    approach(),
    { act: { kind: "press" }, hold: 130 },
    {
      act: { kind: "toggle", value },
      hold: 240,
      value: after,
      note: `Switching ${request.target.label ?? "the control"}`,
    },
    settle(after),
  ];
}

function planPress(): ChoreographyFrame[] {
  return [
    approach(),
    { act: { kind: "press" }, hold: 180 },
    { act: { kind: "focus" }, hold: SETTLE_MS, lifecycle: "settled" },
  ];
}

function planSlider(request: ChoreographyRequest): ChoreographyFrame[] | null {
  const after = request.after;
  if (after === undefined || request.before === after) return null;
  const steps = 4;
  const frames: ChoreographyFrame[] = [
    approach(),
    { act: { kind: "dragStart" }, hold: 120 },
  ];
  const from = Number(request.before);
  const to = Number(after);
  const interpolate = Number.isFinite(from) && Number.isFinite(to);
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    frames.push({
      act: { kind: "dragMove", at: { x: ratio, y: 0.5 } },
      hold: 90,
      ...(interpolate ? { value: from + (to - from) * ratio } : {}),
    });
  }
  frames.push({ act: { kind: "dragRelease" }, hold: 160, value: after });
  frames.push(settle(after));
  return frames;
}

/* ------------------------------------------------------------------ *
 * Spatial objects: canvas nodes, slide objects, timeline events
 * ------------------------------------------------------------------ */

function planSpatial(request: ChoreographyRequest): ChoreographyFrame[] | null {
  const resizing = Boolean(request.size) || Boolean(request.handle);
  if (resizing) return planResize(request);

  const moved = geometryChanged(request.before, request.after);
  if (!moved && request.after === undefined) return null;

  // A text change inside a spatial object is still a text edit.
  const textFrames = planTextEdit(request);
  if (textFrames) return textFrames;
  if (!moved) return null;

  const steps = 5;
  const frames: ChoreographyFrame[] = [
    approach(),
    {
      act: { kind: "dragStart" },
      hold: 150,
      note: `Picking up ${request.target.label ?? "the object"}`,
    },
  ];
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    frames.push({
      act: { kind: "dragMove", at: { x: ratio, y: ratio } },
      hold: 80,
      ...(request.dropTarget !== undefined ? { dropTarget: request.dropTarget } : {}),
      // Only the final frame carries the durable position; intermediate frames
      // are visual so a half-applied coordinate never reaches the document.
      ...(step === steps && request.after !== undefined
        ? { value: request.after }
        : {}),
    });
  }
  frames.push({
    act: { kind: "dragRelease" },
    hold: 200,
    ...(request.after !== undefined ? { value: request.after } : {}),
    ...(request.dropTarget !== undefined ? { dropTarget: request.dropTarget } : {}),
    note: `Placing ${request.target.label ?? "the object"}`,
  });
  frames.push(settle(request.after));
  return frames;
}

function planResize(request: ChoreographyRequest): ChoreographyFrame[] | null {
  const steps = 4;
  const frames: ChoreographyFrame[] = [
    approach(),
    {
      act: { kind: "resizeStart" },
      hold: 140,
      note: `Resizing ${request.target.label ?? "the object"}`,
    },
  ];
  for (let step = 1; step <= steps; step += 1) {
    frames.push({
      act: {
        kind: "resizeMove",
        ...(request.size ? { size: request.size } : {}),
      },
      hold: 90,
    });
  }
  frames.push({
    act: { kind: "resizeRelease" },
    hold: 180,
    ...(request.after !== undefined ? { value: request.after } : {}),
  });
  frames.push(settle(request.after));
  return frames;
}

const GEOMETRY_KEYS = ["x", "y", "width", "height", "start", "end", "position"];

function geometryChanged(before: unknown, after: unknown): boolean {
  if (!before || !after) return false;
  if (typeof before !== "object" || typeof after !== "object") return false;
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  return GEOMETRY_KEYS.some(
    (key) => key in right && left[key] !== right[key],
  );
}

/* ------------------------------------------------------------------ *
 * Structural: create, remove, reorder, group, switch view
 * ------------------------------------------------------------------ */

function planListItem(request: ChoreographyRequest): ChoreographyFrame[] | null {
  if (request.before === undefined && request.after !== undefined)
    return planStructural({ ...request, intent: "create" });
  if (request.before !== undefined && request.after === undefined)
    return planStructural({ ...request, intent: "remove" });
  // A value change inside a list row is a text edit on that row.
  return planTextEdit(request);
}

function planStructural(
  request: ChoreographyRequest,
): ChoreographyFrame[] | null {
  const label = request.target.label ?? "item";
  switch (request.intent) {
    case "create":
      return [
        approach(),
        { act: { kind: "press" }, hold: 130 },
        {
          act: { kind: "create" },
          hold: 320,
          ...(request.after !== undefined ? { value: request.after } : {}),
          note: `Adding ${label}`,
        },
        settle(request.after),
      ];
    case "remove":
      return [
        approach(),
        { act: { kind: "focus" }, hold: 120 },
        {
          act: { kind: "remove" },
          hold: 300,
          note: `Removing ${label}`,
        },
        { act: { kind: "idle" }, hold: SETTLE_MS, lifecycle: "settled" },
      ];
    case "reorder": {
      const move = request.reorder;
      if (!move) return null;
      const frames: ChoreographyFrame[] = [
        approach(),
        { act: { kind: "dragStart" }, hold: 140, note: `Moving ${label}` },
      ];
      for (let step = 1; step <= 4; step += 1) {
        frames.push({
          act: { kind: "dragMove", at: { x: 0.5, y: step / 4 } },
          hold: 80,
          ...(request.dropTarget !== undefined
            ? { dropTarget: request.dropTarget }
            : {}),
        });
      }
      frames.push({
        act: { kind: "reorder", from: move.from, to: move.to },
        hold: 260,
        ...(request.after !== undefined ? { value: request.after } : {}),
      });
      frames.push(settle(request.after));
      return frames;
    }
    case "group":
      return [
        approach(),
        {
          act: { kind: "group", members: request.members ?? [] },
          hold: 320,
          note: "Grouping objects",
        },
        settle(request.after),
      ];
    case "switchView": {
      const to =
        typeof request.after === "string"
          ? request.after
          : (request.target.scope?.id ?? "");
      if (!to) return null;
      return [
        approach(),
        { act: { kind: "press" }, hold: 120 },
        {
          act: { kind: "switchView", to },
          hold: 280,
          note: `Opening ${request.target.label ?? to}`,
        },
        settle(request.after),
      ];
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

/**
 * Merge independent plans into a single timeline.
 *
 * Plans on non-overlapping targets are allowed to run at the same time, which is
 * what makes a multi-region AI operation feel like one intelligent pass rather
 * than a slow queue. Plans touching the same target are serialised so their
 * provisional values cannot interleave into an invalid state.
 */
export function scheduleConcurrently(
  plans: readonly ChoreographyPlan[],
): Array<{ plan: ChoreographyPlan; startAt: number }> {
  const lastEndByTarget = new Map<string, number>();
  const scheduled: Array<{ plan: ChoreographyPlan; startAt: number }> = [];
  for (const plan of plans) {
    const key = `${plan.target.artifactId}|${plan.target.path}`;
    const startAt = lastEndByTarget.get(key) ?? 0;
    scheduled.push({ plan, startAt });
    lastEndByTarget.set(key, startAt + plan.totalMs);
  }
  return scheduled;
}
