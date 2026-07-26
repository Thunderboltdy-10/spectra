/**
 * Spectra interaction protocol (v2).
 *
 * One vocabulary for every meaningful interaction state, shared verbatim by
 * humans and by owner-attributed AI. Presence publishes *semantics* — which
 * artifact, which control, which character offset, which drop target — never
 * viewport pixels. Each client resolves geometry locally, so a peer on a
 * 420px split pane and a peer on a 2560px full page paint the same truth.
 *
 * Everything downstream (cursors, carets, selections, region locks, AI change
 * traces, artifact-card activity, history entries) addresses the world through
 * `SemanticTarget`. Adding an artifact type means declaring its controls, not
 * writing new presence UI.
 */

/** Control primitives. Choreography is defined per primitive, never per artifact. */
export const CONTROL_PRIMITIVES = [
  /** Single-line value: input, plain field. */
  "text",
  /** Multi-line prose with its own block structure: TipTap, textarea. */
  "richtext",
  /** Source code addressed by line. */
  "code",
  /** Native select / combobox / listbox. */
  "dropdown",
  /** Checkbox, radio, switch, segmented option. */
  "toggle",
  /** Command button that performs an action rather than holding a value. */
  "button",
  /** Continuous numeric control. */
  "slider",
  /** Spreadsheet cell addressed A1-style. */
  "gridCell",
  /** Calendar/timeline event positioned in time. */
  "timelineEvent",
  /** Free-positioned object on a canvas: slide object, whiteboard node/edge. */
  "canvasObject",
  /** Row in an ordered collection: card, question, slide, file, layer. */
  "listItem",
  /** Tab, slide, sheet, file, view, or panel switch. */
  "viewSwitch",
  /** The scrollable body of an editor, used for ambient hover only. */
  "surface",
] as const;

export type ControlPrimitive = (typeof CONTROL_PRIMITIVES)[number];

/** Scopes that change *what is on screen* rather than what is selected. */
export const TARGET_SCOPE_KINDS = [
  "slide",
  "sheet",
  "file",
  "page",
  "tab",
  "panel",
  "view",
] as const;

export type TargetScopeKind = (typeof TARGET_SCOPE_KINDS)[number];

export type TargetScope = {
  kind: TargetScopeKind;
  id: string;
};

/**
 * The single addressing unit of the fabric.
 *
 * `path` is a canonical RFC 6901 pointer into artifact content (never prefixed
 * with `/content`). `regionId` carries the artifact registry's semantic region
 * when one exists, which is what region ownership and history key on. `part`
 * addresses a sub-element of a composite control — a resize handle, a menu
 * option, a specific cell — so a peer can render the *exact* affordance being
 * operated instead of highlighting the whole card.
 */
export type SemanticTarget = {
  artifactId: string;
  path: string;
  primitive: ControlPrimitive;
  regionId?: string;
  part?: string;
  scope?: TargetScope;
  /** Human-readable control name, e.g. "Priority" or "Slide 4 title". */
  label?: string;
};

/** A character position inside a text-bearing target. */
export type TextPoint = {
  /** Character offset within the line when `line` is set, else within the value. */
  offset: number;
  /** Visual/structural line index for multiline targets (list items, code). */
  line?: number;
};

export type TextSpan = {
  anchor: TextPoint;
  head: TextPoint;
};

/**
 * Every meaningful interaction state. Peers render exactly one act at a time,
 * which is what structurally prevents a stale hover pointer from lingering over
 * an old control while the collaborator is typing somewhere else.
 */
