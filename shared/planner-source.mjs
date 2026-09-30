/** Source facts and personal planning share a payload, but have different writers. */
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value : {};
}

function strings(value) {
  return Array.isArray(value) ? value.filter(entry => typeof entry === "string") : [];
}

function date(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

/** The imported legacy root keeps its identity when the editor adds tasks[]. */
export function plannerSourceBinding(value) {
  const content = object(value);
  const source = object(content.source);
  if (source.provider !== "managebac") return undefined;
  const root = Array.isArray(content.tasks)
    ? content.tasks.map(object).find(task => task.id === "task-1") : undefined;
  const reference = typeof content.officialDeadlineRef === "string" && content.officialDeadlineRef
    ? content.officialDeadlineRef
    : strings(content.sourceRefs).find(ref => ref.startsWith("managebac:")) ??
      (typeof source.externalId === "string" && source.externalId ? `managebac:${source.externalId}` : undefined);
  if (!reference) return undefined;
  return {
    taskId: "task-1",
    reference,
    // An explicit null/undefined legacy dueAt means the school withdrew it.
    dueAt: Object.hasOwn(content, "dueAt") ? date(content.dueAt) : date(root?.dueAt),
  };
}

/** Preserve the existing source envelope when a consumer saves normalized content alone. */
export function plannerSourceMetadata(value) {
  const content = object(value);
  if (object(content.source).provider !== "managebac") return {};
  const binding = plannerSourceBinding(content);
  return {
    source: { ...object(content.source) },
    sourceRefs: strings(content.sourceRefs),
    ...(typeof content.taskTitle === "string" ? { taskTitle: content.taskTitle } : {}),
    ...(typeof content.officialDeadlineRef === "string" ? { officialDeadlineRef: content.officialDeadlineRef } : {}),
    // Keep absence explicit: subsequent normalization must not use stale task dates.
    dueAt: binding?.dueAt ?? null,
  };
}

/** Only the represented source root inherits the school's date and reference. */
export function bindPlannerSourceTask(content, task) {
  const binding = plannerSourceBinding(content);
  if (!binding || task.id !== binding.taskId) return task;
  return {
    ...task,
    officialDeadlineRef: binding.reference,
    dueAt: binding.dueAt,
    sourceRefs: [...new Set([...strings(task.sourceRefs), ...strings(object(content).sourceRefs), binding.reference])],
  };
}

/**
 * The caller supplies current authoritative content and the proposed full content
 * before accepting any preview, durable update or checkpoint. This does not grant
 * access: ordinary actor/artifact/run authorization is still required by the caller.
 */
export function assertPlannerSourceEdit(currentValue, proposedValue) {
  const current = object(currentValue);
  const proposed = object(proposedValue);
  const source = object(current.source);
  const binding = plannerSourceBinding(current);
  if (source.provider === "managebac") {
    if (stable(source) !== stable(proposed.source) ||
      stable(strings(current.sourceRefs)) !== stable(strings(proposed.sourceRefs)))
      throw new Error("PLANNER_SOURCE_METADATA_LOCKED");
    const nextBinding = plannerSourceBinding(proposed);
    if (!binding || !nextBinding || nextBinding.reference !== binding.reference)
      throw new Error("PLANNER_SOURCE_METADATA_LOCKED");
    if (nextBinding.dueAt !== binding.dueAt)
      throw new Error("PLANNER_OFFICIAL_DEADLINE_LOCKED");
  }

  const priorTasks = Array.isArray(current.tasks) ? current.tasks.map(object) : [];
  const nextTasks = Array.isArray(proposed.tasks) ? proposed.tasks.map(object) : [];
  const protectedTasks = new Map();
  for (const task of priorTasks) {
    if (typeof task.id === "string" && typeof task.officialDeadlineRef === "string" && task.officialDeadlineRef)
      protectedTasks.set(task.id, { reference: task.officialDeadlineRef, dueAt: date(task.dueAt) });
  }
  if (binding) protectedTasks.set(binding.taskId, binding);
  const protectedReferences = new Set([...protectedTasks.values()].map(entry => entry.reference));
  const seen = new Set();
  for (const task of nextTasks) {
    if (typeof task.id !== "string") continue;
    const prior = protectedTasks.get(task.id);
    if (prior) {
      if (seen.has(task.id) || task.officialDeadlineRef !== prior.reference)
        throw new Error("PLANNER_SOURCE_METADATA_LOCKED");
      if (date(task.dueAt) !== prior.dueAt) throw new Error("PLANNER_OFFICIAL_DEADLINE_LOCKED");
      seen.add(task.id);
    } else if (typeof task.officialDeadlineRef === "string" && protectedReferences.has(task.officialDeadlineRef)) {
      throw new Error("PLANNER_SOURCE_METADATA_LOCKED");
    }
  }
  // Removing a personal task is allowed. It neither deletes the outer source
  // envelope nor the separate official Calendar deadline, and refresh won't add it back.
}

/** Provider refresh uses the previous provider baseline, never a guessed personal baseline. */
export function refreshPlannerSourceContent(value, next, previous) {
  const content = object(value);
  const advance = (personal, old, updated) =>
    old !== undefined && personal === old ? updated : personal;
  const result = {
    ...content,
    taskTitle: advance(content.taskTitle, previous?.title, next.title),
    description: advance(content.description, previous?.description, next.description),
    dueAt: next.dueAt ?? null,
    source: next.source,
  };
  if (!Array.isArray(content.tasks)) return result;
  return {
    ...result,
    tasks: content.tasks.map(candidate => {
      const task = object(candidate);
      if (task.id !== "task-1") return candidate;
      return bindPlannerSourceTask(result, {
        ...task,
        title: advance(task.title, previous?.title, next.title),
        description: advance(task.description, previous?.description, next.description),
      });
    }),
  };
}

/** Same fieldwise merge for direct imports and a reconstructed canonical room. */
export function refreshPlannerSourceProjection(current, input) {
  const content = object(current.content);
  const matchesBaseline = object(content.source).hash === input.previousSourceHash;
  if (!input.force && !matchesBaseline) return null;
  const previous = matchesBaseline ? input.previous : undefined;
  return {
    ...current,
    title: previous?.title !== undefined && current.title === previous.title ? input.next.title : current.title,
    summary: previous?.summary !== undefined && current.summary === previous.summary ? input.next.summary : current.summary,
    content: refreshPlannerSourceContent(content, input.next, previous),
  };
}

/** The historical one-task payload's stable task, used by UI and room bootstrap. */
export function legacyPlannerTask(value) {
  const row = object(value);
  return {
    id: "task-1",
    title: typeof row.taskTitle === "string" && row.taskTitle.trim() ? row.taskTitle.trim() : "First task",
    description: row.description,
    status: row.status,
    estimateMinutes: row.estimateMinutes,
    dueAt: row.dueAt,
    officialDeadlineRef: row.officialDeadlineRef,
    referenceIds: row.linkedArtifactIds,
    sourceRefs: row.sourceRefs,
    reminders: row.reminders ?? [],
    checklist: row.subtasks ?? [],
  };
}
export function defaultPlanViews() {
  return [
    { id: "list", kind: "list", title: "List" },
    { id: "board", kind: "board", title: "Board" },
    { id: "timeline", kind: "timeline", title: "Timeline" },
  ];
}
export function withPlannerCollections(value) {
  const row = object(value);
  return {
    ...row,
    tasks: Array.isArray(row.tasks) ? row.tasks : [legacyPlannerTask(row)],
    sections: Array.isArray(row.sections) ? row.sections : [],
    milestones: Array.isArray(row.milestones) ? row.milestones : [],
    views: Array.isArray(row.views) ? row.views : defaultPlanViews(),
  };
}
