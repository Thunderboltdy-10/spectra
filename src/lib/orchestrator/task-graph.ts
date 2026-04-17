export type TaskRole =
  | "workflow_planner"
  | "retriever"
  | "web_researcher"
  | "vision_interpreter"
  | "code_helper"
  | "curriculum_planner"
  | "fact_checker"
  | "pedagogy_coach"
  | "exam_strategist"
  | "critic"
  | "synthesizer";

export type TaskNode = {
  id: string;
  role: TaskRole;
  specialist: string;
  prompt: string;
  dependsOn: string[];
  mode?: string;
  profile?: OrchestrationProfile;
  result?: string;
  tokens?: number;
  durationMs?: number;
  status: "pending" | "running" | "done" | "failed" | "skipped";
};

export type OrchestrationProfileConfig = {
  profile: OrchestrationProfile;
  plannerRole: TaskRole;
  allowedTools: string[];
  subagentRoles: TaskRole[];
  concurrencyCeiling: number;
  verificationChecks: string[];
  artifactSavingPolicy: "none" | "optional" | "required";
  recursionMode: "none" | "tool_loop" | "subagent_loop" | "hybrid";
  groundingPolicy: "none" | "prefer_sources" | "require_sources";
  stopConditions: string[];
};

export type OrchestrationProfile =
  | "simple_direct"
  | "search_synthesis"
  | "artifact_builder"
  | "study_transform"
  | "image_analysis"
  | "workspace_action"
  | "agent_delegation"
  | "teacher_marking"
  | "long_context_reconstruction";

type BuildTaskGraphContext = {
  hasVision?: boolean;
  searchEnabled?: boolean;
  sourceBlock?: string;
  searchBlock?: string;
  includeCritic?: boolean;
  maxSpecialists?: number;
  profile?: OrchestrationProfile;
};

type ExecutionLimits = {
  maxSubcalls?: number;
  maxTokensPerSpecialist?: number;
  maxWallTimeMs?: number;
  maxConcurrency?: number;
  usageBudgetTokens?: number;
  budgetOverrunFactor?: number;
};

