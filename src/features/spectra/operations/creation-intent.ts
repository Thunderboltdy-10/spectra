import type { WorkTypeKey } from "../artifacts/types";
import type { SpectraPlan } from "./schema";

export type SpectraCreationIntent = {
  blueprintKey: WorkTypeKey;
  label: string;
};

/** Use the model's typed creation contract, never infer an artifact type from prose. */
export function declaredSingleCreation(
  plan: SpectraPlan,
): SpectraCreationIntent | null {
  const { intent } = plan;
  if (
    plan.decision !== "operate" ||
    (intent.mode !== "create" && intent.mode !== "mixed") ||
    intent.requestedVisibleArtifactCount !== 1 ||
    intent.requestedArtifactTypes.length !== 1
  ) return null;
  const blueprintKey = intent.requestedArtifactTypes[0]!;
  if (blueprintKey === "timetable") return null;
  return { blueprintKey, label: blueprintKey.replaceAll("_", " ") };
}
