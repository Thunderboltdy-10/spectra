export type TaskRole =
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
  result?: string;
  tokens?: number;
  durationMs?: number;
  status: "pending" | "running" | "done" | "failed";
};

type BuildTaskGraphContext = {
  hasVision?: boolean;
  searchEnabled?: boolean;
  sourceBlock?: string;
  searchBlock?: string;
  includeCritic?: boolean;
  maxSpecialists?: number;
};

type ExecutionLimits = {
  maxSubcalls?: number;
  maxTokensPerSpecialist?: number;
  maxWallTimeMs?: number;
};

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
  // Research mode: lower threshold — use multi-agent for anything non-simple
  if (mode === "research" && normalizedComplexity > 0.3) return true;
  // Explain mode: use multi-agent for complex prompts
  if (mode === "explain" && normalizedComplexity > 0.58) return true;
  if (mode === "exam" && multipart && normalizedComplexity > 0.58) return true;
  if (mode === "draft_coach" && /evidence|citation|sources?|counter-argument/i.test(lower) && normalizedComplexity > 0.52) return true;
  return false;
}

function hasCodeIntent(prompt: string) {
  return /```|function|class|typescript|javascript|python|debug|refactor|compile|stack trace/i.test(prompt);
}

function hasPlanningIntent(prompt: string) {
  return /\b(plan|roadmap|schedule|timeline|syllabus|strategy|study plan|weekly)\b/i.test(prompt);
}

export function buildTaskGraph(prompt: string, mode: string, context: BuildTaskGraphContext = {}): TaskNode[] {
  const graph: TaskNode[] = [];
  const packedPrompt = [
    prompt.trim(),
    context.sourceBlock ? `\nRetrieved context:\n${context.sourceBlock}` : "",
    context.searchBlock ? `\nWeb briefing:\n${context.searchBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  graph.push({
    id: "retriever",
    role: "retriever",
    specialist: "retriever",
    prompt: packedPrompt,
    dependsOn: [],
    status: "pending",
  });

  if (mode === "research" || context.searchEnabled) {
    graph.push({
      id: "web",
      role: "web_researcher",
      specialist: "web_researcher",
      prompt: packedPrompt,
      dependsOn: [],
      status: "pending",
    });
    graph.push({
      id: "fact-check",
      role: "fact_checker",
      specialist: "fact_checker",
      prompt: packedPrompt,
      dependsOn: [],
      status: "pending",
    });
  }

  if (context.hasVision) {
    graph.push({
      id: "vision",
      role: "vision_interpreter",
      specialist: "vision_interpreter",
      prompt: packedPrompt,
      dependsOn: [],
      status: "pending",
    });
  }

  if (hasCodeIntent(prompt)) {
    graph.push({
      id: "code",
      role: "code_helper",
      specialist: "code_helper",
      prompt: packedPrompt,
      dependsOn: [],
      status: "pending",
    });
  }

  if (mode === "tutor" || mode === "explain" || mode === "draft_coach") {
    graph.push({
      id: "pedagogy",
      role: "pedagogy_coach",
      specialist: "pedagogy_coach",
      prompt: packedPrompt,
      dependsOn: [],
      status: "pending",
    });
  }

  if (mode === "quiz" || mode === "exam" || mode === "marker") {
    graph.push({
      id: "exam-strategy",
      role: "exam_strategist",
      specialist: "exam_strategist",
      prompt: packedPrompt,
      dependsOn: [],
      status: "pending",
    });
  }

  if (mode === "draft_coach" || hasPlanningIntent(prompt)) {
    graph.push({
      id: "curriculum-plan",
      role: "curriculum_planner",
      specialist: "curriculum_planner",
      prompt: packedPrompt,
      dependsOn: [],
      status: "pending",
    });
  }

  const maxSpecialists = Math.max(1, context.maxSpecialists ?? 5);
  const priority = [
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
  const specialistNodes = graph
    .slice()
    .sort((a, b) => rank(a.role) - rank(b.role))
    .slice(0, maxSpecialists);

  graph.length = 0;
  graph.push(...specialistNodes);

  const includeCritic = context.includeCritic ?? true;
  if (includeCritic) {
    graph.push({
      id: "critic",
      role: "critic",
      specialist: "critic",
      prompt: `Audit specialist findings against the original question.
Return bullets with:
- confidence (high/medium/low)
- contradictions found
- likely hallucinations or weak claims
- corrective actions for synthesis

Original question and context:
${packedPrompt}`,
      dependsOn: specialistNodes.map((node) => node.id),
      status: "pending",
    });
  }

  graph.push({
    id: "synth",
    role: "synthesizer",
    specialist: "synthesizer",
    prompt: packedPrompt,
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
  const maxWall = Math.max(5000, limits?.maxWallTimeMs ?? 30_000);
  const startedAt = Date.now();

  let calls = 0;
  const byId = new Map(graph.map((node) => [node.id, { ...node }]));

  while (true) {
    if (Date.now() - startedAt > maxWall) {
      throw new Error("Task graph timed out");
    }

    const ready = [...byId.values()].filter(
      (node) =>
        node.status === "pending" &&
        node.dependsOn.every((id) => {
          const dependencyStatus = byId.get(id)?.status;
          return dependencyStatus === "done" || dependencyStatus === "failed";
        }),
    );
    if (ready.length === 0) break;
    if (calls >= maxSubcalls) break;

    const remaining = maxSubcalls - calls;
    const batch = ready.slice(0, Math.max(1, remaining));
    await Promise.all(
      batch.map(async (node) => {
        if (calls >= maxSubcalls) return;
        calls += 1;
        node.status = "running";
        const dependencies = node.dependsOn
          .map((id) => byId.get(id))
          .filter((candidate): candidate is TaskNode => Boolean(candidate));
        try {
          const out = await runNode(node, dependencies);
          node.result = out.result.slice(0, 8_000);
          node.tokens = Math.min(Math.max(0, out.tokens), maxTokens);
          node.durationMs = out.durationMs;
          node.status = "done";
        } catch {
          node.status = "failed";
          node.tokens = 0;
        }
      }),
    );
  }

  // Mark unresolved nodes as failed when execution halts due to budgets/time.
  for (const node of byId.values()) {
    if (node.status === "pending" || node.status === "running") {
      node.status = "failed";
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