export type InteractionAct =
  /** Present but not engaged with any control. */
  | { kind: "idle" }
  /** Pointer resting on a control. `at` is a fraction of the control box. */
  | { kind: "hover"; at?: { x: number; y: number } }
  /** Control has keyboard focus but no caret is placed (buttons, canvas objects). */
  | { kind: "focus" }
  /** Collapsed caret inside a text-bearing target. */
  | { kind: "caret"; point: TextPoint }
  /** Ranged text selection. */
  | { kind: "select"; span: TextSpan }
  /** Actively entering characters at `point`. */
  | { kind: "type"; point: TextPoint }
  /** Adding new content at `point`. */
  | { kind: "insert"; point: TextPoint }
  /** Removing the span (backspace runs, cut, clearing a field). */
  | { kind: "delete"; span: TextSpan }
  /** Swapping the span's content for something new. */
  | { kind: "replace"; span: TextSpan }
  /** Menu/dropdown opened on the target. */
  | { kind: "menuOpen" }
  /** Moving through options; `option` is the highlighted value. */
  | { kind: "menuNavigate"; option: string }
  /** Committing an option. */
  | { kind: "menuSelect"; option: string }
  | { kind: "menuClose" }
  /** Flipping a checkbox/radio/switch/segment to `value`. */
  | { kind: "toggle"; value: string | boolean }
  /** Pressing a command button. */
  | { kind: "press" }
  /** Grabbing an object. */
  | { kind: "dragStart" }
  /** Continuous movement; `at` is a fraction of the *drop container* box. */
  | { kind: "dragMove"; at?: { x: number; y: number } }
  /** Releasing onto the current drop target. */
  | { kind: "dragRelease" }
  /** Grabbing a resize handle; the handle is carried in `target.part`. */
  | { kind: "resizeStart" }
  /** Continuous resize; `size` is the provisional box in target-local units. */
  | { kind: "resizeMove"; size?: { width: number; height: number } }
  | { kind: "resizeRelease" }
  /** Structural collection operations. */
  | { kind: "create" }
  | { kind: "remove" }
  | { kind: "reorder"; from: number; to: number }
  | { kind: "group"; members: string[] }
  /** Changing which slide/sheet/file/tab/view is on screen. */
  | { kind: "switchView"; to: string };

export type InteractionActKind = InteractionAct["kind"];

/**
 * Progress of the work an act belongs to. `active` is the ordinary case; the
 * rest exist so the UI can tell the truth about queueing, contention and
 * failure instead of showing a permanent "working" state.
 */
export const INTERACTION_LIFECYCLES = [
  "idle",
  "waiting",
  "queued",
  "blocked",
  "paused",
  "active",
  "failed",
  "cancelled",
  "completed",
  "settled",
] as const;

export type InteractionLifecycle = (typeof INTERACTION_LIFECYCLES)[number];

/** Lifecycles after which presence must stop claiming to be working. */
export const TERMINAL_LIFECYCLES = new Set<InteractionLifecycle>([
  "failed",
  "cancelled",
  "completed",
  "settled",
]);

export type ActorKind = "human" | "ai";

/**
 * Who is acting. AI actors are always owner-attributed: `ownerName` drives the
 * "{name}'s AI" label and `ownerAccountId` pairs the AI with its owner's colour
 * so the relationship is visible rather than asserted in text.
 */
export type ActorIdentity = {
  clientId: string;
  kind: ActorKind;
  name: string;
  accountId?: string;
  /** Set when `kind === "ai"`. */
  ownerAccountId?: string;
  ownerName?: string;
  runId?: string;
  operationId?: string;
};

/**
 * Remote menus are *observed*, never re-opened locally — a peer's dropdown must
 * never steal the local user's focus or hijack their viewport.
 */
export type MenuObservation = {
  label: string;
  options: Array<{ value: string; label: string }>;
  highlighted?: string;
};

/** A provisional value not yet durable in Yjs. */
export type SpeculativePatch = {
  path: string;
  value: unknown;
};

export type Speculation = {
  /** Monotonic per-actor; peers drop out-of-order frames. */
  sequence: number;
  patches: SpeculativePatch[];
};

/** The complete presence payload published on Yjs awareness. */
export type InteractionState = {
  v: 2;
  actor: ActorIdentity;
  act: InteractionAct;
  lifecycle: InteractionLifecycle;
  target: SemanticTarget | null;
  /** Where a drag would land right now. */
  dropTarget?: SemanticTarget | null;
  menu?: MenuObservation | null;
  speculation?: Speculation | null;
  /** Short human-readable explanation, e.g. "Replacing the summary". */
  note?: string;
  /** Regions this actor currently owns, for lock/queue affordances. */
  heldRegionIds?: string[];
  at: number;
};

