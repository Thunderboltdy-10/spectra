import { Circle } from "lucide-react";
import type {
  Command,
  CommandBinding,
  CommandContext,
  CommandLayout,
  CommandParam,
  FidelityClass,
  FidelityRegionKey,
} from "./types";
import type { WorkType } from "../work/registry";

export const COMMAND_TABS: Record<WorkType, readonly string[]> = {
  document: ["Insert", "Format", "Layout", "References"],
  sheets: ["Insert", "Format", "Data", "Formula", "Review"],
  presentation: ["Insert", "Design", "Arrange", "Animate", "Present"],
  quiz: ["General", "Questions", "Review"],
  flashcard_deck: ["General", "Cards", "Study"],
  planner_task: ["General", "Plan"],
  code: ["General", "Run", "Files", "Notebook", "Results"],
  whiteboard: ["General", "Insert", "Arrange", "Facilitate", "Export"],
  agent: ["General", "Configure", "Evaluate", "Release"],
  timetable: ["General", "Schedule"],
};

const contextualByType: Partial<Record<WorkType, readonly string[]>> = {
  document: ["Equation", "Table", "Image"],
  sheets: ["Chart", "Formula"],
  presentation: ["Shape", "Transition"],
  whiteboard: ["Shape"],
  code: ["Code output"],
};

/** The contextual tabs a type may raise. A studio may only emit these. */
export function contextualTabsFor(type: WorkType): readonly string[] {
  return contextualByType[type] ?? [];
}

/**
 * Every tab a type can show, General first, contextual tabs last. A contextual
 * tab that is *also* a permanent tab is not listed twice: Sheets keeps Formula
 * on screen always and additionally raises it on a formula selection, and one
 * tab appearing twice in the strip is a rendering bug, not two tabs.
 */
export function allTabsFor(type: WorkType): readonly string[] {
  const base = [
    "General",
    ...COMMAND_TABS[type].filter((tab) => tab !== "General"),
  ];
  return [
    ...base,
    ...contextualTabsFor(type).filter((tab) => !base.includes(tab)),
  ];
}

function inferTab(type: WorkType, binding: CommandBinding) {
  if (binding.contextualTab) return binding.contextualTab;
  if (binding.tab)
    return COMMAND_TABS[type].includes(binding.tab) ? binding.tab : "General";
  const value = `${binding.id} ${binding.label}`.toLowerCase();
  if (
    /(insert|add|new|create)/.test(value) &&
    COMMAND_TABS[type].includes("Insert")
  )
    return "Insert";
  if (/insert|add|new|image|table|equation|chart|shape/.test(value))
    return "Insert";
  if (/format|font|color|bold|italic|align/.test(value)) return "Format";
  if (
    /sort|filter|freeze|validation|conditional|row|column|data/.test(value) &&
    COMMAND_TABS[type].includes("Data")
  )
    return "Data";
  if (
    /formula|calculate|function|named.?range|sum|average/.test(value) &&
    COMMAND_TABS[type].includes("Formula")
  )
    return "Formula";
  if (
    /review|comment|find|copy|source|spell|track/.test(value) &&
    COMMAND_TABS[type].includes("Review")
  )
    return "Review";
  if (
    /design|theme|background/.test(value) &&
    COMMAND_TABS[type].includes("Design")
  )
    return "Design";
  if (
    /transition|animate|animation/.test(value) &&
    COMMAND_TABS[type].includes("Animate")
  )
    return "Animate";
  if (
    /layout|arrange|order|group|move.*(?:earlier|later|front|back)/.test(value)
  ) {
    if (COMMAND_TABS[type].includes("Arrange")) return "Arrange";
    if (COMMAND_TABS[type].includes("Layout")) return "Layout";
    return type === "planner_task" ? "Plan" : "General";
  }
  if (/run|preview|build|test/.test(value))
    return type === "code" ? "Run" : "Evaluate";
  if (/present|play|slideshow/.test(value)) return "Present";
  if (/reference|citation|source/.test(value))
    return COMMAND_TABS[type].includes("References") ? "References" : "General";
  return "General";
}

