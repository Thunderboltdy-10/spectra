import { agentConfigurationIssues, normalizeAgentContent, type AgentContent } from "../../../agents/model";
import { AuthoringError, type IdFactory, defaultIdFactory, truncate } from "./shared";

/*
 * A custom agent is a profile, instructions and a few behaviour fields. It is
 * authored by naming those fields; instructions are prose.
 */

const TONES = ["warm", "direct", "socratic", "formal", "playful"] as const;
const LENGTHS = ["concise", "balanced", "detailed"] as const;

export type AgentFields = {
  purpose?: string;
  instructions?: string;
  outcomes?: string[];
  audience?: string;
  inScope?: string[];
  outOfScope?: string[];
  tone?: (typeof TONES)[number];
  responseLength?: (typeof LENGTHS)[number];
  boundaries?: string[];
  routingDescription?: string;
  routingExamples?: string[];
  skills?: Array<{ name: string; instructions: string }>;
};

export type AgentEditOp =
  | ({ op: "set" } & AgentFields)
  | { op: "replace"; find: string; replace: string; all?: boolean };

function strings(value: unknown, label: string, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new AuthoringError(`${label}: ${field} must be a list of strings.`);
  return value.map((entry: string) => entry.trim()).filter(Boolean);
}

function applyFields(agent: AgentContent, fields: AgentFields, label: string, ids: IdFactory): AgentContent {
  const next = structuredClone(agent);
  if (fields.purpose !== undefined) next.profile.purpose = String(fields.purpose);
  if (fields.audience !== undefined) next.profile.audienceIntent = String(fields.audience);
  next.profile.outcomes = strings(fields.outcomes, label, "outcomes") ?? next.profile.outcomes;
  next.profile.inScope = strings(fields.inScope, label, "inScope") ?? next.profile.inScope;
  next.profile.outOfScope = strings(fields.outOfScope, label, "outOfScope") ?? next.profile.outOfScope;
  if (fields.instructions !== undefined) next.instructions.text = String(fields.instructions);
  if (fields.tone !== undefined) {
    if (!TONES.includes(fields.tone)) throw new AuthoringError(`${label}: tone must be one of ${TONES.join(", ")}.`);
    next.behavior.tone = fields.tone;
  }
  if (fields.responseLength !== undefined) {
    if (!LENGTHS.includes(fields.responseLength))
      throw new AuthoringError(`${label}: responseLength must be one of ${LENGTHS.join(", ")}.`);
    next.behavior.responseLength = fields.responseLength;
  }
  next.behavior.boundaries = strings(fields.boundaries, label, "boundaries") ?? next.behavior.boundaries;
  if (fields.routingDescription !== undefined) {
    next.routing.description = String(fields.routingDescription);
    next.routing.enabled = Boolean(fields.routingDescription.trim());
  }
  next.routing.examples = strings(fields.routingExamples, label, "routingExamples") ?? next.routing.examples;
  if (fields.skills !== undefined) {
    if (!Array.isArray(fields.skills)) throw new AuthoringError(`${label}: skills must be a list of {name, instructions}.`);
    next.skills = fields.skills.map((skill, index) => {
      if (!skill?.name?.trim() || !skill.instructions?.trim())
        throw new AuthoringError(`${label} skills[${index}]: name and instructions are required.`);
      return { id: ids("skill"), name: skill.name.trim(), instructions: skill.instructions.trim(), enabled: true };
    });
  }
  return normalizeAgentContent(next);
}

export function applyAgentEdits(content: unknown, ops: AgentEditOp[], ids: IdFactory = defaultIdFactory()) {
  if (!Array.isArray(ops) || !ops.length) throw new AuthoringError("No operations were given.");
  let agent = normalizeAgentContent(structuredClone(content ?? {}));
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${String(op?.op)})`;
    if (op?.op === "set") {
      agent = applyFields(agent, op, label, ids);
      return;
    }
    if (op?.op === "replace") {
      const source = agent.instructions.text;
      if (!op.find) throw new AuthoringError(`${label}: \`find\` is empty.`);
      const count = source.split(op.find).length - 1;
      if (!count) throw new AuthoringError(`${label}: \`find\` text is not in the instructions.`);
      if (count > 1 && !op.all)
        throw new AuthoringError(`${label}: \`find\` appears ${count} times. Include more text, or set "all": true.`);
      agent.instructions.text = op.all ? source.split(op.find).join(op.replace) : source.replace(op.find, () => op.replace);
      return;
    }
    throw new AuthoringError(`${label}: unknown operation. Use set or replace.`);
  });
  return agent;
}

export function agentFromSpec(spec: AgentFields, ids: IdFactory = defaultIdFactory()) {
  if (!spec?.purpose?.trim()) throw new AuthoringError("purpose is required.");
  if (!spec.instructions?.trim()) throw new AuthoringError("instructions are required.");
  const base = normalizeAgentContent({});
  // Automatic routing needs a description and examples; it stays off until given.
  base.routing.enabled = false;
  const fields: AgentFields = {
    ...spec,
    skills: spec.skills?.length ? spec.skills : [{ name: "Core help", instructions: spec.instructions }],
  };
  return applyFields(base, fields, "create", ids);
}

export function agentOutline(content: unknown) {
  const agent = normalizeAgentContent(content);
  return [
    `Purpose: ${agent.profile.purpose || "(none)"}`,
    ...(agent.profile.outcomes.length ? [`Outcomes: ${agent.profile.outcomes.join("; ")}`] : []),
    ...(agent.profile.inScope.length ? [`In scope: ${agent.profile.inScope.join("; ")}`] : []),
    ...(agent.profile.outOfScope.length ? [`Out of scope: ${agent.profile.outOfScope.join("; ")}`] : []),
    `Tone: ${agent.behavior.tone}; length: ${agent.behavior.responseLength}`,
    `Skills: ${agent.skills.map((skill) => skill.name).join(", ") || "none"}`,
    ...(agent.routing.enabled ? [`Routing: ${agent.routing.description}`] : []),
    `Instructions:\n${truncate(agent.instructions.text, 6_000)}`,
  ].join("\n");
}

export function agentProblems(content: unknown) {
  return agentConfigurationIssues(normalizeAgentContent(content)).map((issue) => issue.replace(/\.$/, ""));
}
