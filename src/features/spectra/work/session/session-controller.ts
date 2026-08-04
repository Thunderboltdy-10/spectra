import {
  spectraObjectKey,
  type SpectraOpenObject,
} from "@/stores/spectra-context-store";

export type WorkSessionMode = "closed" | "split" | "tab";

export type WorkSessionProjection<TWork extends { _id: string }> = {
  mode: WorkSessionMode;
  activeWorkId: string | null;
  activeWork: TWork | null;
  openWork: SpectraOpenObject[];
  tabs: Array<{ workId: string; openedAt: number }>;
  dirtyIds: Set<string>;
};

export function projectLegacyWorkSession<TWork extends { _id: string }>(
  works: ReadonlyMap<string, TWork>,
  openObjects: readonly SpectraOpenObject[],
  activeOpenObjectKey: string | null,
  dirtyWorkIds: readonly string[],
): WorkSessionProjection<TWork> {
  const openWork = openObjects.filter(
    (object) =>
      object.type === "artifact" &&
      (object.presentation === "split" || object.presentation === "tab") &&
      works.has(object.id),
  );
  const activeObject =
    openWork.find(
      (object) => spectraObjectKey(object) === activeOpenObjectKey,
    ) ?? null;
  const mode: WorkSessionMode =
    activeObject?.presentation === "split" ||
    activeObject?.presentation === "tab"
      ? activeObject.presentation
      : "closed";
  const activeWorkId = activeObject?.id ?? null;
  return {
    mode,
    activeWorkId,
    activeWork: activeWorkId ? (works.get(activeWorkId) ?? null) : null,
    openWork,
    tabs: openWork
      .filter((object) => object.presentation === "tab")
      .map((object, openedAt) => ({ workId: object.id, openedAt })),
    dirtyIds: new Set(dirtyWorkIds.filter((id) => works.has(id))),
  };
}

export type WorkDurabilityState = {
  local: "clean" | "pending";
  live: "offline" | "connecting" | "synchronized";
  durable: "current" | "projecting" | "delayed";
};

export function editingRemainsAvailable(state: WorkDurabilityState) {
  return state.local === "clean" || state.local === "pending";
}
