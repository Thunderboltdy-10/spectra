export type ApplicationToolObservation =
  | {
      kind: "library.create_folder";
      name: string;
      nodeId: string;
      parentId: string | null;
      reused: boolean;
    }
  | {
      kind: "library.rename";
      name: string;
      nodeId: string;
    }
  | {
      kind: "library.move";
      count: number;
      destinationId: string;
    }
  | {
      kind: "library.link";
      nodeId: string;
      destinationId: string;
    };

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function committedApplicationObservation(result: unknown) {
  const outer = record(result);
  if (outer?.ok !== true) return null;
  const data = record(outer.data);
  if (data?.ok !== true) return null;
  const observation = record(data.observation);
  if (!observation || typeof observation.kind !== "string") return null;
  return observation as ApplicationToolObservation;
}

export function describeApplicationObservation(
  observation: ApplicationToolObservation,
) {
  if (observation.kind === "library.create_folder")
    return observation.reused
      ? `Folder "${observation.name}" already existed in the requested Library location.`
      : `Created folder "${observation.name}" in the requested Library location.`;
  if (observation.kind === "library.rename")
    return `Renamed the Library item to "${observation.name}".`;
  if (observation.kind === "library.move")
    return `Moved ${observation.count} Library item${observation.count === 1 ? "" : "s"} to the requested folder.`;
  return "Created the requested Library reference.";
}
