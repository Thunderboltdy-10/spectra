/**
 * Control descriptors: the adapter layer between artifact content shape and the
 * interaction fabric.
 *
 * Each artifact type declares which *control primitive* lives at each content
 * path. Choreography, cursor rendering, caret placement, lock affordances, AI
 * traces and card activity all read this one table, so a new artifact type
 * inherits the entire AI and collaboration experience by adding rules here
 * rather than by building presence UI.
 *
 * The DOM contract is deliberately singular: an editor marks a control with
 * `data-spectra-target="<canonical path>"` (plus `data-spectra-part` for
 * sub-elements such as resize handles). Legacy attributes remain as fallbacks
 * so an editor that has not been annotated yet degrades to a coarser but still
 * *honest* target instead of a wrong one.
 */

import {
  canonicalPath,
  pathSegments,
  type ControlPrimitive,
  type SemanticTarget,
  type TargetScope,
  type TargetScopeKind,
} from "./interaction-model";
import type { ArtifactTypeKey } from "../artifacts/types";

/**
 * A path pattern. `*` matches exactly one segment, `**` matches the remainder.
 * Patterns are matched most-specific-first, measured by segment count and
 * literal-segment count, so `/cards/*​/front` wins over `/cards/*`.
 */
export type ControlRule = {
  pattern: string;
  primitive: ControlPrimitive;
  /** Static label, or one derived from the captured wildcards (1-indexed). */
  label: string | ((captures: string[]) => string);
  /**
   * Which on-screen container must be active for this target to be visible.
   * The captured wildcard index supplies the identifying segment.
   */
  scope?: { kind: TargetScopeKind; capture: number };
  /**
   * Sub-parts this control exposes, e.g. resize handles or a drag grip. Used to
   * validate `target.part` and to know which affordance to draw.
   */
  parts?: readonly string[];
  /**
   * True when the control is addressed by a stable id rather than an array
   * index — lets the geometry layer prefer id lookups, which survive reordering.
   */
  identified?: boolean;
};

const BOX_HANDLES = [
  "handle:nw",
  "handle:n",
  "handle:ne",
  "handle:e",
  "handle:se",
  "handle:s",
  "handle:sw",
  "handle:w",
  "grip",
] as const;

const TIME_HANDLES = ["handle:start", "handle:end", "grip"] as const;

/** Controls shared by every artifact type: the shell fields around the content. */
const COMMON_RULES: readonly ControlRule[] = [
  { pattern: "/title", primitive: "text", label: "Title" },
  { pattern: "/summary", primitive: "richtext", label: "Summary" },
  { pattern: "/tags", primitive: "listItem", label: "Tags" },
  { pattern: "/tags/*", primitive: "text", label: (c) => `Tag ${c[0]}` },
];

