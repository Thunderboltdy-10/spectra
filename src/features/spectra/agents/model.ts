export type AgentClarificationPolicy =
  "ask_when_needed" | "confirm" | "never_ask";

export type AgentSkill = {
  id: string;
  name: string;
  instructions: string;
  enabled: boolean;
};

export type AgentTool = {
  id: string;
  key:
    | "artifact_search"
    | "artifact_read"
    | "artifact_create"
    | "artifact_edit"
    | "memory_retrieve"
    | "school_data"
    | "web_search";
  enabled: boolean;
  approval: "never" | "consequential" | "always";
};

export type AgentResource = {
  id: string;
  artifactId: string;
  mode: "read" | "use";
  label: string;
  versionPolicy: "reviewed" | "latest";
  pinnedVersionId?: string;
};

export type AgentEval = {
  id: string;
  prompt: string;
  expected: string;
  category: string;
  required: boolean;
};

export type AgentContent = {
  profile: {
    purpose: string;
    outcomes: string[];
    audienceIntent: string;
    inScope: string[];
    outOfScope: string[];
  };
  instructions: {
    regionId: string;
    text: string;
  };
  behavior: {
    clarification: AgentClarificationPolicy;
    tone: "warm" | "direct" | "socratic" | "formal" | "playful";
    responseLength: "concise" | "balanced" | "detailed";
    boundaries: string[];
  };
  skills: AgentSkill[];
  tools: AgentTool[];
  resources: AgentResource[];
  routing: {
    enabled: boolean;
    description: string;
    examples: string[];
    negativeExamples: string[];
  };
  modelPolicy: {
    mode: "spectra_default" | "reasoning" | "fast";
    allowFallback: boolean;
  };
  runtimeBudget: {
    maxTurns: number;
    maxToolCalls: number;
    maxElapsedMs: number;
    maxTotalTokens: number;
  };
  evals: AgentEval[];
  releaseNotes: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function id(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 180)
    : fallback;
}

const toolKeys = new Set<AgentTool["key"]>([
  "artifact_search",
  "artifact_read",
  "artifact_create",
  "artifact_edit",
  "memory_retrieve",
  "school_data",
  "web_search",
]);

