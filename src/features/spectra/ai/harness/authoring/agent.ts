import { normalizeFoundryContent, projectFoundryToLegacy, type AgentFoundryContent } from "../../../agents/foundry";
import { agentConfigurationIssues, normalizeAgentContent, type AgentContent } from "../../../agents/model";
import { AuthoringError, type IdFactory, defaultIdFactory, truncate } from "./shared";

/*
 * A custom agent is a profile, instructions and a few behaviour fields. It is
 * authored by naming those fields; instructions are prose.
 *
 * An agent built in the Agent Foundry keeps its Foundry state (mission,
 * answers, sources, approved skills) beside those fields, and its
 * instructions, skills and boundaries are compiled from it. An edit keeps
 * that state: the fields the mission holds are written to the mission and the
 * agent is compiled again, as the studio does, and the compiled fields are
 * refused rather than silently replaced by the next compilation.
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Whether the agent was built in the Agent Foundry, so its brief is compiled from its mission. */
export function builtInFoundry(content: unknown) {
  return record(record(content).foundry).foundationEstablished === true;
}

const COMPILED_FIELDS = ["instructions", "skills", "boundaries"] as const;
const FOUNDRY_NOTE =
  "this agent is built in the Agent Foundry, so its instructions, skills and boundaries are compiled from its mission and approved skills. Set purpose, outcomes, inScope, outOfScope, tone or responseLength to change the mission; compile_agent and approve_agent_skills change its skills.";

function applyFoundryEdits(content: unknown, ops: AgentEditOp[], ids: IdFactory) {
  let agent: AgentFoundryContent = normalizeFoundryContent(structuredClone(content));
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${String(op?.op)})`;
    if (op?.op === "replace") throw new AuthoringError(`${label}: ${FOUNDRY_NOTE}`);
    if (op?.op !== "set") throw new AuthoringError(`${label}: unknown operation. Use set.`);
    const compiled = COMPILED_FIELDS.filter((field) => op[field] !== undefined);
    if (compiled.length) throw new AuthoringError(`${label}: ${compiled.join(", ")} cannot be set: ${FOUNDRY_NOTE}`);
    const mission = structuredClone(agent.foundry.mission);
    if (op.purpose !== undefined) mission.objective = String(op.purpose);
    mission.domains = strings(op.inScope, label, "inScope") ?? mission.domains;
    mission.exclusions = strings(op.outOfScope, label, "outOfScope") ?? mission.exclusions;
    const outcomes = strings(op.outcomes, label, "outcomes");
    if (outcomes)
      mission.expectedOutputs = outcomes.map(
        (description) => mission.expectedOutputs.find((output) => output.description === description) ?? { kind: "response", description },
      );
    if (op.tone !== undefined) {
      if (!TONES.includes(op.tone)) throw new AuthoringError(`${label}: tone must be one of ${TONES.join(", ")}.`);
      mission.interactionStyle.tone = op.tone;
    }
    if (op.responseLength !== undefined) {
      if (!LENGTHS.includes(op.responseLength))
        throw new AuthoringError(`${label}: responseLength must be one of ${LENGTHS.join(", ")}.`);
      mission.interactionStyle.responseLength = op.responseLength;
    }
    // The audience and routing are the agent's own fields, which compiling leaves alone.
    const own = applyFields(agent, { audience: op.audience, routingDescription: op.routingDescription, routingExamples: op.routingExamples }, label, ids);
    agent = { ...agent, profile: own.profile, routing: own.routing, foundry: { ...agent.foundry, mission } };
  });
  return projectFoundryToLegacy(agent);
}

export function applyAgentEdits(content: unknown, ops: AgentEditOp[], ids: IdFactory = defaultIdFactory()) {
  if (!Array.isArray(ops) || !ops.length) throw new AuthoringError("No operations were given.");
  if (builtInFoundry(content)) return applyFoundryEdits(content, ops, ids);
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
  // What these fields do not cover (Foundry state not yet established, among others) stays as it was.
  return { ...record(content), ...agent };
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
    ...(builtInFoundry(content)
      ? ["Built in the Agent Foundry: its instructions, skills and boundaries are compiled from its mission and approved skills."]
      : []),
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