/* ------------------------------------------------------------------ *
 * Canonicalisation
 * ------------------------------------------------------------------ */

/**
 * Canonical pointer form: leading slash, no trailing slash, no `/content`
 * prefix, `~0`/`~1` escapes preserved. Every layer compares pointers only
 * after passing through here, which is what keeps a path published by the
 * server matchable against a path emitted by an editor.
 */
export function canonicalPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  let value = String(raw).trim();
  if (!value) return "/";
  if (!value.startsWith("/")) value = `/${value}`;
  if (value === "/content") return "/";
  if (value.startsWith("/content/")) value = value.slice("/content".length);
  while (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
  return value || "/";
}

export function pathSegments(path: string): string[] {
  const canonical = canonicalPath(path);
  if (canonical === "/") return [];
  return canonical
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function joinPath(segments: readonly (string | number)[]): string {
  if (!segments.length) return "/";
  return `/${segments
    .map((segment) =>
      String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
    )
    .join("/")}`;
}

/** True when `path` is `ancestor` or nested inside it. */
export function pathWithin(path: string, ancestor: string): boolean {
  const a = canonicalPath(ancestor);
  const b = canonicalPath(path);
  if (a === "/") return true;
  return b === a || b.startsWith(`${a}/`);
}

/** True when either path contains the other — the correct test for "does this control need chrome". */
export function pathsIntersect(left: string, right: string): boolean {
  return pathWithin(left, right) || pathWithin(right, left);
}

export function targetKey(target: SemanticTarget | null | undefined): string {
  if (!target) return "";
  return [
    target.artifactId,
    canonicalPath(target.path),
    target.part ?? "",
    target.scope ? `${target.scope.kind}:${target.scope.id}` : "",
  ].join("|");
}

export function sameTarget(
  left: SemanticTarget | null | undefined,
  right: SemanticTarget | null | undefined,
): boolean {
  return targetKey(left) === targetKey(right);
}

/* ------------------------------------------------------------------ *
 * Act classification
 * ------------------------------------------------------------------ */

const TEXT_POINT_ACTS = new Set<InteractionActKind>([
  "caret",
  "type",
  "insert",
]);
const TEXT_SPAN_ACTS = new Set<InteractionActKind>([
  "select",
  "delete",
  "replace",
]);
const DRAG_ACTS = new Set<InteractionActKind>([
  "dragStart",
  "dragMove",
  "dragRelease",
]);
const RESIZE_ACTS = new Set<InteractionActKind>([
  "resizeStart",
  "resizeMove",
  "resizeRelease",
]);
const MENU_ACTS = new Set<InteractionActKind>([
  "menuOpen",
  "menuNavigate",
  "menuSelect",
]);

/** Acts that place a caret rather than a pointer. */
export function actUsesCaret(act: InteractionAct): boolean {
  return TEXT_POINT_ACTS.has(act.kind) || TEXT_SPAN_ACTS.has(act.kind);
}

export function actIsDrag(act: InteractionAct): boolean {
  return DRAG_ACTS.has(act.kind);
}

export function actIsResize(act: InteractionAct): boolean {
  return RESIZE_ACTS.has(act.kind);
}

export function actIsMenu(act: InteractionAct): boolean {
  return MENU_ACTS.has(act.kind);
}

/** Acts that mutate content, so peers should show provisional chrome. */
export function actIsMutation(act: InteractionAct): boolean {
  switch (act.kind) {
    case "type":
    case "insert":
    case "delete":
    case "replace":
    case "toggle":
    case "menuSelect":
    case "dragRelease":
    case "resizeRelease":
    case "create":
    case "remove":
    case "reorder":
    case "group":
      return true;
    default:
      return false;
  }
}

/**
 * The pointer glyph a peer should paint. Exactly one of these is true at a
 * time, by construction — a typing collaborator cannot also show a hover arrow.
 */
export type CursorMode =
  | "pointer"
  | "caret"
  | "selection"
  | "grab"
  | "resize"
  | "menu"
  | "press"
  | "hidden";

export function cursorModeForAct(act: InteractionAct): CursorMode {
  switch (act.kind) {
    case "idle":
      return "hidden";
    case "hover":
    case "focus":
    case "switchView":
    case "create":
    case "remove":
    case "reorder":
    case "group":
      return "pointer";
    case "caret":
    case "type":
    case "insert":
      return "caret";
    case "select":
    case "delete":
    case "replace":
      return "selection";
    case "menuOpen":
    case "menuNavigate":
    case "menuSelect":
    case "menuClose":
      return "menu";
    case "toggle":
    case "press":
      return "press";
    case "dragStart":
    case "dragMove":
    case "dragRelease":
      return "grab";
    case "resizeStart":
    case "resizeMove":
    case "resizeRelease":
      return "resize";
    default:
      return "pointer";
  }
}

/** Whether presence should be rendered at all for this state. */
export function stateIsVisible(state: InteractionState): boolean {
  if (state.lifecycle === "idle" && state.act.kind === "idle") return false;
  if (TERMINAL_LIFECYCLES.has(state.lifecycle) && state.act.kind === "idle")
    return false;
  return true;
}

/**
 * Default narration for an act. Used by the collaborator stack, artifact cards,
 * Quick Chat and history so all four describe the same event identically.
 */
export function describeAct(
  act: InteractionAct,
  target: SemanticTarget | null | undefined,
): string {
  const where = target?.label?.trim();
  const suffix = where ? ` ${where}` : "";
  switch (act.kind) {
    case "idle":
      return "Present";
    case "hover":
      return where ? `Near${suffix}` : "Looking around";
    case "focus":
      return where ? `In${suffix}` : "Focused";
    case "caret":
      return where ? `Editing${suffix}` : "Placing a caret";
    case "select":
      return where ? `Selecting in${suffix}` : "Selecting text";
    case "type":
      return where ? `Typing in${suffix}` : "Typing";
    case "insert":
      return where ? `Adding to${suffix}` : "Adding content";
    case "delete":
      return where ? `Clearing${suffix}` : "Deleting";
    case "replace":
      return where ? `Rewriting${suffix}` : "Replacing content";
    case "menuOpen":
      return where ? `Opening${suffix}` : "Opening a menu";
    case "menuNavigate":
      return where ? `Choosing in${suffix}` : "Browsing options";
    case "menuSelect":
      return where ? `Setting${suffix}` : "Choosing an option";
    case "menuClose":
      return where ? `Closed${suffix}` : "Closed the menu";
    case "toggle":
      return where ? `Switching${suffix}` : "Toggling";
    case "press":
      return where ? `Pressing${suffix}` : "Pressing";
    case "dragStart":
      return where ? `Picking up${suffix}` : "Picking up an object";
    case "dragMove":
      return where ? `Moving${suffix}` : "Moving an object";
    case "dragRelease":
      return where ? `Dropping${suffix}` : "Dropping";
    case "resizeStart":
    case "resizeMove":
      return where ? `Resizing${suffix}` : "Resizing";
    case "resizeRelease":
      return where ? `Resized${suffix}` : "Resized";
    case "create":
      return where ? `Creating${suffix}` : "Creating";
    case "remove":
      return where ? `Removing${suffix}` : "Removing";
    case "reorder":
      return where ? `Reordering${suffix}` : "Reordering";
    case "group":
      return "Grouping objects";
    case "switchView":
      return `Moved to ${act.to}`;
    default:
      return "Working";
  }
}

/** Lifecycle narration, which always wins over act narration when non-active. */
export function describeLifecycle(
  lifecycle: InteractionLifecycle,
): string | null {
  switch (lifecycle) {
    case "waiting":
      return "Waiting";
    case "queued":
      return "Queued";
    case "blocked":
      return "Blocked";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Completed";
    case "settled":
      return "Done";
    default:
      return null;
  }
}

export function describeState(state: InteractionState): string {
  if (state.note?.trim()) return state.note.trim();
  const lifecycle = describeLifecycle(state.lifecycle);
  if (lifecycle) return lifecycle;
  return describeAct(state.act, state.target);
}

/** Display name for an actor: humans by name, AI as "{owner}'s AI". */
export function actorLabel(actor: ActorIdentity): string {
  if (actor.kind !== "ai") return actor.name.trim() || "Collaborator";
  const owner = actor.ownerName?.trim();
  if (owner) return `${owner}'s AI`;
  const published = actor.name.trim();
  if (published) return published;
  return "Spectra AI";
}

/* ------------------------------------------------------------------ *
 * Actor colour
 * ------------------------------------------------------------------ */

/**
 * Spectra's presence palette, taken from the reference interfaces. Deliberately
 * excludes the paper and hairline families so a cursor never disappears into
 * the page, and excludes pure red so presence is never mistaken for an error.
 */
export const PRESENCE_PALETTE = [
  "#7c3aed",
  "#159b76",
  "#2e8fd4",
  "#d89a28",
  "#ef684f",
  "#8b5cf6",
  "#0f766e",
  "#c2410c",
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Stable colour for an actor. An AI resolves to its *owner's* colour, so
 * "Nadia" and "Nadia's AI" are visibly the same person's presence rather than
 * two unrelated participants.
 */
export function presenceColor(actor: ActorIdentity): string {
  const seed =
    actor.kind === "ai"
      ? actor.ownerAccountId || actor.ownerName || actor.accountId || actor.clientId
      : actor.accountId || actor.name || actor.clientId;
  return PRESENCE_PALETTE[hashString(seed) % PRESENCE_PALETTE.length]!;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTextPoint(value: unknown): TextPoint | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const offset = finiteNumber(record.offset);
  if (offset === undefined || offset < 0) return null;
  const line = finiteNumber(record.line);
  return {
    offset: Math.floor(offset),
    ...(line !== undefined && line >= 0 ? { line: Math.floor(line) } : {}),
  };
}

function readTextSpan(value: unknown): TextSpan | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const anchor = readTextPoint(record.anchor);
  const head = readTextPoint(record.head);
  if (!anchor || !head) return null;
  return { anchor, head };
}

function readFraction(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  if (x === undefined || y === undefined) return undefined;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

function readScope(value: unknown): TargetScope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const id = record.id;
  if (typeof kind !== "string" || typeof id !== "string" || !id) return undefined;
  if (!(TARGET_SCOPE_KINDS as readonly string[]).includes(kind)) return undefined;
  return { kind: kind as TargetScopeKind, id };
}

export function readSemanticTarget(value: unknown): SemanticTarget | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const artifactId = record.artifactId;
  const primitive = record.primitive;
  if (typeof artifactId !== "string" || !artifactId) return null;
  if (
    typeof primitive !== "string" ||
    !(CONTROL_PRIMITIVES as readonly string[]).includes(primitive)
  )
    return null;
  const scope = readScope(record.scope);
  return {
    artifactId,
    primitive: primitive as ControlPrimitive,
    path: canonicalPath(typeof record.path === "string" ? record.path : "/"),
    ...(typeof record.regionId === "string" && record.regionId
      ? { regionId: record.regionId }
      : {}),
    ...(typeof record.part === "string" && record.part
      ? { part: record.part }
      : {}),
    ...(scope ? { scope } : {}),
    ...(typeof record.label === "string" && record.label
      ? { label: record.label.slice(0, 120) }
      : {}),
  };
}

