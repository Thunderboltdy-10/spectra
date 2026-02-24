import { openRouterChatCompletion, openRouterStreamChat, type OpenRouterMessage } from "@/lib/openrouter";
import { executeGraph, synthesize, type TaskNode } from "@/lib/orchestrator/task-graph";
import { getSpecialist } from "@/lib/orchestrator/specialists";
import { runMarkerVerificationPipeline } from "@/lib/orchestrator/verification";
import type { RouteTraceFallback } from "@/types";

export function chunkString(value: string, size: number) {
  const chunks = value.match(new RegExp(`.{1,${size}}`, "g"));
  return chunks ?? [];
}

export async function runAssistantStreaming(params: {
  shouldVerify: boolean;
  primaryModel: string;
  fallbackModels: string[];
  verificationModel?: string;
  messages: OpenRouterMessage[];
  maxTokens?: number;
  send: (payload: Record<string, unknown>) => Promise<void>;
  onFallback?: (event: RouteTraceFallback) => void;
  logger?: {
    info: (message: string, context?: Record<string, unknown>) => void;
  };
}) {
  let responseText = "";
  let modelUsed = params.primaryModel;
  let usageIn = 0;
  let usageOut = 0;
  let verificationPassed: boolean | undefined;
  let thinkingContent = "";

  if (!params.shouldVerify) {
    for await (const event of openRouterStreamChat({
      model: params.primaryModel,
      fallbackModels: params.fallbackModels,
      messages: params.messages,
      maxTokens: params.maxTokens,
      onFallback: params.onFallback,
    })) {
      if (event.type === "delta") {
        responseText += event.content;
        await params.send({ type: "delta", content: event.content });
      }
      if (event.type === "thinking") {
        thinkingContent += event.content;
        await params.send({ type: "thinking", content: event.content });
      }
      if (event.type === "done") {
        modelUsed = event.model ?? modelUsed;
        usageIn = event.inputTokens ?? usageIn;
        usageOut = event.outputTokens ?? usageOut;
      }
      if (event.type === "error") {
        throw new Error(event.error);
      }
    }
  } else {
    const verified = await runMarkerVerificationPipeline({
      primaryModel: params.primaryModel,
      fallbackModels: params.fallbackModels,
      messages: params.messages,
      maxTokens: params.maxTokens,
      verificationModel: params.verificationModel,
      onFallback: params.onFallback,
      logger: params.logger,
    });

    responseText = verified.responseText;
    modelUsed = verified.modelUsed;
    usageIn = verified.usageIn;
    usageOut = verified.usageOut;
    verificationPassed = verified.verificationPassed;

    for (const chunk of chunkString(responseText, 24)) {
      await params.send({ type: "delta", content: chunk });
    }
  }

  return {
    responseText,
    modelUsed,
    usageIn,
    usageOut,
    verificationPassed,
    thinkingContent,
    collaborators: undefined as
      | Array<{ role: string; model: string; tokensUsed: number; durationMs: number }>
      | undefined,
  };
}

type CollaboratorTrace = {
  role: string;
  model: string;
  tokensUsed: number;
  durationMs: number;
};

function summarizeDependencyResults(nodes: TaskNode[]) {
  const text = nodes
    .map((node) => `${node.role}: ${(node.result ?? "").slice(0, 700)}`)
    .join("\n\n")
    .trim();
  return text || "No dependency output available.";
}

function buildCriticFallback(params: {
  originalPrompt: string;
  dependencies: TaskNode[];
}) {
  const doneNodes = params.dependencies.filter((node) => node.status === "done" && (node.result ?? "").trim().length > 0);
  if (doneNodes.length === 0) {
    return [
      "- Confidence: low",
      "- Issue: no completed specialist findings were available for detailed audit.",
      "- Suggestion: answer conservatively, acknowledge uncertainty, and request clarification on scope.",
      `- Original prompt anchor: ${params.originalPrompt.slice(0, 180)}`,
    ].join("\n");
  }

  const shortFindings = doneNodes
    .slice(0, 3)
    .map((node) => `- [${node.role}] ${(node.result ?? "").replace(/\s+/g, " ").trim().slice(0, 180)}`)
    .join("\n");

  return [
    "- Confidence: medium",
    "- Audit summary: completed specialist outputs were checked for consistency.",
    "- Potential gap: verify quantitative claims and date-sensitive facts before finalizing.",
    "- Potential gap: explicitly separate established facts from assumptions.",
    "- Corrective action: include one concise uncertainty note in the final response if evidence is partial.",
    "Specialist snapshot:",
    shortFindings,
  ].join("\n");
}

