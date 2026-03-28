import { describe, expect, it } from "vitest";
import { runAutoSettingsPipeline } from "@/lib/auto-settings";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { buildRoutePlan } from "@/lib/orchestrator/route-plan";
import { buildResearchEvidenceBlock, maybeSearchWeb } from "@/lib/orchestrator/retrieval";
import { buildTaskGraph, shouldUseMultiAgent } from "@/lib/orchestrator/task-graph";
import { selectModelForPhase } from "@/lib/routing/phase-router";
import type { CatalogModelEntry } from "@/lib/model-selection";
import type { StudyMode, ThinkingLevel, SpendingTier } from "@/types";

const RUN_LIVE = process.env.LIVE_ROUTING_TEST === "1";
const HAS_OPENROUTER = Boolean(process.env.OPENROUTER_API_KEY);
const HAS_TAVILY = Boolean(process.env.TAVILY_API_KEY);

type LiveScenario = {
  name: string;
  mode: StudyMode;
  message: string;
  currentThinkingLevel: ThinkingLevel;
  spendingTier?: SpendingTier;
  searchMode?: "auto" | "on" | "off";
};

function selectedModelAgeDays(model: CatalogModelEntry | undefined) {
  if (!model) return undefined;
  if (typeof model.createdAt === "number" && Number.isFinite(model.createdAt)) {
    return Math.max(0, (Date.now() - model.createdAt) / (24 * 60 * 60 * 1000));
  }
  if (typeof model.releaseDate === "string" && model.releaseDate.trim()) {
    const ts = Date.parse(model.releaseDate);
    if (Number.isFinite(ts) && ts > 0) {
      return Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
    }
  }
  return undefined;
}

async function runLiveScenario(input: LiveScenario) {
  const catalogSnapshot = await getLiveCatalogSnapshot({ forceRefresh: true });
  const catalog = catalogSnapshot.models.filter((model) => model.modelId !== "openrouter/auto");
  expect(catalog.length).toBeGreaterThan(0);

  const auto = await runAutoSettingsPipeline({
    message: input.message,
    mode: input.mode,
    hasAttachments: false,
    isFirstMessage: true,
    currentThinkingLevel: input.currentThinkingLevel,
    spendingTier: input.spendingTier ?? "normal",
    autoEnhancePrompt: true,
    autoThinking: true,
    autoSearch: true,
    enhanceMode: "auto",
    thinkingMode: "auto",
    searchMode: input.searchMode ?? "auto",
  });

  const routePlan = buildRoutePlan({
    message: auto.message,
    mode: input.mode,
    selectedMode: input.mode,
    hasAttachments: false,
    hasAgent: false,
    hasPack: false,
    hasPersonalResources: false,
    hasAgentResources: false,
    autoSearchEnabled: auto.searchEnabled,
    thinkingLevel: auto.thinkingLevel,
    complexity: auto.complexity,
    assignmentLevel: auto.assignmentLevel,
  });

  const routeDecision = selectModelForPhase({
    phaseId: "analysis",
    phaseLabel: input.name,
    mode: input.mode,
    routerMode: "auto",
    spendingTier: input.spendingTier ?? "normal",
    thinkingLevel: routePlan.responseBudget === "simple" ? "low" : auto.thinkingLevel === "high" ? "high" : "medium",
    stakes:
      routePlan.responseBudget === "deep"
        ? "high"
        : routePlan.responseBudget === "simple"
          ? "low"
          : "medium",
    messageLength: auto.message.length,
    needsSearch: routePlan.shouldUseWebSearch,
    hasAttachments: false,
    requiredCapabilities: routePlan.candidateModelRequirements.required,
    preferredCapabilities: routePlan.candidateModelRequirements.preferred,
    requestClass: auto.requestClass,
    assignmentLevel: auto.assignmentLevel,
    estimatedInputTokens: routePlan.contextWindowStrategy.estimatedInputTokens,
    estimatedOutputTokens: routePlan.contextWindowStrategy.estimatedOutputTokens,
    desiredContextTokens: routePlan.contextWindowStrategy.desiredContextTokens,
    preferLargeContext: routePlan.contextWindowStrategy.preferLargeContext,
    modelCatalog: catalog,
    seedKey: `live-routing:${input.name}:${input.message}`,
  });

  const selectedEntry = catalog.find((model) => model.modelId === routeDecision.selectedModel);
  const ageDays = selectedModelAgeDays(selectedEntry);

  expect(routeDecision.selectedModel).not.toContain(":online");
  if (typeof ageDays === "number") {
    expect(ageDays).toBeLessThanOrEqual(90);
  }

  const searchResult = routePlan.shouldUseWebSearch
    ? await maybeSearchWeb(auto.message, auto.thinkingLevel, {
        spendingTier: input.spendingTier ?? "normal",
        modelCatalog: catalog,
        searchPlan: routePlan.searchPlan,
      })
    : null;

  const multiAgentRecommended = shouldUseMultiAgent(auto.message, input.mode, auto.complexity);
  const taskGraph = buildTaskGraph(auto.message, input.mode, {
    searchEnabled: routePlan.shouldUseWebSearch,
    searchBlock: searchResult?.text,
    includeCritic: true,
  });

  const evidenceBlock = searchResult
    ? buildResearchEvidenceBlock({
        citations: [],
        searchSources: searchResult.sources,
      })
    : "";

  const messages = [
    {
      role: "system",
      content: [
        "You are Spectra, an AI workspace assistant for students.",
        "Answer directly and keep the response concise but useful.",
        `Today is ${new Date().toISOString().slice(0, 10)}.`,
        searchResult?.text ? `Web research briefing:\n${searchResult.text}` : "",
        evidenceBlock,
      ].filter(Boolean).join("\n\n"),
    },
    {
      role: "user",
      content: auto.message,
    },
  ] as const;

  const completion = await openRouterChatCompletion({
    model: routeDecision.selectedModel,
    fallbackModels: routeDecision.fallbackModels,
    messages: [...messages],
    maxTokens: routePlan.responseBudget === "deep" ? 1100 : 700,
    reasoningEffort:
      auto.thinkingLevel === "high"
        ? "high"
        : auto.thinkingLevel === "medium"
          ? "medium"
          : "low",
  });

  const content = completion.choices?.[0]?.message?.content ?? "";
  expect(typeof content).toBe("string");
  expect((content as string).trim().length).toBeGreaterThan(40);

  console.info(
    [
      `[live-routing] ${input.name}`,
      `selected=${routeDecision.selectedModel}`,
      `used=${completion.model ?? routeDecision.selectedModel}`,
      `search=${searchResult?.provider ?? "off"}`,
      `sources=${searchResult?.sources.length ?? 0}`,
      `multiAgent=${multiAgentRecommended ? "yes" : "no"}`,
      `graph=${taskGraph.map((node) => node.role).join(",")}`,
      `ageDays=${typeof ageDays === "number" ? ageDays.toFixed(1) : "unknown"}`,
    ].join(" | "),
  );

  return {
    auto,
    routePlan,
    routeDecision,
    selectedEntry,
    ageDays,
    searchResult,
    multiAgentRecommended,
    taskGraph,
    completion,
    content: content as string,
  };
}

