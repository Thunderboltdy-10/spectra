export { USER_SKILL_LIMITS } from "../../../../shared/user-skill-limits";

export type SkillSource = "self" | "system";

export type SkillMetadata = {
  id: string;
  name: string;
  purpose: string;
  triggerTerms: string[];
  version: number;
  source: SkillSource;
  updatedAt?: number;
};

export type SkillWithBody = SkillMetadata & {
  body: string;
};

export function normalizeSkillText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeTriggerTerm(value: string) {
  return normalizeSkillText(value).toLocaleLowerCase();
}

export function normalizeTriggerTerms(values: readonly string[]) {
  return [...new Set(values.map(normalizeTriggerTerm).filter(Boolean))];
}