export function normalizeAgentContent(value: unknown): AgentContent {
  const source = record(value);
  const profile = record(source.profile);
  const instructions = record(source.instructions);
  const behavior = record(source.behavior);
  const routing = record(source.routing);
  const modelPolicy = record(source.modelPolicy);
  const runtimeBudget = record(source.runtimeBudget);
  return {
    profile: {
      purpose:
        typeof profile.purpose === "string"
          ? profile.purpose.slice(0, 4_000)
          : typeof instructions.text === "string"
            ? instructions.text.slice(0, 500)
            : "",
      outcomes: strings(profile.outcomes, 30),
      audienceIntent:
        typeof profile.audienceIntent === "string"
          ? profile.audienceIntent.slice(0, 1_000)
          : "Anyone in my school who needs this specialist",
      inScope: strings(profile.inScope, 100),
      outOfScope: strings(profile.outOfScope, 100),
    },
    instructions: {
      regionId: id(instructions.regionId, "agent-instructions"),
      text:
        typeof instructions.text === "string"
          ? instructions.text.slice(0, 120_000)
          : "",
    },
    behavior: {
      clarification:
        behavior.clarification === "confirm" ||
        behavior.clarification === "never_ask"
          ? behavior.clarification
          : "ask_when_needed",
      tone:
        behavior.tone === "direct" ||
        behavior.tone === "socratic" ||
        behavior.tone === "formal" ||
        behavior.tone === "playful"
          ? behavior.tone
          : "warm",
      responseLength:
        behavior.responseLength === "concise" ||
        behavior.responseLength === "detailed"
          ? behavior.responseLength
          : "balanced",
      boundaries: strings(behavior.boundaries, 100),
    },
    skills: (Array.isArray(source.skills) ? source.skills : [])
      .map((candidate, index): AgentSkill => {
        const skill = record(candidate);
        return {
          id: id(skill.id, `skill-${index + 1}`),
          name:
            typeof skill.name === "string"
              ? skill.name.slice(0, 100)
              : `Skill ${index + 1}`,
          instructions:
            typeof skill.instructions === "string"
              ? skill.instructions.slice(0, 40_000)
              : "",
          enabled: skill.enabled !== false,
        };
      })
      .slice(0, 100),
    tools: (Array.isArray(source.tools) ? source.tools : []).flatMap(
      (candidate, index): AgentTool[] => {
        const tool = record(candidate);
        if (!toolKeys.has(tool.key as AgentTool["key"])) return [];
        return [
          {
            id: id(tool.id, `tool-${index + 1}`),
            key: tool.key as AgentTool["key"],
            enabled: tool.enabled !== false,
            approval:
              tool.approval === "never" || tool.approval === "always"
                ? tool.approval
                : "consequential",
          },
        ];
      },
    ),
    resources: (Array.isArray(source.resources) ? source.resources : [])
      .flatMap((candidate, index): AgentResource[] => {
        const resource = record(candidate);
        if (typeof resource.artifactId !== "string") return [];
        return [
          {
            id: id(resource.id, `resource-${index + 1}`),
            artifactId: resource.artifactId,
            mode: resource.mode === "use" ? "use" : "read",
            label:
              typeof resource.label === "string"
                ? resource.label.slice(0, 160)
                : "Artifact resource",
            versionPolicy:
              resource.versionPolicy === "latest" ? "latest" : "reviewed",
            ...(typeof resource.pinnedVersionId === "string"
              ? { pinnedVersionId: resource.pinnedVersionId }
              : {}),
          },
        ];
      })
      .slice(0, 100),
    routing: {
      enabled: routing.enabled !== false,
      description:
        typeof routing.description === "string"
          ? routing.description.slice(0, 4_000)
          : "",
      examples: strings(routing.examples, 50),
      negativeExamples: strings(routing.negativeExamples, 50),
    },
    modelPolicy: {
      mode:
        modelPolicy.mode === "reasoning" || modelPolicy.mode === "fast"
          ? modelPolicy.mode
          : "spectra_default",
      allowFallback: modelPolicy.allowFallback !== false,
    },
    runtimeBudget: {
      maxTurns:
        typeof runtimeBudget.maxTurns === "number"
          ? Math.max(4, Math.min(40, Math.round(runtimeBudget.maxTurns)))
          : 24,
      maxToolCalls:
        typeof runtimeBudget.maxToolCalls === "number"
          ? Math.max(4, Math.min(100, Math.round(runtimeBudget.maxToolCalls)))
          : 60,
      maxElapsedMs:
        typeof runtimeBudget.maxElapsedMs === "number"
          ? Math.max(30_000, Math.min(600_000, runtimeBudget.maxElapsedMs))
          : 240_000,
      maxTotalTokens:
        typeof runtimeBudget.maxTotalTokens === "number"
          ? Math.max(
              20_000,
              Math.min(500_000, Math.round(runtimeBudget.maxTotalTokens)),
            )
          : 250_000,
    },
    evals: (Array.isArray(source.evals) ? source.evals : [])
      .map((candidate, index): AgentEval => {
        const evaluation = record(candidate);
        return {
          id: id(evaluation.id, `eval-${index + 1}`),
          prompt:
            typeof evaluation.prompt === "string"
              ? evaluation.prompt.slice(0, 4_000)
              : "",
          expected:
            typeof evaluation.expected === "string"
              ? evaluation.expected.slice(0, 4_000)
              : "",
          category:
            typeof evaluation.category === "string"
              ? evaluation.category.slice(0, 100)
              : "quality",
          required: evaluation.required !== false,
        };
      })
      .slice(0, 200),
    releaseNotes:
      typeof source.releaseNotes === "string"
        ? source.releaseNotes.slice(0, 4_000)
        : "",
  };
}

export function agentConfigurationIssues(content: AgentContent) {
  const issues: string[] = [];
  if (content.profile.purpose.trim().length < 30)
    issues.push("Describe the agent's purpose in at least 30 characters.");
  if (content.instructions.text.trim().length < 40)
    issues.push("Add actionable instructions in at least 40 characters.");
  if (content.routing.enabled && content.routing.description.trim().length < 30)
    issues.push("Automatic routing needs a specific description.");
  if (content.routing.enabled && !content.routing.examples.length)
    issues.push("Add at least one positive routing example.");
  if (!content.skills.some((skill) => skill.enabled))
    issues.push("Enable at least one skill.");
  content.resources.forEach((resource) => {
    if (!resource.artifactId)
      issues.push(`Resource ${resource.label} is missing.`);
  });
  content.evals.forEach((evaluation, index) => {
    if (!evaluation.prompt.trim() || !evaluation.expected.trim())
      issues.push(
        `Evaluation ${index + 1} needs a prompt and success criteria.`,
      );
  });
  return issues;
}