function inferContextualTab(type: WorkType, binding: CommandBinding) {
  if (binding.contextualTab) return binding.contextualTab;
  // An explicit `tab` is a decision the author made; inference is only a
  // fallback for bindings that made none. Without this, a name matching one of
  // the patterns below silently overrides it and the command becomes reachable
  // only with a selection — which is how "Show grid" ended up on the Shape tab.
  if (binding.tab && COMMAND_TABS[type].includes(binding.tab)) return undefined;
  const value = `${binding.id} ${binding.label}`.toLowerCase();
  if (type !== "document" && /(insert|add|new|create)/.test(value))
    return undefined;
  if (type === "document") {
    if (value.includes("equation")) return "Equation";
    if (value.includes("table") && !/(insert|add|new|create)/.test(value))
      return "Table";
    if (value.includes("image") && !/(insert|add|new|create)/.test(value))
      return "Image";
  }
  if (type === "sheets") {
    if (value.includes("chart") && !/(insert|add|new|create)/.test(value))
      return "Chart";
    if (value.includes("formula") && !/(insert|add|new|create)/.test(value))
      return "Formula";
  }
  if (type === "presentation") {
    if (value.includes("transition")) return "Transition";
    if (
      /shape|align|arrange|group/.test(value) &&
      !/(insert|add|new|create)/.test(value)
    )
      return "Shape";
  }
  if (type === "whiteboard" && /shape|align|arrange|group|lock/.test(value))
    return "Shape";
  if (type === "code" && /preview|output|console|run/.test(value))
    return "Code output";
  return undefined;
}

function stableId(type: WorkType, id: string) {
  return id.startsWith(`${type}.`)
    ? id
    : `${type}.${id.replaceAll(/[^a-zA-Z0-9]+/g, ".")}`;
}

function inferShortcut(binding: CommandBinding) {
  if (binding.shortcut) return binding.shortcut;
  const value = `${binding.id} ${binding.label}`.toLowerCase();
  if (/^find$|\bfind\b/.test(value)) return "Mod+F";
  if (/\bundo\b/.test(value)) return "Mod+Z";
  if (/\bredo\b/.test(value)) return "Mod+Shift+Z";
  if (/\bsave\b/.test(value)) return "Mod+S";
  return undefined;
}

/** Human wording for a region, used in honest disabled reasons. */
const REGION_LABELS: Partial<Record<FidelityRegionKey, string>> = {
  body: "body text",
  styles: "styles",
  lists: "list numbering",
  tables: "tables",
  tableStructure: "table structure",
  images: "images",
  equations: "equations",
  headersFooters: "headers and footers",
  footnotes: "footnotes",
  hyperlinks: "hyperlinks",
  fields: "fields",
  trackedChanges: "tracked changes",
  sections: "section layout",
  comments: "comments",
  macros: "macros",
  customXml: "custom XML",
  smartArt: "SmartArt",
  ole: "embedded objects",
  cells: "cell values",
  formulas: "formulas",
  numberFormats: "number formats",
  merges: "merged cells",
  freezePanes: "frozen panes",
  sheetStructure: "worksheet structure",
  dimensions: "row and column dimensions",
  sheetViews: "worksheet view settings",
  sheetMetadata: "worksheet metadata",
  calculationSettings: "calculation settings",
  sortFilter: "filter settings",
  charts: "charts",
  pivotTables: "pivot tables",
  validation: "data validation",
  conditionalFormat: "conditional formatting",
  namedRanges: "named ranges",
  slides: "slides",
  masters: "slide masters",
  layouts: "slide layouts",
  transitions: "transitions",
  animations: "animation timing",
  media: "media",
  speakerNotes: "speaker notes",
  shapes: "shapes",
};

export function regionLabel(region: FidelityRegionKey) {
  return REGION_LABELS[region] ?? region;
}