const PROFILE_CONFIGS: Record<OrchestrationProfile, OrchestrationProfileConfig> = {
  simple_direct: {
    profile: "simple_direct",
    plannerRole: "workflow_planner",
    allowedTools: [],
    subagentRoles: ["pedagogy_coach"],
    concurrencyCeiling: 1,
    verificationChecks: ["basic_completeness"],
    artifactSavingPolicy: "none",
    recursionMode: "none",
    groundingPolicy: "none",
    stopConditions: ["answer_complete", "no_more_dependencies"],
  },
  search_synthesis: {
    profile: "search_synthesis",
    plannerRole: "workflow_planner",
    allowedTools: ["search_web"],
    subagentRoles: ["web_researcher", "fact_checker", "critic"],
    concurrencyCeiling: 3,
    verificationChecks: ["source_coverage", "claim_consistency", "dated_claim_guard"],
    artifactSavingPolicy: "optional",
    recursionMode: "hybrid",
    groundingPolicy: "prefer_sources",
    stopConditions: ["sufficient_evidence", "conflicts_resolved", "budget_exhausted"],
  },
  artifact_builder: {
    profile: "artifact_builder",
    plannerRole: "workflow_planner",
    allowedTools: ["create_note", "surface_result"],
    subagentRoles: ["curriculum_planner", "critic"],
    concurrencyCeiling: 2,
    verificationChecks: ["artifact_structure", "output_contract"],
    artifactSavingPolicy: "required",
    recursionMode: "tool_loop",
    groundingPolicy: "prefer_sources",
    stopConditions: ["artifact_ready", "validation_passed"],
  },
  study_transform: {
    profile: "study_transform",
    plannerRole: "workflow_planner",
    allowedTools: ["create_note", "surface_result"],
    subagentRoles: ["retriever", "pedagogy_coach", "exam_strategist", "critic"],
    concurrencyCeiling: 3,
    verificationChecks: ["source_grounding", "transform_format", "duplicate_guard"],
    artifactSavingPolicy: "optional",
    recursionMode: "hybrid",
    groundingPolicy: "require_sources",
    stopConditions: ["transform_grounded", "format_validated"],
  },
  image_analysis: {
    profile: "image_analysis",
    plannerRole: "workflow_planner",
    allowedTools: [],
    subagentRoles: ["vision_interpreter", "fact_checker"],
    concurrencyCeiling: 2,
    verificationChecks: ["visual_evidence_alignment"],
    artifactSavingPolicy: "optional",
    recursionMode: "subagent_loop",
    groundingPolicy: "require_sources",
    stopConditions: ["image_evidence_sufficient", "answer_complete"],
  },
  workspace_action: {
    profile: "workspace_action",
    plannerRole: "workflow_planner",
    allowedTools: ["get_workstream_context", "create_note", "update_planner", "surface_result", "fork_thread"],
    subagentRoles: ["curriculum_planner", "critic"],
    concurrencyCeiling: 2,
    verificationChecks: ["workspace_target_resolved", "mutation_safety"],
    artifactSavingPolicy: "required",
    recursionMode: "tool_loop",
    groundingPolicy: "prefer_sources",
    stopConditions: ["workspace_action_completed", "user_request_satisfied"],
  },
  agent_delegation: {
    profile: "agent_delegation",
    plannerRole: "workflow_planner",
    allowedTools: ["search_web", "get_workstream_context"],
    subagentRoles: ["workflow_planner", "retriever", "web_researcher", "critic"],
    concurrencyCeiling: 3,
    verificationChecks: ["delegation_coverage", "merge_consistency"],
    artifactSavingPolicy: "optional",
    recursionMode: "hybrid",
    groundingPolicy: "prefer_sources",
    stopConditions: ["delegation_merged", "verification_passed"],
  },
  teacher_marking: {
    profile: "teacher_marking",
    plannerRole: "workflow_planner",
    allowedTools: ["create_note", "surface_result"],
    subagentRoles: ["retriever", "exam_strategist", "critic"],
    concurrencyCeiling: 3,
    verificationChecks: ["rubric_alignment", "feedback_specificity", "evidence_alignment"],
    artifactSavingPolicy: "optional",
    recursionMode: "hybrid",
    groundingPolicy: "require_sources",
    stopConditions: ["rubric_applied", "feedback_complete"],
  },
  long_context_reconstruction: {
    profile: "long_context_reconstruction",
    plannerRole: "workflow_planner",
    allowedTools: ["recall_memory", "get_workstream_context", "fork_thread"],
    subagentRoles: ["retriever", "workflow_planner", "critic"],
    concurrencyCeiling: 2,
    verificationChecks: ["continuity_reconstruction", "commitment_preservation"],
    artifactSavingPolicy: "none",
    recursionMode: "hybrid",
    groundingPolicy: "prefer_sources",
    stopConditions: ["context_restored", "continuity_decided"],
  },
};

export function getOrchestrationProfileConfig(profile: OrchestrationProfile): OrchestrationProfileConfig {
  return PROFILE_CONFIGS[profile];
}

function normalizeComplexityScore(value: number | "simple" | "medium" | "complex") {
  if (typeof value === "number") return Math.max(0, Math.min(1, value));
  if (value === "simple") return 0.25;
  if (value === "medium") return 0.58;
  return 0.85;
}

export function shouldUseMultiAgent(
  prompt: string,
  mode: string,
  complexity: number | "simple" | "medium" | "complex",
) {
  const normalizedComplexity = normalizeComplexityScore(complexity);
  const lower = prompt.toLowerCase();
  const multipart = /(^|\n)\s*(\d+\.|-|\*)\s+/.test(prompt) || /(first|second|finally|compare|contrast)/i.test(lower);
  const longPrompt = prompt.length > 520;
  const explicitSpecialistIntent =
    /\b(use multiple models|multiple models|multi[- ]?agent|different perspectives|multiple perspectives|specialists?|parallel)\b/i.test(lower);
  // Research mode: low threshold — use multi-agent for anything non-trivial
  if (mode === "research" && normalizedComplexity > 0.15) return true;
  // Explain mode: use multi-agent for moderately complex prompts
  if (mode === "explain" && normalizedComplexity > 0.4) return true;
  if (explicitSpecialistIntent && normalizedComplexity >= 0.3) return true;
  if (mode === "exam" && multipart && normalizedComplexity > 0.4) return true;
  if (mode === "draft_coach" && /evidence|citation|sources?|counter-argument/i.test(lower) && normalizedComplexity > 0.35) return true;
  if ((mode === "tutor" || mode === "general") && multipart && normalizedComplexity >= 0.45) return true;
  if ((mode === "tutor" || mode === "general" || mode === "marker") && longPrompt && normalizedComplexity >= 0.55) return true;
  return false;
}