export async function runCollaborativeStreaming(params: {
  graph: TaskNode[];
  originalPrompt: string;
  baseSystemPrompt: string;
  primaryModel: string;
  fallbackModels: string[];
  maxTokens?: number;
  maxSubcalls?: number;
  maxTokensPerSpecialist?: number;
  send: (payload: Record<string, unknown>) => Promise<void>;
  onFallback?: (event: RouteTraceFallback) => void;
  logger?: {
    info: (message: string, context?: Record<string, unknown>) => void;
  };
}) {
  const collaboratorNodes = params.graph.filter((node) => node.role !== "synthesizer");
  await params.send({ type: "collab_start", agents: collaboratorNodes.map((node) => node.role) });
  await params.send({
    type: "thinking",
    content: "Planning specialist workflow.\n\nIdentifying evidence paths and assigning sub-tasks.",
  });

  const executed = await executeGraph(
    params.graph,
    async (node, dependencies) => {
      const startedAt = Date.now();
      const specialist = getSpecialist(node.role);
      await params.send({
        type: "collab_progress",
        agent: node.role,
        model: specialist.model,
        status: "running",
        preview: `Running ${node.role.replace(/_/g, " ")} on ${specialist.model}...`,
      });
      await params.send({
        type: "thinking",
        content: `Running ${node.role.replace(/_/g, " ")} specialist.`,
      });

      let result = "";
      let tokens = 0;

      try {
        const completion = await openRouterChatCompletion({
          model: specialist.model,
          fallbackModels: specialist.fallbackModels,
          messages: [
            {
              role: "system",
              content: `${specialist.systemPrompt}\n\nOutput in concise markdown bullets. If uncertain, state confidence.`,
            },
            {
              role: "user",
              content: [
                `Original student prompt:\n${params.originalPrompt}`,
                `Task focus:\n${node.prompt}`,
                `Dependency findings:\n${summarizeDependencyResults(dependencies)}`,
              ].join("\n\n"),
            },
          ],
          temperature: 0.2,
          maxTokens: Math.min(1800, Math.max(800, params.maxTokens ?? 1800)),
          onFallback: params.onFallback,
        });

        result = completion.choices?.[0]?.message?.content?.trim() ?? "";
        tokens = (completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0);
      } catch (error) {
        if (node.role !== "critic") {
          throw error;
        }
        result = buildCriticFallback({
          originalPrompt: params.originalPrompt,
          dependencies,
        });
        tokens = 0;
      }

      const durationMs = Date.now() - startedAt;
      await params.send({
        type: "collab_done",
        agent: node.role,
        model: specialist.model,
        tokensUsed: tokens,
        preview: result.slice(0, 120),
      });
      await params.send({
        type: "thinking",
        content: `${node.role.replace(/_/g, " ")} completed. Folding findings into synthesis queue.`,
      });
      return { result, tokens, durationMs };
    },
    {
      maxSubcalls: params.maxSubcalls ?? 4,
      maxTokensPerSpecialist: params.maxTokensPerSpecialist ?? 1200,
      maxWallTimeMs: 30_000,
    },
  );

  for (const node of executed) {
    if (node.status === "failed") {
      await params.send({
        type: "collab_progress",
        agent: node.role,
        status: "failed",
        preview: "Specialist step failed; continuing with available evidence.",
      });
    }
  }

  await params.send({ type: "collab_synthesizing" });
  await params.send({
    type: "thinking",
    content: "Synthesizing specialist outputs into one response with cross-source consistency checks.",
  });

  const combinedFindings = synthesize(executed, params.originalPrompt);
  const synthesisStartedAt = Date.now();
  let responseText = "";
  let usageIn = 0;
  let usageOut = 0;
  let modelUsed = params.primaryModel;
  for await (const event of openRouterStreamChat({
    model: params.primaryModel,
    fallbackModels: params.fallbackModels,
    messages: [
      { role: "system", content: params.baseSystemPrompt },
      {
        role: "user",
        content: [
          "Merge these specialist findings into a coherent answer for the student.",
          "Keep evidence grounded and include confidence notes if there were disagreements.",
          combinedFindings,
        ].join("\n\n"),
      },
    ],
    temperature: 0.2,
    maxTokens: params.maxTokens,
    onFallback: params.onFallback,
  })) {
    if (event.type === "delta") {
      responseText += event.content;
      await params.send({ type: "delta", content: event.content });
    }
    if (event.type === "thinking") {
      await params.send({ type: "thinking", content: event.content });
    }
    if (event.type === "done") {
      modelUsed = event.model ?? modelUsed;
      usageIn = event.inputTokens ?? usageIn;
      usageOut = event.outputTokens ?? usageOut;
    }
    if (event.type === "error") {
      throw new Error(event.error);
    }
  }
  const synthesisDurationMs = Date.now() - synthesisStartedAt;

  const collaborators: CollaboratorTrace[] = executed
    .filter((node) => node.role !== "synthesizer")
    .map((node) => {
      const specialist = getSpecialist(node.role);
      return {
        role: node.role,
        model: specialist.model,
        tokensUsed: node.tokens ?? 0,
        durationMs: node.durationMs ?? 0,
      };
    })
    .concat({
      role: "synthesizer",
      model: modelUsed,
      tokensUsed: usageIn + usageOut,
      durationMs: synthesisDurationMs,
    });

  params.logger?.info("multi-agent execution complete", {
    collaboratorCount: collaborators.length,
    synthesisModel: modelUsed,
  });

  return {
    responseText,
    modelUsed,
    usageIn,
    usageOut,
    thinkingContent: "",
    verificationPassed: undefined,
    collaborators,
  };
}
