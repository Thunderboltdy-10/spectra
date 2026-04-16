import type { StudyMode } from "@/types";
import { listRegisteredSkills, resolveSkillsForContext, type RegisteredSkill } from "@/lib/skills/skill-registry";

export type RuntimeSkill = {
  id: string;
  name: string;
  summary: string;
  guidance: string[];
  prompt?: string;
  category?: string;
  sourcePath?: string;
  appliesToModes?: StudyMode[];
  trigger?: RegExp;
  priority?: number;
  preferredAssignmentLevels?: string[];
  audience?: string[];
};

function toRuntimeSkill(skill: RegisteredSkill): RuntimeSkill {
  return {
    id: skill.id,
    name: skill.name,
    summary: skill.summary,
    guidance: skill.guidance,
    prompt: skill.prompt,
    category: skill.category,
    sourcePath: skill.sourcePath,
    appliesToModes: skill.appliesToModes,
    trigger: skill.trigger,
    priority: skill.priority,
    preferredAssignmentLevels: skill.preferredAssignmentLevels,
    audience: skill.audience,
  };
}

export function selectRuntimeSkills(params: {
  message: string;
  mode: StudyMode;
  preferredSkillIds?: string[];
  allowedToolBundles?: string[];
  assignmentLevel?: string;
  hasAgent?: boolean;
  maxSkills?: number;
}): RuntimeSkill[] {
  const contextual = resolveSkillsForContext({
    message: params.message,
    mode: params.mode,
    allowedToolBundles: params.allowedToolBundles,
    assignmentLevel: params.assignmentLevel as "L0" | "L1" | "L2" | "L3" | "L4" | undefined,
    hasAgent: params.hasAgent,
    maxSkills: params.maxSkills,
  });
  const preferredIds = new Set(params.preferredSkillIds ?? []);
  const preferred = preferredIds.size
    ? listRegisteredSkills().filter((skill) => preferredIds.has(skill.id))
    : [];
  const ordered = [...preferred, ...contextual];
  const seen = new Set<string>();
  const limited: RegisteredSkill[] = [];
  for (const skill of ordered) {
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    limited.push(skill);
    if (limited.length >= Math.max(1, Math.min(10, params.maxSkills ?? 5))) break;
  }
  return limited.map(toRuntimeSkill);
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
        `Priority: ${skill.priority ?? 0}` ,
        `Assignment levels: ${skill.preferredAssignmentLevels?.join(", ") ?? "any"}`,
      ];
      for (const item of skill.guidance) {
        lines.push(`- ${item}`);
      }
      if (skill.prompt) {
        lines.push("Prompt:");
        lines.push(skill.prompt);
      }
      if (skill.sourcePath) {
        lines.push(`Source: ${skill.sourcePath}`);
      }
      return lines.join("\n");
    }),
    "=== END ACTIVE RUNTIME SKILLS ===",
  ].join("\n");
}