const DESCRIPTORS: Record<ArtifactTypeKey, readonly ControlRule[]> = {
  document: [
    { pattern: "/properties", primitive: "listItem", label: "Document properties" },
    { pattern: "/blocks", primitive: "richtext", label: "Body" },
    {
      pattern: "/blocks/*",
      primitive: "richtext",
      label: (c) => `Block ${c[0]}`,
      identified: true,
      parts: ["grip"],
    },
    {
      pattern: "/blocks/*/text",
      primitive: "richtext",
      label: (c) => `Block ${c[0]}`,
      identified: true,
    },
    {
      pattern: "/blocks/*/lines/*",
      primitive: "richtext",
      label: (c) => `Block ${c[0]} line ${c[1]}`,
      identified: true,
    },
    {
      pattern: "/blocks/*/type",
      primitive: "dropdown",
      label: (c) => `Block ${c[0]} style`,
      identified: true,
    },
    {
      pattern: "/blocks/*/cells/**",
      primitive: "gridCell",
      label: (c) => `Table cell in block ${c[0]}`,
      identified: true,
    },
    { pattern: "/outline", primitive: "listItem", label: "Outline" },
    { pattern: "/outline/*", primitive: "listItem", label: (c) => `Outline item ${c[0]}` },
  ],

  flashcard_deck: [
    { pattern: "/cards", primitive: "listItem", label: "Cards" },
    {
      pattern: "/cards/*",
      primitive: "listItem",
      label: (c) => `Card ${c[0]}`,
      identified: true,
      parts: ["grip"],
    },
    { pattern: "/cards/*/front", primitive: "richtext", label: (c) => `Card ${c[0]} front`, identified: true },
    { pattern: "/cards/*/back", primitive: "richtext", label: (c) => `Card ${c[0]} back`, identified: true },
    { pattern: "/cards/*/hint", primitive: "text", label: (c) => `Card ${c[0]} hint`, identified: true },
    { pattern: "/cards/*/variant", primitive: "dropdown", label: (c) => `Card ${c[0]} variant`, identified: true },
    { pattern: "/cards/*/difficulty", primitive: "dropdown", label: (c) => `Card ${c[0]} difficulty`, identified: true },
    { pattern: "/cards/*/confidence", primitive: "dropdown", label: (c) => `Card ${c[0]} confidence`, identified: true },
    { pattern: "/cards/*/language", primitive: "dropdown", label: (c) => `Card ${c[0]} language`, identified: true },
    { pattern: "/cards/*/section", primitive: "dropdown", label: (c) => `Card ${c[0]} section`, identified: true },
    { pattern: "/cards/*/bidirectional", primitive: "toggle", label: (c) => `Card ${c[0]} bidirectional`, identified: true },
    { pattern: "/cards/*/tags/**", primitive: "text", label: (c) => `Card ${c[0]} tags`, identified: true },
    {
      pattern: "/cards/*/occlusions/*",
      primitive: "canvasObject",
      label: (c) => `Card ${c[0]} mask ${c[1]}`,
      identified: true,
      parts: BOX_HANDLES,
    },
    { pattern: "/settings", primitive: "listItem", label: "Deck settings" },
    { pattern: "/settings/revealMode", primitive: "dropdown", label: "Reveal mode" },
    { pattern: "/settings/shuffle", primitive: "toggle", label: "Shuffle" },
    { pattern: "/settings/showHints", primitive: "toggle", label: "Show hints" },
    { pattern: "/settings/*", primitive: "toggle", label: (c) => `Setting ${c[0]}` },
  ],

  quiz: [
    { pattern: "/questions", primitive: "listItem", label: "Questions" },
    {
      pattern: "/questions/*",
      primitive: "listItem",
      label: (c) => `Question ${c[0]}`,
      identified: true,
      parts: ["grip"],
    },
    { pattern: "/questions/*/prompt", primitive: "richtext", label: (c) => `Question ${c[0]} prompt`, identified: true },
    { pattern: "/questions/*/type", primitive: "dropdown", label: (c) => `Question ${c[0]} type`, identified: true },
    { pattern: "/questions/*/difficulty", primitive: "dropdown", label: (c) => `Question ${c[0]} difficulty`, identified: true },
    { pattern: "/questions/*/bloom", primitive: "dropdown", label: (c) => `Question ${c[0]} Bloom level`, identified: true },
    { pattern: "/questions/*/options", primitive: "listItem", label: (c) => `Question ${c[0]} options`, identified: true },
    { pattern: "/questions/*/options/*", primitive: "text", label: (c) => `Question ${c[0]} option ${c[1]}`, identified: true },
    { pattern: "/questions/*/correctAnswer", primitive: "text", label: (c) => `Question ${c[0]} answer`, identified: true },
    { pattern: "/questions/*/correctOptionIds/**", primitive: "toggle", label: (c) => `Question ${c[0]} correct options`, identified: true },
    { pattern: "/questions/*/tolerance", primitive: "text", label: (c) => `Question ${c[0]} tolerance`, identified: true },
    { pattern: "/questions/*/explanation", primitive: "richtext", label: (c) => `Question ${c[0]} explanation`, identified: true },
    { pattern: "/questions/*/points", primitive: "text", label: (c) => `Question ${c[0]} points`, identified: true },
    { pattern: "/questions/*/**", primitive: "text", label: (c) => `Question ${c[0]}`, identified: true },
    { pattern: "/settings", primitive: "listItem", label: "Quiz settings" },
    { pattern: "/settings/*", primitive: "toggle", label: (c) => `Setting ${c[0]}` },
    { pattern: "/published", primitive: "toggle", label: "Published" },
  ],

  planner_task: [
    { pattern: "/taskTitle", primitive: "text", label: "Task title" },
    { pattern: "/description", primitive: "richtext", label: "Description" },
    { pattern: "/status", primitive: "dropdown", label: "Status" },
    { pattern: "/priority", primitive: "dropdown", label: "Priority" },
    { pattern: "/allDay", primitive: "toggle", label: "All day" },
    { pattern: "/startAt", primitive: "text", label: "Start" },
    { pattern: "/endAt", primitive: "text", label: "End" },
    { pattern: "/dueAt", primitive: "text", label: "Due date" },
    { pattern: "/timezone", primitive: "dropdown", label: "Time zone" },
    { pattern: "/estimateMinutes", primitive: "text", label: "Estimate" },
    { pattern: "/progressNote", primitive: "richtext", label: "Progress note" },
    { pattern: "/subtasks", primitive: "listItem", label: "Subtasks" },
    {
      pattern: "/subtasks/*",
      primitive: "listItem",
      label: (c) => `Subtask ${c[0]}`,
      identified: true,
      parts: ["grip"],
    },
    { pattern: "/subtasks/*/title", primitive: "text", label: (c) => `Subtask ${c[0]}`, identified: true },
    { pattern: "/subtasks/*/done", primitive: "toggle", label: (c) => `Subtask ${c[0]} done`, identified: true },
    { pattern: "/reminders/*", primitive: "listItem", label: (c) => `Reminder ${c[0]}`, identified: true },
    { pattern: "/reminders/*/enabled", primitive: "toggle", label: (c) => `Reminder ${c[0]}`, identified: true },
    { pattern: "/reminders/*/**", primitive: "text", label: (c) => `Reminder ${c[0]}`, identified: true },
    { pattern: "/recurrence", primitive: "listItem", label: "Recurrence" },
    { pattern: "/recurrence/frequency", primitive: "dropdown", label: "Repeat" },
    { pattern: "/recurrence/**", primitive: "text", label: "Recurrence" },
    { pattern: "/assignees/**", primitive: "text", label: "Assignees" },
    { pattern: "/linkedArtifactIds/**", primitive: "listItem", label: "Linked work" },
    { pattern: "/sourceRefs/**", primitive: "text", label: "Source references" },
  ],

  agent: [
    { pattern: "/profile", primitive: "listItem", label: "Purpose" },
    { pattern: "/profile/purpose", primitive: "richtext", label: "Primary purpose" },
    { pattern: "/profile/audienceIntent", primitive: "richtext", label: "Audience" },
    { pattern: "/profile/outcomes/*", primitive: "text", label: (c) => `Outcome ${c[0]}` },
    { pattern: "/profile/inScope/*", primitive: "text", label: (c) => `In-scope topic ${c[0]}` },
    { pattern: "/profile/outOfScope/*", primitive: "text", label: (c) => `Out-of-scope topic ${c[0]}` },
    { pattern: "/profile/**", primitive: "text", label: "Profile" },
    { pattern: "/instructions", primitive: "listItem", label: "Instructions" },
    { pattern: "/instructions/text", primitive: "richtext", label: "Instructions" },
    { pattern: "/skills", primitive: "listItem", label: "Capabilities" },
    { pattern: "/skills/*", primitive: "listItem", label: (c) => `Skill ${c[0]}`, identified: true },
    { pattern: "/skills/*/enabled", primitive: "toggle", label: (c) => `Skill ${c[0]}`, identified: true },
    { pattern: "/skills/*/**", primitive: "text", label: (c) => `Skill ${c[0]}`, identified: true },
    { pattern: "/tools/*", primitive: "listItem", label: (c) => `Tool ${c[0]}`, identified: true },
    { pattern: "/tools/*/enabled", primitive: "toggle", label: (c) => `Tool ${c[0]}`, identified: true },
    { pattern: "/tools/*/**", primitive: "text", label: (c) => `Tool ${c[0]}`, identified: true },
    { pattern: "/resources/*", primitive: "listItem", label: (c) => `Resource ${c[0]}`, identified: true },
    { pattern: "/resources/*/**", primitive: "text", label: (c) => `Resource ${c[0]}`, identified: true },
    { pattern: "/routing", primitive: "listItem", label: "Routing" },
    { pattern: "/routing/**", primitive: "richtext", label: "Routing" },
    { pattern: "/behavior", primitive: "listItem", label: "Tone and behaviour" },
    { pattern: "/behavior/clarification", primitive: "toggle", label: "Clarification policy" },
    { pattern: "/behavior/**", primitive: "richtext", label: "Behaviour" },
    { pattern: "/modelPolicy", primitive: "listItem", label: "Model policy" },
    { pattern: "/modelPolicy/*", primitive: "dropdown", label: (c) => `Model ${c[0]}` },
    { pattern: "/evals/*", primitive: "listItem", label: (c) => `Eval ${c[0]}`, identified: true },
    { pattern: "/evals/*/**", primitive: "richtext", label: (c) => `Eval ${c[0]}`, identified: true },
    { pattern: "/releaseNotes", primitive: "richtext", label: "Release notes" },
  ],

  timetable: [
    { pattern: "/timezone", primitive: "dropdown", label: "Time zone" },
    { pattern: "/layers", primitive: "listItem", label: "Calendars" },
    { pattern: "/layers/*", primitive: "listItem", label: (c) => `Calendar ${c[0]}`, identified: true },
    { pattern: "/layers/*/visible", primitive: "toggle", label: (c) => `Calendar ${c[0]} visibility`, identified: true },
    { pattern: "/layers/*/**", primitive: "text", label: (c) => `Calendar ${c[0]}`, identified: true },
    { pattern: "/events", primitive: "listItem", label: "Events" },
    {
      pattern: "/events/*",
      primitive: "timelineEvent",
      label: (c) => `Event ${c[0]}`,
      identified: true,
      parts: TIME_HANDLES,
    },
    { pattern: "/events/*/title", primitive: "text", label: (c) => `Event ${c[0]} title`, identified: true },
    { pattern: "/events/*/location", primitive: "text", label: (c) => `Event ${c[0]} location`, identified: true },
    { pattern: "/events/*/videoUrl", primitive: "text", label: (c) => `Event ${c[0]} link`, identified: true },
    {
      pattern: "/events/*/start",
      primitive: "timelineEvent",
      label: (c) => `Event ${c[0]} start`,
      identified: true,
      parts: TIME_HANDLES,
    },
    {
      pattern: "/events/*/end",
      primitive: "timelineEvent",
      label: (c) => `Event ${c[0]} end`,
      identified: true,
      parts: TIME_HANDLES,
    },
    { pattern: "/events/*/allDay", primitive: "toggle", label: (c) => `Event ${c[0]} all day`, identified: true },
    { pattern: "/events/*/layerId", primitive: "dropdown", label: (c) => `Event ${c[0]} calendar`, identified: true },
    { pattern: "/events/*/recurrence", primitive: "dropdown", label: (c) => `Event ${c[0]} repeat`, identified: true },
    { pattern: "/events/*/availability", primitive: "dropdown", label: (c) => `Event ${c[0]} availability`, identified: true },
    { pattern: "/events/*/notes", primitive: "richtext", label: (c) => `Event ${c[0]} notes`, identified: true },
    { pattern: "/events/*/**", primitive: "text", label: (c) => `Event ${c[0]}`, identified: true },
  ],

  presentation: [
    { pattern: "/theme", primitive: "listItem", label: "Theme" },
    { pattern: "/theme/*", primitive: "dropdown", label: (c) => `Theme ${c[0]}` },
    { pattern: "/slides", primitive: "listItem", label: "Slides" },
    {
      pattern: "/slides/*",
      primitive: "listItem",
      label: (c) => `Slide ${c[0]}`,
      identified: true,
      scope: { kind: "slide", capture: 0 },
      parts: ["grip"],
    },
    {
      pattern: "/slides/*/objects/*",
      primitive: "canvasObject",
      label: (c) => `Slide ${c[0]} object ${c[1]}`,
      identified: true,
      scope: { kind: "slide", capture: 0 },
      parts: BOX_HANDLES,
    },
    {
      pattern: "/slides/*/objects/*/content",
      primitive: "richtext",
      label: (c) => `Slide ${c[0]} text`,
      identified: true,
      scope: { kind: "slide", capture: 0 },
    },
    {
      pattern: "/slides/*/objects/*/style/**",
      primitive: "dropdown",
      label: (c) => `Slide ${c[0]} object style`,
      identified: true,
      scope: { kind: "slide", capture: 0 },
    },
    {
      pattern: "/slides/*/objects/*/**",
      primitive: "canvasObject",
      label: (c) => `Slide ${c[0]} object ${c[1]}`,
      identified: true,
      scope: { kind: "slide", capture: 0 },
      parts: BOX_HANDLES,
    },
    {
      pattern: "/slides/*/speakerNotes",
      primitive: "richtext",
      label: (c) => `Slide ${c[0]} notes`,
      identified: true,
      scope: { kind: "slide", capture: 0 },
    },
    {
      pattern: "/slides/*/transition",
      primitive: "dropdown",
      label: (c) => `Slide ${c[0]} transition`,
      identified: true,
      scope: { kind: "slide", capture: 0 },
    },
    {
      pattern: "/slides/*/**",
      primitive: "listItem",
      label: (c) => `Slide ${c[0]}`,
      identified: true,
      scope: { kind: "slide", capture: 0 },
    },
    { pattern: "/sections/**", primitive: "listItem", label: "Sections" },
    { pattern: "/settings", primitive: "listItem", label: "Presentation settings" },
    { pattern: "/settings/*", primitive: "dropdown", label: (c) => `Setting ${c[0]}` },
  ],

  sheets: [
    { pattern: "/workbook", primitive: "listItem", label: "Workbook" },
    { pattern: "/workbook/calcMode", primitive: "dropdown", label: "Calculation mode" },
    { pattern: "/workbook/locale", primitive: "dropdown", label: "Locale" },
    { pattern: "/workbook/**", primitive: "text", label: "Workbook settings" },
    { pattern: "/activeSheetId", primitive: "viewSwitch", label: "Active sheet" },
    { pattern: "/sheets", primitive: "listItem", label: "Sheets" },
    {
      pattern: "/sheets/*",
      primitive: "viewSwitch",
      label: (c) => `Sheet ${c[0]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
    },
    {
      pattern: "/sheets/*/cells/*",
      primitive: "gridCell",
      label: (c) => `Cell ${c[1]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
    },
    {
      pattern: "/sheets/*/cells/*/formula",
      primitive: "gridCell",
      label: (c) => `Formula in ${c[1]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
    },
    {
      pattern: "/sheets/*/cells/*/value",
      primitive: "gridCell",
      label: (c) => `Value in ${c[1]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
    },
    {
      pattern: "/sheets/*/cells/*/format/**",
      primitive: "dropdown",
      label: (c) => `Format of ${c[1]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
    },
    {
      pattern: "/sheets/*/columns/*",
      primitive: "canvasObject",
      label: (c) => `Column ${c[1]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
      parts: ["handle:e"],
    },
    {
      pattern: "/sheets/*/rows/*",
      primitive: "canvasObject",
      label: (c) => `Row ${c[1]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
      parts: ["handle:s"],
    },
    {
      pattern: "/sheets/*/charts/*",
      primitive: "canvasObject",
      label: (c) => `Chart ${c[1]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
      parts: BOX_HANDLES,
    },
    {
      pattern: "/sheets/*/**",
      primitive: "listItem",
      label: (c) => `Sheet ${c[0]}`,
      identified: true,
      scope: { kind: "sheet", capture: 0 },
    },
  ],

  code: [
    { pattern: "/runtime", primitive: "dropdown", label: "Runtime" },
    { pattern: "/entryFileId", primitive: "dropdown", label: "Entry file" },
    { pattern: "/files", primitive: "listItem", label: "Files" },
    {
      pattern: "/files/*",
      primitive: "listItem",
      label: (c) => `File ${c[0]}`,
      identified: true,
      scope: { kind: "file", capture: 0 },
    },
    {
      pattern: "/files/*/path",
      primitive: "text",
      label: (c) => `File ${c[0]} name`,
      identified: true,
      scope: { kind: "file", capture: 0 },
    },
    {
      pattern: "/files/*/source",
      primitive: "code",
      label: (c) => `File ${c[0]} source`,
      identified: true,
      scope: { kind: "file", capture: 0 },
    },
    {
      pattern: "/files/*/lines/*",
      primitive: "code",
      label: (c) => `File ${c[0]} line ${c[1]}`,
      identified: true,
      scope: { kind: "file", capture: 0 },
    },
    { pattern: "/parameters", primitive: "listItem", label: "Parameters" },
    { pattern: "/parameters/*", primitive: "listItem", label: (c) => `Parameter ${c[0]}`, identified: true },
    { pattern: "/parameters/*/type", primitive: "dropdown", label: (c) => `Parameter ${c[0]} type`, identified: true },
    { pattern: "/parameters/*/value", primitive: "slider", label: (c) => `Parameter ${c[0]} value`, identified: true },
    { pattern: "/parameters/*/**", primitive: "text", label: (c) => `Parameter ${c[0]}`, identified: true },
    { pattern: "/visualisation", primitive: "listItem", label: "Visualisation" },
    { pattern: "/visualisation/**", primitive: "dropdown", label: "Visualisation settings" },
    { pattern: "/tests/*", primitive: "listItem", label: (c) => `Test ${c[0]}`, identified: true },
    { pattern: "/tests/*/**", primitive: "code", label: (c) => `Test ${c[0]}`, identified: true },
    { pattern: "/networkPolicy", primitive: "listItem", label: "Network policy" },
    { pattern: "/networkPolicy/mode", primitive: "dropdown", label: "Network mode" },
    { pattern: "/networkPolicy/**", primitive: "text", label: "Network policy" },
    { pattern: "/assets/**", primitive: "listItem", label: "Assets" },
  ],

  whiteboard: [
    { pattern: "/viewport", primitive: "surface", label: "Canvas" },
    { pattern: "/pages", primitive: "listItem", label: "Pages" },
    {
      pattern: "/pages/*",
      primitive: "viewSwitch",
      label: (c) => `Page ${c[0]}`,
      identified: true,
      scope: { kind: "page", capture: 0 },
    },
    { pattern: "/layers", primitive: "listItem", label: "Layers" },
    { pattern: "/layers/*", primitive: "listItem", label: (c) => `Layer ${c[0]}`, identified: true },
    { pattern: "/layers/*/visible", primitive: "toggle", label: (c) => `Layer ${c[0]} visibility`, identified: true },
    { pattern: "/nodes", primitive: "listItem", label: "Cards" },
    {
      pattern: "/nodes/*",
      primitive: "canvasObject",
      label: (c) => `Card ${c[0]}`,
      identified: true,
      parts: BOX_HANDLES,
    },
    {
      pattern: "/nodes/*/content",
      primitive: "richtext",
      label: (c) => `Card ${c[0]} text`,
      identified: true,
    },
    {
      pattern: "/nodes/*/style/**",
      primitive: "dropdown",
      label: (c) => `Card ${c[0]} style`,
      identified: true,
    },
    {
      pattern: "/nodes/*/**",
      primitive: "canvasObject",
      label: (c) => `Card ${c[0]}`,
      identified: true,
      parts: BOX_HANDLES,
    },
    {
      pattern: "/edges/*",
      primitive: "canvasObject",
      label: (c) => `Connector ${c[0]}`,
      identified: true,
      parts: ["handle:start", "handle:end"],
    },
    { pattern: "/edges/*/**", primitive: "canvasObject", label: (c) => `Connector ${c[0]}`, identified: true },
    { pattern: "/sources/**", primitive: "listItem", label: "Sources" },
    { pattern: "/settings/*", primitive: "dropdown", label: (c) => `Setting ${c[0]}` },
  ],
};

type CompiledRule = ControlRule & {
  segments: string[];
  literalCount: number;
  openEnded: boolean;
};

function compile(rule: ControlRule): CompiledRule {
  const segments = pathSegments(rule.pattern);
  const openEnded = segments[segments.length - 1] === "**";
  const literalCount = segments.filter(
    (segment) => segment !== "*" && segment !== "**",
  ).length;
  return { ...rule, segments, literalCount, openEnded };
}

/**
 * Rules are sorted so the most specific match wins: more literal segments
 * first, then longer patterns, then closed patterns before open-ended ones.
 * This is what makes `/cards/*​/front` beat `/cards/*` deterministically
 * instead of depending on declaration order.
 */
function compileAll(rules: readonly ControlRule[]): CompiledRule[] {
  return rules
    .map(compile)
    .sort(
      (left, right) =>
        right.literalCount - left.literalCount ||
        right.segments.length - left.segments.length ||
        Number(left.openEnded) - Number(right.openEnded),
    );
}

const COMPILED = new Map<ArtifactTypeKey, CompiledRule[]>();

function rulesFor(typeKey: ArtifactTypeKey): CompiledRule[] {
  let compiled = COMPILED.get(typeKey);
  if (!compiled) {
    compiled = compileAll([...(DESCRIPTORS[typeKey] ?? []), ...COMMON_RULES]);
    COMPILED.set(typeKey, compiled);
  }
  return compiled;
}

function matchRule(
  rule: CompiledRule,
  segments: string[],
): string[] | null {
  const captures: string[] = [];
  for (let index = 0; index < rule.segments.length; index += 1) {
    const patternSegment = rule.segments[index]!;
    if (patternSegment === "**") {
      // Consumes the remainder; requires at least one segment to exist.
      return index < segments.length ? captures : null;
    }
    const actual = segments[index];
    if (actual === undefined) return null;
    if (patternSegment === "*") {
      captures.push(actual);
      continue;
    }
    if (patternSegment !== actual) return null;
  }
  return segments.length === rule.segments.length ? captures : null;
}

export type ControlMatch = {
  rule: ControlRule;
  primitive: ControlPrimitive;
  label: string;
  captures: string[];
  scope?: TargetScope;
  parts: readonly string[];
  identified: boolean;
};

/**
 * Resolve which primitive lives at a content path. Returns null when the type
 * declares nothing for that path, which callers must treat as "do not draw a
 * precise affordance" rather than falling back to highlighting the parent.
 */
export function matchControl(
  typeKey: ArtifactTypeKey,
  path: string,
): ControlMatch | null {
  const segments = pathSegments(path);
  if (!segments.length) return null;
  for (const rule of rulesFor(typeKey)) {
    const captures = matchRule(rule, segments);
    if (!captures) continue;
    const label =
      typeof rule.label === "function"
        ? rule.label(captures.map((capture) => humanizeCapture(capture)))
        : rule.label;
    const scopeCapture =
      rule.scope && captures[rule.scope.capture] !== undefined
        ? captures[rule.scope.capture]!
        : undefined;
    return {
      rule,
      primitive: rule.primitive,
      label,
      captures,
      ...(rule.scope && scopeCapture
        ? { scope: { kind: rule.scope.kind, id: scopeCapture } }
        : {}),
      parts: rule.parts ?? [],
      identified: Boolean(rule.identified),
    };
  }
  return null;
}

/**
 * Array indices read as 1-based in labels ("Card 3", not "Card 2"), while
 * id-shaped and A1-shaped captures pass through untouched.
 */
function humanizeCapture(capture: string): string {
  if (/^\d+$/.test(capture)) return String(Number(capture) + 1);
  if (capture.startsWith("id:")) return capture.slice(3);
  return capture;
}

/**
 * Build a semantic target from an artifact type and content path. This is the
 * single constructor used by editors, the AI operation pipeline and the trace
 * store, so a target minted on the server matches one minted in the browser.
 */
export function buildTarget(input: {
  typeKey: ArtifactTypeKey;
  artifactId: string;
  path: string;
  regionId?: string;
  part?: string;
  label?: string;
  scope?: TargetScope;
  /** Override when the editor knows better than the descriptor table. */
  primitive?: ControlPrimitive;
}): SemanticTarget {
  const path = canonicalPath(input.path);
  const match = matchControl(input.typeKey, path);
  const primitive = input.primitive ?? match?.primitive ?? "surface";
  const part =
    input.part && (!match || !match.parts.length || match.parts.includes(input.part))
      ? input.part
      : input.part && match?.parts.length
        ? undefined
        : input.part;
  return {
    artifactId: input.artifactId,
    path,
    primitive,
    ...(input.regionId ? { regionId: input.regionId } : {}),
    ...(part ? { part } : {}),
    ...(input.scope ?? match?.scope ? { scope: input.scope ?? match!.scope! } : {}),
    ...(input.label || match?.label
      ? { label: input.label ?? match!.label }
      : {}),
  };
}

/** Every primitive an artifact type declares, for coverage assertions. */
export function primitivesForType(
  typeKey: ArtifactTypeKey,
): Set<ControlPrimitive> {
  return new Set(rulesFor(typeKey).map((rule) => rule.primitive));
}

export function controlRulesForType(
  typeKey: ArtifactTypeKey,
): readonly ControlRule[] {
  return DESCRIPTORS[typeKey] ?? [];
}

export { DESCRIPTORS as CONTROL_DESCRIPTORS };
