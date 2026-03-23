import type { StudyMode } from "@/types";
import { resolveSkillsForContext, type RegisteredSkill } from "@/lib/skills/skill-registry";

export type RuntimeSkill = {
  id: string;
  name: string;
  summary: string;
  guidance: string[];
  category?: string;
  sourcePath?: string;
  appliesToModes?: StudyMode[];
  trigger?: RegExp;
};

function toRuntimeSkill(skill: RegisteredSkill): RuntimeSkill {
  return {
    id: skill.id,
    name: skill.name,
    summary: skill.summary,
    guidance: skill.guidance,
    category: skill.category,
    sourcePath: skill.sourcePath,
    appliesToModes: skill.appliesToModes,
    trigger: skill.trigger,
  };
}

export function selectRuntimeSkills(params: {
  message: string;
  mode: StudyMode;
  allowedToolBundles?: string[];
  maxSkills?: number;
}): RuntimeSkill[] {
  return resolveSkillsForContext({
    message: params.message,
    mode: params.mode,
    allowedToolBundles: params.allowedToolBundles,
    maxSkills: params.maxSkills,
  }).map(toRuntimeSkill);
}

export function formatRuntimeSkillBlock(skills: RuntimeSkill[]) {
  if (skills.length === 0) return "";
  return [
    "=== ACTIVE RUNTIME SKILLS ===",
    ...skills.map((skill, index) => {
      const lines = [
        `${index + 1}. ${skill.name} (${skill.id})`,
        `Category: ${skill.category ?? "general"}`,
        `Summary: ${skill.summary}`,
      ];
      for (const item of skill.guidance) {
        lines.push(`- ${item}`);
      }
      if (skill.sourcePath) {
        lines.push(`Source: ${skill.sourcePath}`);
      }
      return lines.join("\n");
    }),
    "=== END ACTIVE RUNTIME SKILLS ===",
  ].join("\n");
}