describe.skipIf(!RUN_LIVE || !HAS_OPENROUTER)("live routing integration", () => {
  it("routes a standard student question to a current model and gets a real completion", async () => {
    const result = await runLiveScenario({
      name: "standard_help",
      mode: "general",
      message: "Explain ATP simply for an IB Biology student, with one short analogy.",
      currentThinkingLevel: "medium",
      searchMode: "off",
    });

    expect(result.routePlan.shouldUseWebSearch).toBe(false);
    expect(result.routeDecision.selectedModel).toBeTruthy();
  }, 120_000);

  it.skipIf(!HAS_TAVILY)("routes a current-events research prompt, performs search, and gets a grounded completion", async () => {
    const result = await runLiveScenario({
      name: "current_research",
      mode: "research",
      message: "What are the latest AI policy changes affecting schools this week? Summarize the main changes and mention the sources.",
      currentThinkingLevel: "high",
      searchMode: "on",
    });

    expect(result.routePlan.shouldUseWebSearch).toBe(true);
    expect(result.searchResult?.provider).toBe("tavily");
    expect(result.searchResult?.sources.length ?? 0).toBeGreaterThan(0);
  }, 180_000);

  it.skipIf(!HAS_TAVILY)("pushes a hard research memo through search and orchestration heuristics", async () => {
    const result = await runLiveScenario({
      name: "orchestrated_research_memo",
      mode: "research",
      message: [
        "Compare the latest AI policy changes for schools across the EU, UK, and US this month.",
        "I need a structured memo with: 1) regulatory changes, 2) operational risks for schools, 3) implementation checklist, 4) where the policies disagree.",
        "Use multiple perspectives, challenge weak evidence, and cite current sources.",
      ].join(" "),
      currentThinkingLevel: "high",
      searchMode: "on",
    });

    expect(result.routePlan.shouldUseWebSearch).toBe(true);
    expect(result.multiAgentRecommended).toBe(true);
    expect(result.taskGraph.some((node) => node.role === "workflow_planner")).toBe(true);
    expect(result.taskGraph.some((node) => node.role === "web_researcher")).toBe(true);
    expect(result.taskGraph.some((node) => node.role === "fact_checker")).toBe(true);
    expect(result.taskGraph.some((node) => node.role === "critic")).toBe(true);
    expect(result.taskGraph.some((node) => node.role === "synthesizer")).toBe(true);
    expect(result.searchResult?.provider).toBe("tavily");
    expect(result.searchResult?.sources.length ?? 0).toBeGreaterThan(0);
  }, 180_000);
});