/**
 * The refusal sentence, written once. The workbar, the keyboard shortcut and the
 * assistant all say exactly this, because C2 is not "both refuse" — it is "both
 * refuse for the same stated reason". If a person is told Spectra preserves
 * their footnotes, the assistant must not then offer to rewrite them.
 */
export function preservedRegionRefusal(region: FidelityRegionKey) {
  return `Spectra preserves ${regionLabel(region)} in this file but cannot edit it yet, so this stays unavailable while the original is linked.`;
}

/**
 * A command that writes a region the linked file only *preserves* has to say
 * so rather than pretend. This is the one place that decision is made, so the
 * bar, the shortcut and the AI offer are refused identically (C2).
 */
export function regionBlockedBy(
  fidelity: Readonly<Record<string, FidelityClass>>,
  touches: readonly FidelityRegionKey[] | undefined,
): { region: FidelityRegionKey; state: FidelityClass } | undefined {
  if (!touches?.length) return undefined;
  for (const region of touches) {
    const state = fidelity[region];
    if (state === "PRESERVED") return { region, state };
  }
  return undefined;
}

export function commandForBinding(
  type: WorkType,
  binding: CommandBinding,
  order: number,
): Command<CommandParam> {
  const id = stableId(type, binding.id);
  const contextualTab = inferContextualTab(type, binding);
  const sourceTab = inferTab(type, binding);
  const inferredGeneral =
    !binding.tab &&
    !contextualTab &&
    /^(find|undo|redo|outline|save|copy|paste|zoom)/i.test(binding.id);
  const tab =
    binding.general || inferredGeneral
      ? "General"
      : type === "document"
        ? (contextualTab ?? sourceTab)
        : sourceTab;
  return {
    id,
    ...(binding.capabilityId ? { capabilityId: binding.capabilityId } : {}),
    domain: `artifact:${type}`,
    title: binding.label,
    icon: binding.icon ?? Circle,
    description: binding.hint ?? binding.label,
    ...(binding.params ? { params: binding.params } : {}),
    execute: (_ctx, params) => binding.onSelect(params),
    availability: (ctx) => {
      if (binding.requires && !ctx.can(binding.requires))
        return { state: "hidden" };
      if (binding.disabled)
        return {
          state: "disabled",
          reason: binding.hint ?? "Unavailable in the current selection",
        };
      if (binding.availability) return binding.availability(ctx);
      if (
        ctx.compatibilityProfile === "strict-native" &&
        binding.strictNative?.available === false
      ) {
        return {
          state: "disabled",
          reason:
            binding.strictNative.reason ??
            "This change cannot be written safely to the linked native file.",
        };
      }
      if (ctx.compatibilityProfile === "strict-native") {
        const blocked = regionBlockedBy(ctx.fidelity, binding.touches);
        if (blocked) {
          return {
            state: "disabled",
            reason: preservedRegionRefusal(blocked.region),
          };
        }
      }
      return { state: "enabled" };
    },
    presentation: {
      kind:
        binding.control?.kind ??
        (binding.active === undefined ? "button" : "toggle"),
      ...(binding.control ? { control: binding.control } : {}),
      compact: { iconOnly: !binding.keepLabel },
      medium: { label: binding.label },
      expanded: { label: binding.label, description: binding.hint },
    },
    defaultPlacement: { tab, group: binding.group ?? tab, order },
    priority: binding.priority ?? "secondary",
    sourceTab,
    contextualTab,
    shortcut: inferShortcut(binding),
    risk:
      binding.risk ?? (binding.priority === "advanced" ? "confirm" : "safe"),
    undo: binding.undo ?? "yjs",
    ...(binding.touches ? { touches: binding.touches } : {}),
    ...(binding.nativeDelta ? { nativeDelta: binding.nativeDelta } : {}),
    ...(binding.manifestOps ? { manifestOps: binding.manifestOps } : {}),
    ...(binding.exportBoundary
      ? { exportBoundary: binding.exportBoundary }
      : {}),
    choreography: binding.choreography ?? {
      target: binding.control ? "workbar-field" : "workbar-command",
      region: id,
    },
    ...(binding.ai
      ? {
          aiAuthority: binding.ai.exposed ? "allowed" : "prohibited",
          ...(!binding.ai.exposed
            ? { prohibitionReason: binding.ai.description }
            : {}),
        }
      : {}),
  };
}

