import { Circle } from "lucide-react";
import type { Command, CommandBinding, CommandContext, CommandLayout } from "./types";
import type { WorkType } from "../work/registry";

export const COMMAND_TABS: Record<WorkType, readonly string[]> = {
  document: ["General", "Insert", "Format", "Layout", "References"],
  sheets: ["General", "Insert", "Format", "Data", "Formula", "Review"],
  presentation: ["General", "Insert", "Design", "Arrange", "Animate", "Present"],
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
  if (binding.tab) return binding.tab;
  const value = `${binding.id} ${binding.label}`.toLowerCase();
  if (/insert|add|new|image|table|equation|chart|shape/.test(value)) return "Insert";
  if (/format|font|color|bold|italic|align/.test(value)) return "Format";
  if (/layout|arrange|order|group/.test(value)) return type === "planner_task" ? "Plan" : "Arrange";
  if (/run|preview|build|test/.test(value)) return type === "code" ? "Run" : "Evaluate";
  if (/present|play|slideshow/.test(value)) return "Present";
  if (/reference|citation|source/.test(value)) return "References";
  return "General";
}

function inferContextualTab(type: WorkType, binding: CommandBinding) {
  if (binding.contextualTab) return binding.contextualTab;
  const value = `${binding.id} ${binding.label}`.toLowerCase();
  if (type === "document") {
    if (value.includes("equation")) return "Equation";
    if (value.includes("table")) return "Table";
    if (value.includes("image")) return "Image";
  }
  if (type === "sheets") {
    if (value.includes("chart")) return "Chart";
    if (value.includes("formula")) return "Formula";
  }
  if (type === "presentation") {
    if (value.includes("transition")) return "Transition";
    if (/shape|align|arrange|group/.test(value)) return "Shape";
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
  const tab = contextualTab ?? inferTab(type, binding);
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
): CommandContext {
  return {
    workType: type,
    can,
    compatibilityProfile: native?.compatibilityProfile ?? "spectra-native",
    fidelity: native?.fidelity ?? { artifact: "NATIVE" },
    selection: { kind: selectionKind, ids: [] },
    permissions: { role, editable: can("edit") },
  };
}

export function executeCommand(command: Command<void>, ctx: CommandContext) {
  const availability = command.availability(ctx);
  if (availability.state !== "enabled") return false;
  void command.execute(ctx, undefined);
  return true;
}

export function resolveCommandLayout(command: Command<void>, layout?: CommandLayout) {
  const override = layout?.commands?.[command.id];
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
  };
}

export function tabsFor(type: WorkType, selectionKind?: string, layout?: CommandLayout) {
  const defaults = COMMAND_TABS[type];
  const ordered = layout?.tabOrder?.filter((tab) => defaults.includes(tab)) ?? [];
  const base = [...ordered, ...defaults.filter((tab) => !ordered.includes(tab))];
  const contextual = contextualByType[type]?.find((tab) => tab.toLowerCase() === selectionKind?.toLowerCase());
  return contextual ? [...base, contextual] : base;
}
