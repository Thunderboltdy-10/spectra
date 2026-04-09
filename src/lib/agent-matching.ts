import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterEmbeddingRequest } from "@/lib/openrouter";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
  "what",
  "why",
  "who",
  "when",
  "where",
]);

export type AgentMatchCandidate = {
  _id: string;
  name: string;
  category?: string;
  description?: string;
  subjectArea?: string;
  gradeLevel?: string;
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
  semanticText?: string;
  semanticEmbedding?: number[];
};

export type AgentMatchResult = {
  agentId: string;
  agentName: string;
  score: number;
  reason: string;
  method: "semantic" | "lexical_fallback" | "linked_agent";
  fallbackUsed: boolean;
  metadataScoreBreakdown?: {
    semantic: number;
    metadataBoost: number;
    lexical: number;
  };
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function overlapScore(messageTokens: string[], candidateTokens: string[]) {
  if (messageTokens.length === 0 || candidateTokens.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  const hits = messageTokens.filter((token) => candidateSet.has(token)).length;
  return hits / messageTokens.length;
}

function topicCoverageScore(message: string, messageTokens: string[], topics: string[]) {
  if (topics.length === 0) return 0;

  const normalizedMessage = normalize(message);
  const messageTokenSet = new Set(messageTokens);
  let hits = 0;

  for (const topic of topics) {
    const cleanTopic = normalize(topic);
    if (!cleanTopic) continue;

    if (normalizedMessage.includes(cleanTopic)) {
      hits += 1;
      continue;
    }

    const topicTokens = tokenize(cleanTopic);
    const tokenHits = topicTokens.filter((token) => messageTokenSet.has(token)).length;
    const tokenCoverage = topicTokens.length > 0 ? tokenHits / topicTokens.length : 0;
    if (tokenCoverage >= 0.6) {
      hits += 0.75;
    } else if (tokenCoverage >= 0.4) {
      hits += 0.45;
    }
  }

  return Math.min(1, hits / Math.max(1, Math.min(4, topics.length)));
}

function contributorLabel(scores: { topics: number; category: number; name: number; description: number }) {
  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const winner = ordered[0]?.[0] ?? "topics";
  if (winner === "category") return "Matched your subject category";
  if (winner === "name") return "Matched by agent name";
  if (winner === "description") return "Matched by agent description";
  return "Matched by agent topic map";
}

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

function buildAgentSemanticText(agent: AgentMatchCandidate) {
  return [
    agent.name,
    agent.category,
    agent.subjectArea,
    agent.gradeLevel,
    agent.description,
    agent.guidelinesSummary,
    ...(agent.guidelinesTopicMap ?? []),
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

async function embedText(input: string) {
  const text = input.trim();
  if (!text) return null;
  const result = await openRouterEmbeddingRequest(text.slice(0, 3_000), MODEL_CONFIG.embedding);
  return result.embedding;
}

export async function buildAgentSemanticEmbeddings(agents: AgentMatchCandidate[]) {
  const updates = await Promise.all(
    agents.map(async (agent) => {
      if (Array.isArray(agent.semanticEmbedding) && agent.semanticEmbedding.length > 0) {
        return agent;
      }
      const semanticText = agent.semanticText ?? buildAgentSemanticText(agent);
      try {
        const semanticEmbedding = await embedText(semanticText);
        return semanticEmbedding ? { ...agent, semanticText, semanticEmbedding } : { ...agent, semanticText };
      } catch {
        return { ...agent, semanticText };
      }
    }),
  );
  return updates;
}

export async function matchAgentToMessage(
  message: string,
  agents: AgentMatchCandidate[],
  options?: {
    threshold?: number;
    linkedAgentId?: string | null;
    embeddingModelAvailable?: boolean;
  },
): Promise<AgentMatchResult | null> {
  const threshold = options?.threshold ?? 0.3;
  const cleanMessage = message.trim();
  if (!cleanMessage) return null;

  const linkedAgent = options?.linkedAgentId ? agents.find((agent) => agent._id === options.linkedAgentId) : undefined;
  if (linkedAgent) {
    return {
      agentId: linkedAgent._id,
      agentName: linkedAgent.name,
      score: 1,
      reason: "Using linked workspace agent",
      method: "linked_agent",
      fallbackUsed: false,
      metadataScoreBreakdown: {
        semantic: 1,
        metadataBoost: 0,
        lexical: 0,
      },
    };
  }

  const messageTokens = tokenize(cleanMessage);
  if (messageTokens.length === 0) return null;

  const normalizedMessage = normalize(cleanMessage);
  let queryEmbedding: number[] | null = null;
  let semanticReadyAgents = agents;
  if (options?.embeddingModelAvailable !== false) {
    try {
      queryEmbedding = await embedText(cleanMessage);
      semanticReadyAgents = await buildAgentSemanticEmbeddings(agents);
    } catch {
      queryEmbedding = null;
    }
  }

  let best: AgentMatchResult | null = null;

  for (const agent of semanticReadyAgents) {
    const topicScore = topicCoverageScore(cleanMessage, messageTokens, agent.guidelinesTopicMap ?? []);
    const categoryScore = overlapScore(messageTokens, tokenize(agent.category ?? ""));
    const nameScore = overlapScore(messageTokens, tokenize(agent.name));
    const descriptionScore = overlapScore(messageTokens, tokenize(agent.description ?? ""));
    const lexicalScore = Math.max(
      0,
      Math.min(1, topicScore * 0.55 + categoryScore * 0.2 + nameScore * 0.15 + descriptionScore * 0.1),
    );
    const metadataBoost = Math.min(
      0.22,
      (normalize(agent.subjectArea ?? "") && normalizedMessage.includes(normalize(agent.subjectArea ?? "")) ? 0.08 : 0)
      + (normalize(agent.gradeLevel ?? "") && normalizedMessage.includes(normalize(agent.gradeLevel ?? "")) ? 0.04 : 0)
      + (normalize(agent.guidelinesSummary ?? "") && normalizedMessage.includes(normalize(agent.guidelinesSummary ?? "").slice(0, 40)) ? 0.1 : 0),
    );
    const semanticScore =
      queryEmbedding && Array.isArray(agent.semanticEmbedding) && agent.semanticEmbedding.length > 0
        ? Math.max(0, cosineSimilarity(queryEmbedding, agent.semanticEmbedding))
        : 0;
    const score = queryEmbedding
      ? Math.max(0, Math.min(1, semanticScore * 0.82 + metadataBoost + lexicalScore * 0.08))
      : Math.max(0, Math.min(1, lexicalScore));

    if (score < threshold) continue;

    const candidate: AgentMatchResult = {
      agentId: agent._id,
      agentName: agent.name,
      score,
      reason: queryEmbedding
        ? semanticScore >= lexicalScore
          ? "Matched by semantic similarity across agent metadata"
          : contributorLabel({ topics: topicScore, category: categoryScore, name: nameScore, description: descriptionScore })
        : contributorLabel({ topics: topicScore, category: categoryScore, name: nameScore, description: descriptionScore }),
      method: queryEmbedding ? "semantic" : "lexical_fallback",
      fallbackUsed: !queryEmbedding,
      metadataScoreBreakdown: {
        semantic: semanticScore,
        metadataBoost,
        lexical: lexicalScore,
      },
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}