/**
 * Parse an act defensively. An unreadable act degrades to `focus` rather than
 * throwing, because a malformed frame must never break a peer's editor — but it
 * degrades to something *honest*: "in this control", not a fabricated caret.
 */
export function readInteractionAct(value: unknown): InteractionAct {
  if (!value || typeof value !== "object") return { kind: "idle" };
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string") return { kind: "idle" };
  switch (kind) {
    case "idle":
    case "focus":
    case "menuOpen":
    case "menuClose":
    case "press":
    case "dragStart":
    case "dragRelease":
    case "resizeStart":
    case "resizeRelease":
    case "create":
    case "remove":
      return { kind } as InteractionAct;
    case "hover": {
      const at = readFraction(record.at);
      return at ? { kind: "hover", at } : { kind: "hover" };
    }
    case "dragMove": {
      const at = readFraction(record.at);
      return at ? { kind: "dragMove", at } : { kind: "dragMove" };
    }
    case "caret":
    case "type":
    case "insert": {
      const point = readTextPoint(record.point);
      if (!point) return { kind: "focus" };
      return { kind, point } as InteractionAct;
    }
    case "select":
    case "delete":
    case "replace": {
      const span = readTextSpan(record.span);
      if (!span) return { kind: "focus" };
      return { kind, span } as InteractionAct;
    }
    case "menuNavigate":
    case "menuSelect": {
      const option = record.option;
      if (typeof option !== "string") return { kind: "menuOpen" };
      return { kind, option } as InteractionAct;
    }
    case "toggle": {
      const raw = record.value;
      if (typeof raw === "boolean" || typeof raw === "string")
        return { kind: "toggle", value: raw };
      return { kind: "press" };
    }
    case "resizeMove": {
      const size = record.size;
      if (size && typeof size === "object") {
        const width = finiteNumber((size as Record<string, unknown>).width);
        const height = finiteNumber((size as Record<string, unknown>).height);
        if (width !== undefined && height !== undefined)
          return { kind: "resizeMove", size: { width, height } };
      }
      return { kind: "resizeMove" };
    }
    case "reorder": {
      const from = finiteNumber(record.from);
      const to = finiteNumber(record.to);
      if (from === undefined || to === undefined) return { kind: "focus" };
      return { kind: "reorder", from: Math.floor(from), to: Math.floor(to) };
    }
    case "group": {
      const members = Array.isArray(record.members)
        ? record.members.filter(
            (member): member is string => typeof member === "string",
          )
        : [];
      return { kind: "group", members };
    }
    case "switchView": {
      const to = record.to;
      if (typeof to !== "string") return { kind: "focus" };
      return { kind: "switchView", to };
    }
    default:
      return { kind: "idle" };
  }
}

