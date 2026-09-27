import type { ModelOperation } from "./schema";

const artifactIdFields = new Set([
  "artifactId", "planArtifactId", "sourceArtifactId", "targetArtifactId",
  "hostWorkId", "targetWorkId", "workId",
]);
const artifactIdLists = new Set(["artifactIds", "linkedArtifactIds", "workIds"]);

/** Only identity fields are dependencies. Authored text may literally contain
 * @created:N, so traversing/replacing every string corrupts user content. */
export function mapOperationArtifactReferences(
  operation: ModelOperation,
  map: (id: string) => string,
): ModelOperation {
  const visitArguments = (value: unknown, field = ""): unknown => {
    if (typeof value === "string") return artifactIdFields.has(field) ? map(value) : value;
    if (Array.isArray(value)) {
      if (artifactIdLists.has(field))
        return value.map((id) => typeof id === "string" ? map(id) : id);
      return value.map((child) => visitArguments(child));
    }
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visitArguments(child, key)]));
    return value;
  };
  if (operation.type === "app.command")
    return { ...operation, input: { ...operation.input, args: {
      ...visitArguments(operation.input.args) as Record<string, unknown>,
      // These generic ids identify artifacts only for these typed commands.
      ...(operation.input.command === "navigate_spectra" && operation.input.args.destination === "artifact" && typeof operation.input.args.targetId === "string"
        ? { targetId: map(operation.input.args.targetId) } : {}),
      ...(operation.input.command === "change_sharing" && operation.input.args.resourceType === "artifact" && typeof operation.input.args.resourceId === "string"
        ? { resourceId: map(operation.input.args.resourceId) } : {}),
    } } };
  if (operation.type === "artifact.link")
    return { ...operation, input: { ...operation.input, sourceArtifactId: map(operation.input.sourceArtifactId), targetArtifactId: map(operation.input.targetArtifactId) } };
  if (operation.type === "artifact.update" && operation.input.blueprintKey === "planner_task")
    return { ...operation, input: { ...operation.input,
      artifactId: map(operation.input.artifactId),
      content: visitArguments(operation.input.content) as typeof operation.input.content,
      ...(operation.input.contentPatch ? { contentPatch: { changes: operation.input.contentPatch.changes.map((change) => ({
        ...change,
        value: /^\/(?:content\/)?linkedArtifactIds$/.test(change.path)
          ? visitArguments(change.value, "linkedArtifactIds")
          : /^\/(?:content\/)?linkedArtifactIds\/(?:\d+|-)$/.test(change.path) && typeof change.value === "string"
            ? map(change.value) : change.value,
      })) } } : {}),
    } } as ModelOperation;
  if (operation.type === "artifact.update" || operation.type === "artifact.archive" || operation.type === "workspaceItem.add")
    return { ...operation, input: { ...operation.input, artifactId: map(operation.input.artifactId) } } as ModelOperation;
  if (operation.type === "artifact.create" && operation.input.blueprintKey === "planner_task")
    return { ...operation, input: { ...operation.input, content: { ...operation.input.content, linkedArtifactIds: operation.input.content.linkedArtifactIds?.map(map) } } };
  return operation;
}

export function createdDependencyIndex(id: string) {
  const match = /^@created:(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

export function validateOperationDependencies(operations: ModelOperation[]) {
  for (const [consumerIndex, operation] of operations.entries()) {
    mapOperationArtifactReferences(operation, (id) => {
      const producerIndex = createdDependencyIndex(id);
      if (producerIndex !== null && (
        producerIndex >= consumerIndex || operations[producerIndex]?.type !== "artifact.create"
      )) throw new Error(`Invalid dependency ${id}: it must identify a prior artifact.create operation.`);
      return id;
    });
  }
}

/** A terminal plan can repeat the complete staged prefix or append remaining
 * operations. Arbitrary deduplication would change every later dependency. */
export function mergeStagedOperations(staged: ModelOperation[], terminal: ModelOperation[]) {
  if (!staged.length) return terminal;
  const fingerprint = (operation: ModelOperation) => JSON.stringify(operation);
  const signatures = staged.map(fingerprint);
  if (terminal.length >= staged.length && staged.every((_, index) => signatures[index] === fingerprint(terminal[index]!)))
    return terminal;
  if (terminal.some((operation) => signatures.includes(fingerprint(operation))))
    throw new Error("The final plan repeats only part of the staged operations. Include the complete staged prefix in order, or only the remaining operations using their final operation indexes.");
  return [...staged, ...terminal];
}

export type StagedDisposition = "accepted" | "needs_revalidation" | "withdrawn";

/** A staged graph that cannot become an executable plan yet. The model can
 * correct it with the same tools; nothing has been executed. */
export class StagedGraphError extends Error {}

/** Staged positions that declare a dependency on the given producer. */
export function stagedDependents(operations: readonly ModelOperation[], producerIndex: number) {
  return operations.flatMap((operation, index) => {
    let depends = false;
    mapOperationArtifactReferences(operation, (id) => {
      if (createdDependencyIndex(id) === producerIndex) depends = true;
      return id;
    });
    return depends ? [index] : [];
  });
}

/** The executable form of a staged sequence whose indexes stayed stable while
 * it was revised. Withdrawn positions are removed and declared dependencies
 * renumbered; authored text that mentions @created:N is never rewritten. A
 * candidate prepared against since-changed sources cannot enter the plan. */
export function compileStagedOperations(
  operations: readonly ModelOperation[],
  disposition: (index: number) => StagedDisposition,
) {
  const pending = operations.flatMap((_, index) => disposition(index) === "needs_revalidation" ? [index] : []);
  if (pending.length)
    throw new StagedGraphError(`Staged operation indexes ${pending.join(", ")} were prepared before their source changed and are not accepted. Read the current targets, then replace each one with revise_staged_operation or withdraw it before finishing.`);
  const kept = operations.flatMap((_, index) => disposition(index) === "withdrawn" ? [] : [index]);
  if (kept.length === operations.length) return [...operations];
  const nextIndex = new Map(kept.map((previous, index) => [previous, index]));
  const compiled = kept.map((previous) => mapOperationArtifactReferences(operations[previous]!, (id) => {
    const producer = createdDependencyIndex(id);
    if (producer === null) return id;
    const remapped = nextIndex.get(producer);
    if (remapped === undefined)
      throw new StagedGraphError(`Staged operation ${previous} depends on withdrawn operation @created:${producer}. Replace or withdraw it before finishing.`);
    return `@created:${remapped}`;
  }));
  validateOperationDependencies(compiled);
  return compiled;
}
