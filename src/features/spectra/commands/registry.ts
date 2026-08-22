import { Circle } from "lucide-react";
import type { Command, CommandBinding, CommandContext, CommandLayout } from "./types";
import type { WorkType } from "../work/registry";

export const COMMAND_TABS: Record<WorkType, readonly string[]> = {
  document: ["Insert", "Format", "Layout", "References"],
  sheets: ["Insert", "Format", "Data", "Formula", "Review"],
  presentation: ["Insert", "Design", "Arrange", "Animate", "Present"],
  quiz: ["General", "Questions", "Review"],
  flashcard_deck: ["General", "Cards", "Study"],
  planner_task: ["General", "Plan"],
  code: ["General", "Run", "Files"],
  whiteboard: ["General", "Insert", "Arrange"],
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

function inferTab(type: WorkType, binding: CommandBinding) {
  if (binding.contextualTab) return binding.contextualTab;
  if (binding.tab) return COMMAND_TABS[type].includes(binding.tab) ? binding.tab : "General";
  const value = `${binding.id} ${binding.label}`.toLowerCase();
  if (/(insert|add|new|create)/.test(value) && COMMAND_TABS[type].includes("Insert")) return "Insert";
  if (/insert|add|new|image|table|equation|chart|shape/.test(value)) return "Insert";
  if (/format|font|color|bold|italic|align/.test(value)) return "Format";
  if (/sort|filter|freeze|validation|conditional|row|column|data/.test(value) && COMMAND_TABS[type].includes("Data")) return "Data";
  if (/formula|calculate|function|named.?range|sum|average/.test(value) && COMMAND_TABS[type].includes("Formula")) return "Formula";
  if (/review|comment|find|copy|source|spell|track/.test(value) && COMMAND_TABS[type].includes("Review")) return "Review";
  if (/design|theme|background/.test(value) && COMMAND_TABS[type].includes("Design")) return "Design";
  if (/transition|animate|animation/.test(value) && COMMAND_TABS[type].includes("Animate")) return "Animate";
  if (/layout|arrange|order|group|move.*(?:earlier|later|front|back)/.test(value)) {
    if (COMMAND_TABS[type].includes("Arrange")) return "Arrange";
    if (COMMAND_TABS[type].includes("Layout")) return "Layout";
    return type === "planner_task" ? "Plan" : "General";
  }
  if (/run|preview|build|test/.test(value)) return type === "code" ? "Run" : "Evaluate";
  if (/present|play|slideshow/.test(value)) return "Present";
  if (/reference|citation|source/.test(value)) return COMMAND_TABS[type].includes("References") ? "References" : "General";
  return "General";
}

function inferContextualTab(type: WorkType, binding: CommandBinding) {
  if (binding.contextualTab) return binding.contextualTab;
  const value = `${binding.id} ${binding.label}`.toLowerCase();
  if (type !== "document" && /(insert|add|new|create)/.test(value)) return undefined;
  if (type === "document") {
    if (value.includes("equation")) return "Equation";
    if (value.includes("table") && !/(insert|add|new|create)/.test(value)) return "Table";
    if (value.includes("image") && !/(insert|add|new|create)/.test(value)) return "Image";
  }
  if (type === "sheets") {
    if (value.includes("chart") && !/(insert|add|new|create)/.test(value)) return "Chart";
    if (value.includes("formula") && !/(insert|add|new|create)/.test(value)) return "Formula";
  }
  if (type === "presentation") {
    if (value.includes("transition")) return "Transition";
    if (/shape|align|arrange|group/.test(value) && !/(insert|add|new|create)/.test(value)) return "Shape";
  }
  if (type === "whiteboard" && /shape|align|arrange|group|lock/.test(value)) return "Shape";
  if (type === "code" && /preview|output|console|run/.test(value)) return "Code output";
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

export function commandForBinding(type: WorkType, binding: CommandBinding, order: number): Command<void> {
  const id = stableId(type, binding.id);
  const contextualTab = inferContextualTab(type, binding);
  const sourceTab = inferTab(type, binding);
  const inferredGeneral = !binding.tab && !contextualTab && /^(find|undo|redo|outline|save|copy|paste|zoom)/i.test(binding.id);
  const tab = binding.general || inferredGeneral
    ? "General"
    : type === "document"
      ? contextualTab ?? sourceTab
      : sourceTab;
  return {
    id,
    domain: `artifact:${type}`,
    title: binding.label,
    icon: binding.icon ?? Circle,
    description: binding.hint ?? binding.label,
    execute: (_ctx, _params) => binding.onSelect(),
    availability: (ctx) => {
      if (binding.requires && !ctx.can(binding.requires)) return { state: "hidden" };
      if (binding.disabled) return { state: "disabled", reason: binding.hint ?? "Unavailable in the current selection" };
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
      return { state: "enabled" };
    },
    presentation: {
      kind: binding.active === undefined ? "button" : "toggle",
      compact: { iconOnly: !binding.keepLabel },
      medium: { label: binding.label },
      expanded: { label: binding.label, description: binding.hint },
    },
    defaultPlacement: { tab, group: binding.group ?? tab, order },
    sourceTab,
    contextualTab,
    shortcut: inferShortcut(binding),
    risk: binding.priority === "advanced" ? "confirm" : "safe",
    undo: "yjs",
    choreography: { target: "workbar-command", region: id },
  };
}

export function commandContext(
  type: WorkType,
  can: CommandContext["can"],
  role: CommandContext["permissions"]["role"],
  selectionKind?: string,
  native?: Pick<CommandContext, "compatibilityProfile" | "fidelity">,
  executeApplicationCommand?: CommandContext["executeApplicationCommand"],
): CommandContext {
  return {
    workType: type,
    can,
    compatibilityProfile: native?.compatibilityProfile ?? "spectra-native",
    fidelity: native?.fidelity ?? { artifact: "NATIVE" },
    selection: { kind: selectionKind, ids: [] },
    permissions: { role, editable: can("edit") },
    ...(executeApplicationCommand ? { executeApplicationCommand } : {}),
  };
}

export function executeCommand(command: Command<void>, ctx: CommandContext) {
  const availability = command.availability(ctx);
  if (availability.state !== "enabled") return false;
  void command.execute(ctx, undefined);
  return true;
}

export function resolveCommandLayout<P>(command: Command<P>, layout?: CommandLayout) {
  const override = layout?.commands?.[command.id];
  const sourceTab = command.sourceTab ?? command.defaultPlacement.tab;
  return {
    ...command,
    title: override?.label ?? command.title,
    defaultPlacement: {
      ...command.defaultPlacement,
      tab: override?.pinned ? "General" : override?.tab ?? command.defaultPlacement.tab,
      order: override?.order ?? command.defaultPlacement.order,
    },
    presentation: override?.density === "compact"
      ? { ...command.presentation, medium: command.presentation.compact }
      : command.presentation,
    hidden: override?.hidden === true,
    sourceTab,
    customization: override ?? undefined,
  };
}

export function tabsFor(type: WorkType, selectionKind?: string, layout?: CommandLayout) {
  const defaults = COMMAND_TABS[type];
  const ordered = layout?.tabOrder?.filter((tab) => tab === "General" || defaults.includes(tab)) ?? [];
  const baseDefaults = ["General", ...defaults.filter((tab) => tab !== "General")];
  const base = [...ordered, ...baseDefaults.filter((tab) => !ordered.includes(tab))];
  const contextual = contextualByType[type]?.find((tab) => tab.toLowerCase() === selectionKind?.toLowerCase());
  return contextual ? [...base, contextual] : base;
}