function readLifecycle(value: unknown): InteractionLifecycle {
  if (
    typeof value === "string" &&
    (INTERACTION_LIFECYCLES as readonly string[]).includes(value)
  )
    return value as InteractionLifecycle;
  return "active";
}

function readActor(value: unknown, fallbackClientId: string): ActorIdentity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const clientId =
    typeof record.clientId === "string" && record.clientId
      ? record.clientId
      : fallbackClientId;
  if (!clientId) return null;
  const kind = record.kind === "ai" ? "ai" : "human";
  return {
    clientId,
    kind,
    name: typeof record.name === "string" ? record.name.slice(0, 120) : "",
    ...(typeof record.accountId === "string" && record.accountId
      ? { accountId: record.accountId }
      : {}),
    ...(typeof record.ownerAccountId === "string" && record.ownerAccountId
      ? { ownerAccountId: record.ownerAccountId }
      : {}),
    ...(typeof record.ownerName === "string" && record.ownerName
      ? { ownerName: record.ownerName.slice(0, 120) }
      : {}),
    ...(typeof record.runId === "string" && record.runId
      ? { runId: record.runId }
      : {}),
    ...(typeof record.operationId === "string" && record.operationId
      ? { operationId: record.operationId }
      : {}),
  };
}

function readMenu(value: unknown): MenuObservation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.options)) return null;
  const options = record.options
    .map((option) => {
      if (!option || typeof option !== "object") return null;
      const entry = option as Record<string, unknown>;
      if (typeof entry.value !== "string") return null;
      return {
        value: entry.value,
        label:
          typeof entry.label === "string" && entry.label
            ? entry.label.slice(0, 80)
            : entry.value.slice(0, 80),
      };
    })
    .filter((option): option is { value: string; label: string } =>
      Boolean(option),
    )
    .slice(0, 24);
  if (!options.length) return null;
  return {
    label:
      typeof record.label === "string" && record.label
        ? record.label.slice(0, 80)
        : "Options",
    options,
    ...(typeof record.highlighted === "string"
      ? { highlighted: record.highlighted }
      : {}),
  };
}