export function commandContext(
  type: WorkType,
  can: CommandContext["can"],
  role: CommandContext["permissions"]["role"],
  selectionKind?: string,
  native?: Pick<CommandContext, "compatibilityProfile" | "fidelity"> &
    Partial<Pick<CommandContext, "artifactId" | "nativeFormat">>,
  executeApplicationCommand?: CommandContext["executeApplicationCommand"],
  selection?: Pick<CommandContext["selection"], "ids" | "label">,
): CommandContext {
  return {
    workType: type,
    can,
    compatibilityProfile: native?.compatibilityProfile ?? "spectra-native",
    fidelity: native?.fidelity ?? { artifact: "NATIVE" },
    ...(native?.artifactId ? { artifactId: native.artifactId } : {}),
    ...(native?.nativeFormat !== undefined
      ? { nativeFormat: native.nativeFormat }
      : {}),
    selection: {
      kind: selectionKind,
      ids: selection?.ids ?? [],
      ...(selection?.label ? { label: selection.label } : {}),
    },
    permissions: { role, editable: can("edit") },
    ...(executeApplicationCommand ? { executeApplicationCommand } : {}),
  };
}

export function executeCommand<P extends CommandParam>(
  command: Command<P>,
  ctx: CommandContext,
  params?: P,
) {
  const availability = command.availability(ctx);
  if (availability.state !== "enabled") return false;
  void command.execute(ctx, params as P);
  return true;
}

export function swapWorkbarCommandOrders(
  layout: CommandLayout | undefined,
  swap: {
    sourceId: string;
    targetId: string;
    sourceOrder: number;
    targetOrder: number;
    tab: string;
  },
): CommandLayout {
  return {
    ...layout,
    commands: {
      ...layout?.commands,
      [swap.sourceId]: {
        ...layout?.commands?.[swap.sourceId],
        order: swap.targetOrder,
        tab: swap.tab,
      },
      [swap.targetId]: {
        ...layout?.commands?.[swap.targetId],
        order: swap.sourceOrder,
      },
    },
  };
}

export function resolveCommandLayout<P>(
  command: Command<P>,
  layout?: CommandLayout,
) {
  const override = layout?.commands?.[command.id];
  const sourceTab = command.sourceTab ?? command.defaultPlacement.tab;
  return {
    ...command,
    title: override?.label ?? command.title,
    defaultPlacement: {
      ...command.defaultPlacement,
      tab: override?.pinned
        ? "General"
        : (override?.tab ?? command.defaultPlacement.tab),
      order: override?.order ?? command.defaultPlacement.order,
    },
    presentation:
      override?.density === "compact"
        ? { ...command.presentation, medium: command.presentation.compact }
        : command.presentation,
    hidden: override?.hidden === true,
    sourceTab,
    customization: override ?? undefined,
  };
}

export function tabsFor(
  type: WorkType,
  selectionKind?: string,
  layout?: CommandLayout,
) {
  const defaults = COMMAND_TABS[type];
  const ordered =
    layout?.tabOrder?.filter(
      (tab) => tab === "General" || defaults.includes(tab),
    ) ?? [];
  const baseDefaults = [
    "General",
    ...defaults.filter((tab) => tab !== "General"),
  ];
  const base = [
    ...ordered,
    ...baseDefaults.filter((tab) => !ordered.includes(tab)),
  ];
  const contextual = contextualByType[type]?.find(
    (tab) => tab.toLowerCase() === selectionKind?.toLowerCase(),
  );
  // A contextual tab that is already permanent stays where it is. Appending it
  // would render the same tab twice, and clicking the second one would look
  // like it did nothing.
  return contextual && !base.includes(contextual)
    ? [...base, contextual]
    : base;
}
