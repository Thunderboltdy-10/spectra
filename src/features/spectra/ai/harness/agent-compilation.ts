import {
  acceptCompiledSkill,
  applyCompiledRouting,
  normalizeFoundryContent,
  pendingCompiledSkills,
  projectFoundryToLegacy,
  type AgentFoundryContent,
  type CompiledAgentResult,
  type SpectraSkill,
} from "../../agents/foundry";

/*
 * An agent's latest Foundry compilation, and approving what it drafted, as
 * the agent studio's Approve does: an approved skill joins the agent as
 * verified (the next version of a skill it already has), and the compiled
 * routing and release notes apply with it. compile_agent drafts; this is how
 * Spectra approves.
 */

export type AgentCompilationState = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  /** The draft changed after this compilation began. */
  stale: boolean;
  result: CompiledAgentResult | null;
};

export type SkillApproval = {
  content: AgentFoundryContent;
  approved: SpectraSkill[];
  /** Asked-for ids this compilation did not draft. */
  unknown: string[];
  /** Asked-for ids already approved since this compilation. */
  already: string[];
};

/** Approves the drafted skills still waiting (all, or the ids asked for) on the agent's content. */
export function approveCompiledSkills(
  content: unknown,
  result: CompiledAgentResult,
  skillIds?: readonly string[],
): SkillApproval {
  const current = normalizeFoundryContent(content);
  const pending = pendingCompiledSkills(result.skills, current.foundry.skills);
  const drafted = new Set(result.skills.map((skill) => skill.id));
  const waiting = new Set(pending.map((skill) => skill.id));
  const unknown = (skillIds ?? []).filter((id) => !drafted.has(id));
  const already = (skillIds ?? []).filter((id) => drafted.has(id) && !waiting.has(id));
  const approved = skillIds ? pending.filter((skill) => skillIds.includes(skill.id)) : pending;
  let next = applyCompiledRouting(current, result);
  for (const skill of approved)
    next = { ...next, foundry: { ...next.foundry, skills: acceptCompiledSkill(next.foundry.skills, skill) } };
  return { content: projectFoundryToLegacy(next), approved, unknown, already };
}