/** Speculative patch payloads are bounded so one actor cannot flood awareness. */
export const MAX_SPECULATIVE_PATCHES = 64;

function readSpeculation(value: unknown): Speculation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sequence = finiteNumber(record.sequence);
  if (sequence === undefined) return null;
  if (!Array.isArray(record.patches)) return null;
  const patches = record.patches
    .map((patch) => {
      if (!patch || typeof patch !== "object") return null;
      const entry = patch as Record<string, unknown>;
      if (typeof entry.path !== "string") return null;
      return { path: canonicalPath(entry.path), value: entry.value };
    })
    .filter((patch): patch is SpeculativePatch => Boolean(patch))
    .slice(0, MAX_SPECULATIVE_PATCHES);
  if (!patches.length) return null;
  return { sequence, patches };
}

/**
 * Parse a remote awareness payload into an `InteractionState`. Returns null for
 * anything that is not a v2 frame so legacy or hostile payloads are ignored
 * rather than half-rendered.
 */
export function readInteractionState(
  value: unknown,
  fallbackClientId = "",
): InteractionState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 2) return null;
  const actor = readActor(record.actor, fallbackClientId);
  if (!actor) return null;
  const act = readInteractionAct(record.act);
  const target = readSemanticTarget(record.target);
  const at = finiteNumber(record.at) ?? Date.now();
  const heldRegionIds = Array.isArray(record.heldRegionIds)
    ? record.heldRegionIds
        .filter((id): id is string => typeof id === "string")
        .slice(0, 64)
    : undefined;
  return {
    v: 2,
    actor,
    act,
    lifecycle: readLifecycle(record.lifecycle),
    target,
    dropTarget: readSemanticTarget(record.dropTarget),
    menu: readMenu(record.menu),
    speculation: readSpeculation(record.speculation),
    ...(typeof record.note === "string" && record.note
      ? { note: record.note.slice(0, 160) }
      : {}),
    ...(heldRegionIds?.length ? { heldRegionIds } : {}),
    at,
  };
}