function hasCodeIntent(prompt: string) {
  return /```|function|class|typescript|javascript|python|debug|refactor|compile|stack trace/i.test(prompt);
}

function hasPlanningIntent(prompt: string) {
  return /\b(plan|roadmap|schedule|timeline|syllabus|strategy|study plan|weekly)\b/i.test(prompt);
}

function hasMultipartIntent(prompt: string) {
  const lower = prompt.toLowerCase();
  return /(^|\n)\s*(\d+\.|-|\*)\s+/.test(prompt) || /\b(first|second|third|then|finally|compare|contrast)\b/.test(lower);
}

export function resolveOrchestrationProfile(prompt: string, mode: string, context: BuildTaskGraphContext = {}): OrchestrationProfile {
  if (context.profile) return context.profile;
  const lower = prompt.toLowerCase();
  if (context.hasVision) return "image_analysis";
  if (mode === "marker") return "teacher_marking";
  if (/\b(flashcards?|quiz|notes from|turn .* into|study guide|transform)\b/.test(lower)) return "study_transform";
  if (/\b(document|artifact|worksheet|handout|presentation|slides)\b/.test(lower)) return "artifact_builder";
  if (/\b(workspace|workstream|planner|widget|note)\b/.test(lower)) return "workspace_action";
  if (/\b(agent|delegate|specialist)\b/.test(lower)) return "agent_delegation";
  if (context.searchEnabled || mode === "research") return "search_synthesis";
  if (/\b(reconstruct|summari[sz]e history|restore context|long context)\b/.test(lower)) return "long_context_reconstruction";
  return "simple_direct";
}

export function buildTaskGraph(prompt: string, mode: string, context: BuildTaskGraphContext = {}): TaskNode[] {
  const graph: TaskNode[] = [];
  const profile = resolveOrchestrationProfile(prompt, mode, context);
  const profileConfig = getOrchestrationProfileConfig(profile);
  const hasSourceContext = Boolean(context.sourceBlock?.trim());
  const hasSearchContext = Boolean(context.searchBlock?.trim());
  const codeIntent = hasCodeIntent(prompt);
  const planningIntent = hasPlanningIntent(prompt);
  const multipartIntent = hasMultipartIntent(prompt);
  const needsPlanner =
    mode === "research"
    || mode === "document"
    || mode === "exam"
    || multipartIntent
    || planningIntent
    || codeIntent
    || Boolean(context.hasVision)
    || prompt.trim().length > 280;
  const packedPrompt = [
    prompt.trim(),
    context.sourceBlock ? `\nRetrieved context:\n${context.sourceBlock}` : "",
    context.searchBlock ? `\nWeb briefing:\n${context.searchBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (needsPlanner || profileConfig.plannerRole === "workflow_planner") {
    graph.push({
      id: "planner",
      role: "workflow_planner",
      specialist: "workflow_planner",
      prompt: `Create a short staged execution plan for this request.
Return:
- objective
- stage sequence
- dependency notes
- risk checks

Prompt and context:
${packedPrompt}`,
      dependsOn: [],
      profile,
      status: "pending",
    });
  }

  if (hasSourceContext && profileConfig.subagentRoles.includes("retriever")) {
    graph.push({
      id: "retriever",
      role: "retriever",
      specialist: "retriever",
      prompt: packedPrompt,
      dependsOn: needsPlanner ? ["planner"] : [],
      profile,
      status: "pending",
    });
  }

  if ((mode === "research" || context.searchEnabled) && profileConfig.subagentRoles.includes("web_researcher")) {
    graph.push({
      id: "web",
      role: "web_researcher",
      specialist: "web_researcher",
      prompt: packedPrompt,
      dependsOn: needsPlanner ? ["planner"] : [],
      profile,
      status: "pending",
    });
    graph.push({
      id: "fact-check",
      role: "fact_checker",
      specialist: "fact_checker",
      prompt: packedPrompt,
      profile,
      dependsOn: [
        ...(needsPlanner ? ["planner"] : []),
        ...(hasSearchContext ? ["web"] : []),
        ...(hasSourceContext ? ["retriever"] : []),
      ],
      status: "pending",
    });
  }

  if (context.hasVision && profileConfig.subagentRoles.includes("vision_interpreter")) {
    graph.push({
      id: "vision",
      role: "vision_interpreter",
      specialist: "vision_interpreter",
      prompt: packedPrompt,
      profile,
      dependsOn: [
        ...(needsPlanner ? ["planner"] : []),
        ...(hasSourceContext ? ["retriever"] : []),
      ],
      status: "pending",
    });
  }

  if (codeIntent && profileConfig.subagentRoles.includes("code_helper")) {
    graph.push({
      id: "code",
      role: "code_helper",
      specialist: "code_helper",
      prompt: packedPrompt,
      profile,
      dependsOn: [
        ...(needsPlanner ? ["planner"] : []),
        ...(hasSourceContext ? ["retriever"] : []),
      ],
      status: "pending",
    });
  }

  if ((mode === "tutor" || mode === "explain" || mode === "draft_coach") && profileConfig.subagentRoles.includes("pedagogy_coach")) {
    graph.push({
      id: "pedagogy",
      role: "pedagogy_coach",
      specialist: "pedagogy_coach",
      prompt: packedPrompt,
      profile,
      dependsOn: [
        ...(needsPlanner ? ["planner"] : []),
        ...(hasSourceContext ? ["retriever"] : []),
      ],
      status: "pending",
    });
  }

  if ((mode === "quiz" || mode === "exam" || mode === "marker") && profileConfig.subagentRoles.includes("exam_strategist")) {
    graph.push({
      id: "exam-strategy",
      role: "exam_strategist",
      specialist: "exam_strategist",
      prompt: packedPrompt,
      profile,
      dependsOn: [
        ...(needsPlanner ? ["planner"] : []),
        ...(hasSourceContext ? ["retriever"] : []),
      ],
      status: "pending",
    });
  }

  if ((mode === "draft_coach" || planningIntent || profile === "artifact_builder" || profile === "workspace_action") && profileConfig.subagentRoles.includes("curriculum_planner")) {
    graph.push({
      id: "curriculum-plan",
      role: "curriculum_planner",
      specialist: "curriculum_planner",
      prompt: packedPrompt,
      profile,
      dependsOn: [
        ...(needsPlanner ? ["planner"] : []),
        ...(hasSourceContext ? ["retriever"] : []),
      ],
      status: "pending",
    });
  }

  const maxSpecialists = Math.max(1, Math.min(context.maxSpecialists ?? 5, profileConfig.concurrencyCeiling + 2));
  const priority = [
    "workflow_planner",
    "retriever",
    "web_researcher",
    "fact_checker",
    "vision_interpreter",
    "code_helper",
    "curriculum_planner",
    "pedagogy_coach",
    "exam_strategist",
  ] as const;
  const rank = (role: TaskRole) => {
    const idx = priority.indexOf(role as (typeof priority)[number]);
    return idx === -1 ? 999 : idx;
  };
  const plannerNode = graph.find((node) => node.role === "workflow_planner");
  const specialistNodes = graph
    .slice()
    .filter((node) => node.role !== "workflow_planner")
    .sort((a, b) => rank(a.role) - rank(b.role))
    .slice(0, maxSpecialists);

  if (specialistNodes.length === 0) {
    specialistNodes.push({
      id: "pedagogy",
      role: "pedagogy_coach",
      specialist: "pedagogy_coach",
      prompt: packedPrompt,
      dependsOn: [],
      profile,
      status: "pending",
    });
  }

  graph.length = 0;
  if (plannerNode) {
    graph.push(plannerNode);
  }
  graph.push(...specialistNodes);

  const includeCritic = (context.includeCritic ?? true) && profileConfig.subagentRoles.includes("critic");
  if (includeCritic) {
    const criticDependencies = graph
      .map((node) => node.id)
      .filter((id) => id !== "planner");
    graph.push({
      id: "critic",
      role: "critic",
      specialist: "critic",
      profile,
      prompt: `Audit specialist findings against the original question.
Return bullets with:
- confidence (high/medium/low)
- contradictions found
- likely hallucinations or weak claims
- corrective actions for synthesis

Original question and context:
${packedPrompt}`,
      dependsOn: criticDependencies.length > 0 ? criticDependencies : specialistNodes.map((node) => node.id),
      status: "pending",
    });
  }

  graph.push({
    id: "synth",
    role: "synthesizer",
    specialist: "synthesizer",
    prompt: packedPrompt,
    profile,
    dependsOn: includeCritic ? ["critic"] : specialistNodes.map((node) => node.id),
    status: "pending",
  });

  return graph;
}

export async function executeGraph(
  graph: TaskNode[],
  runNode: (node: TaskNode, dependencies: TaskNode[]) => Promise<{ result: string; tokens: number; durationMs?: number }>,
  limits?: ExecutionLimits,
) {
  const maxSubcalls = Math.max(1, limits?.maxSubcalls ?? 5);
  const maxTokens = Math.max(500, limits?.maxTokensPerSpecialist ?? 8000);
  const maxWall = Math.max(5000, limits?.maxWallTimeMs ?? 120_000);
  const maxConcurrency = Math.max(1, Math.min(3, limits?.maxConcurrency ?? 3));
  const usageBudgetTokens = Math.max(0, Math.round(limits?.usageBudgetTokens ?? 0));
  const budgetOverrunFactor = Math.max(1, limits?.budgetOverrunFactor ?? 1.5);
  const startedAt = Date.now();

  let calls = 0;
  let consumedTokens = 0;
  const byId = new Map(graph.map((node) => [node.id, { ...node }]));

  while (true) {
    if (usageBudgetTokens > 0 && consumedTokens > usageBudgetTokens * budgetOverrunFactor) {
      break;
    }
    if (Date.now() - startedAt > maxWall) {
      break;
    }

    const ready = [...byId.values()].filter(
      (node) =>
        node.status === "pending" &&
        node.dependsOn.every((id) => {
          const dependencyStatus = byId.get(id)?.status;
          return dependencyStatus === "done" || dependencyStatus === "failed" || dependencyStatus === "skipped";
        }),
    );
    if (ready.length === 0) break;
    if (calls >= maxSubcalls) break;

    const remaining = maxSubcalls - calls;
    const batchSize = Math.min(ready.length, Math.max(1, remaining), maxConcurrency);
    const batch = ready.slice(0, batchSize);
    calls += batch.length;
    await Promise.all(
      batch.map(async (node) => {
        node.status = "running";
        const dependencies = node.dependsOn
          .map((id) => byId.get(id))
          .filter((candidate): candidate is TaskNode => Boolean(candidate));
        try {
          const out = await runNode(node, dependencies);
          node.result = out.result.slice(0, 8_000);
          node.tokens = Math.min(Math.max(0, out.tokens), maxTokens);
          consumedTokens += node.tokens;
          node.durationMs = out.durationMs;
          node.status = "done";
        } catch {
          node.status = "failed";
          node.tokens = 0;
        }
      }),
    );
  }

  // Mark unresolved nodes as skipped when execution halts due to budgets/time.
  for (const node of byId.values()) {
    if (node.status === "pending" || node.status === "running") {
      node.status = "skipped";
      node.tokens = 0;
    }
  }

  return [...byId.values()];
}

export function synthesize(nodeResults: TaskNode[], originalPrompt: string) {
  const complete = nodeResults.filter((node) => node.status === "done" && node.result);
  const summary = complete
    .map((node) => `[${node.role}] ${node.result}`)
    .join("\n\n")
    .slice(0, 4_000);

  return `Prompt: ${originalPrompt}\n\nSpecialist findings:\n${summary}`.trim();
}
