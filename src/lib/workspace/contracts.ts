export const WORKSPACE_ITEM_CATEGORIES = [
  "threads",
  "documents",
  "planner",
  "boards",
  "visualizations",
  "media",
  "references",
  "custom",
] as const;

export type WorkspaceItemCategory = (typeof WORKSPACE_ITEM_CATEGORIES)[number];

export const WORKSPACE_ITEM_TYPES = [
  "thread",
  "artifact",
  "planner",
  "utility",
  "custom",
] as const;

export type WorkspaceItemType = (typeof WORKSPACE_ITEM_TYPES)[number];

export const WORKSPACE_UTILITY_TYPES = [
  "focus_timer",
  "deadline_pulse",
  "workstream_shortcuts",
  "quick_notes",
  "timetable_fragment",
  "breadcrumb",
] as const;

export type WorkspaceUtilityType = (typeof WORKSPACE_UTILITY_TYPES)[number];

export const WORKSPACE_UTILITY_ZONES = [
  "bottom-left",
  "bottom-right",
  "left-edge",
  "right-edge",
  "top-center",
  "top-right",
] as const;

export type WorkspaceUtilityZone = (typeof WORKSPACE_UTILITY_ZONES)[number];

export const DEFAULT_UTILITY_ZONES: Record<WorkspaceUtilityType, WorkspaceUtilityZone> = {
  focus_timer: "bottom-left",
  deadline_pulse: "bottom-right",
  workstream_shortcuts: "left-edge",
  quick_notes: "left-edge",
  timetable_fragment: "right-edge",
  breadcrumb: "top-center",
};