/**
 * Structural guard against the "stale cursor over the wrong control" class of
 * bug: an act that needs a target cannot be published without one, and text
 * acts cannot be published against a non-text primitive.
 */
export function normalizeInteractionState(
  state: InteractionState,
): InteractionState {
  let act = state.act;
  const target = state.target;

  if (!target && act.kind !== "idle") {
    // Nothing to anchor to. Ambient presence only.
    act = { kind: "idle" };
  }

  if (target && actUsesCaret(act) && !primitiveHoldsText(target.primitive)) {
    // A caret on a dropdown is never true; fall back to focusing the control.
    act = { kind: "focus" };
  }

  if (target && actIsResize(act) && !target.part) {
    // Resizing without a handle cannot be drawn accurately.
    act = act.kind === "resizeRelease" ? { kind: "focus" } : { kind: "dragStart" };
  }

  const lifecycle = state.lifecycle;
  const speculation =
    TERMINAL_LIFECYCLES.has(lifecycle) && lifecycle !== "completed"
      ? null
      : (state.speculation ?? null);

  return {
    ...state,
    act,
    lifecycle,
    speculation,
    menu: actIsMenu(act) || act.kind === "menuClose" ? (state.menu ?? null) : null,
    dropTarget: actIsDrag(act) ? (state.dropTarget ?? null) : null,
  };
}

export function primitiveHoldsText(primitive: ControlPrimitive): boolean {
  return (
    primitive === "text" ||
    primitive === "richtext" ||
    primitive === "code" ||
    primitive === "gridCell"
  );
}

export function idleState(actor: ActorIdentity): InteractionState {
  return {
    v: 2,
    actor,
    act: { kind: "idle" },
    lifecycle: "idle",
    target: null,
    at: Date.now(),
  };
}
