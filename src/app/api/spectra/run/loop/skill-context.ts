import { query } from "./io";
import type {
  SkillMetadata,
  SkillWithBody,
} from "@/features/spectra/skills/contracts";
import { buildLazySkillContext } from "@/features/spectra/skills/lazy-context";
import {
  SYSTEM_SKILL_METADATA,
  readSystemSkill,
} from "@/features/spectra/skills/system/catalog";

function asUserMetadata(value: unknown): SkillMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return [];
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.purpose !== "string" ||
      !Array.isArray(row.triggerTerms)
    )
      return [];
    return [
      {
        id: row.id,
        name: row.name,
        purpose: row.purpose,
        triggerTerms: row.triggerTerms.filter(
          (term): term is string => typeof term === "string",
        ),
        version: typeof row.version === "number" ? row.version : 1,
        source: "self" as const,
        updatedAt:
          typeof row.updatedAt === "number" ? row.updatedAt : undefined,
      },
    ];
  });
}

export async function listAvailableSkillMetadata(): Promise<SkillMetadata[]> {
  const authored = await query<Record<string, never>, unknown>(
    "userSkills:listMetadata",
    {},
  );
  return [...asUserMetadata(authored), ...SYSTEM_SKILL_METADATA];
}

export async function readAvailableSkill(
  id: string,
): Promise<SkillWithBody | null> {
  if (id.startsWith("system:")) return readSystemSkill(id);
  const result = await query<{ skillId: string }, unknown>("userSkills:read", {
    skillId: id,
  });
  if (!result || typeof result !== "object" || Array.isArray(result))
    return null;
  const row = result as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.purpose !== "string" ||
    typeof row.body !== "string" ||
    !Array.isArray(row.triggerTerms)
  )
    return null;
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    triggerTerms: row.triggerTerms.filter(
      (term): term is string => typeof term === "string",
    ),
    body: row.body,
    version: typeof row.version === "number" ? row.version : 1,
    source: "self",
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : undefined,
  };
}

export async function skillSystemSection(prompt: string) {
  const metadata = await listAvailableSkillMetadata();
  return buildLazySkillContext({
    prompt,
    metadata,
    readBody: readAvailableSkill,
  });
}
