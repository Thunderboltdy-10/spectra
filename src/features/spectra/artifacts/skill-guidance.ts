import type { ArtifactSkill } from "./types";

/** Core guidance is stable; specialist bodies are read only when selected. */
export function artifactSkillInstructions(skill: ArtifactSkill, creation = false) {
  return [
    skill.purpose,
    ...(creation ? skill.createWhen : []),
    ...skill.inspect,
    ...skill.operations,
    ...skill.preservationRules,
    ...skill.validation,
    ...skill.connections,
  ];
}

export function artifactSkillPrompt(skill: ArtifactSkill, creation = false) {
  const guides = skill.specialistGuides ?? [];
  return [
    ...artifactSkillInstructions(skill, creation),
    ...(guides.length ? [
      `Optional specialist guides for ${skill.typeKey}: read_artifact_skill with blueprintKey=${skill.typeKey} and the relevant guideId returns its instructions when needed. Do not load unrelated guides.`,
      ...guides.map((guide) => `${guide.id}: ${guide.trigger}`),
    ] : []),
  ].join("\n- ");
}

export function artifactSkillReadResult(skill: ArtifactSkill, guideId?: string) {
  if (guideId) {
    const guide = skill.specialistGuides?.find((entry) => entry.id === guideId);
    if (!guide) return {
      ok: false,
      code: "artifact_skill_guide_not_found",
      retryable: false,
      message: "That specialist guide is not available for this work type.",
      blueprintKey: skill.typeKey,
      guides: (skill.specialistGuides ?? []).map(({ id, trigger }) => ({ id, trigger })),
      suggestedAction: "Omit guideId to read core guidance and the content schema, or select an exact guide id from guides.",
    };
    return { ok: true, blueprintKey: skill.typeKey, guideId: guide.id, trigger: guide.trigger, instructions: guide.instructions };
  }
  return {
    ok: true,
    blueprintKey: skill.typeKey,
    instructions: artifactSkillInstructions(skill, true),
    guides: (skill.specialistGuides ?? []).map(({ id, trigger }) => ({ id, trigger })),
  };
}
