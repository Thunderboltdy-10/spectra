export type PlannerSourceBinding = {
  taskId: "task-1";
  reference: string;
  dueAt?: number;
};
export type PlannerSourceMetadata = {
  source?: Record<string, unknown>;
  sourceRefs?: string[];
  taskTitle?: string;
  officialDeadlineRef?: string;
  dueAt?: number | null;
};
export type PlannerSourceText = { title: string; description: string };
export function plannerSourceBinding(value: unknown): PlannerSourceBinding | undefined;
export function plannerSourceMetadata(value: unknown): PlannerSourceMetadata;
export function bindPlannerSourceTask(content: unknown, task: Record<string, unknown>): Record<string, unknown>;
export function assertPlannerSourceEdit(currentContent: unknown, proposedContent: unknown): void;
export function refreshPlannerSourceContent(
  value: unknown,
  next: PlannerSourceText & { dueAt?: number; source: Record<string, unknown> },
  previous?: PlannerSourceText,
): Record<string, unknown>;
