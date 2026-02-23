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
  guidelinesTopicMap?: string[];
};

export type AgentMatchResult = {
  agentId: string;
  agentName: string;
  score: number;
  reason: string;
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

export function matchAgentToMessage(
  message: string,
  agents: AgentMatchCandidate[],
  threshold = 0.3,
): AgentMatchResult | null {
  const cleanMessage = message.trim();
  if (!cleanMessage) return null;

  const messageTokens = tokenize(cleanMessage);
  if (messageTokens.length === 0) return null;

  let best: AgentMatchResult | null = null;

  for (const agent of agents) {
    const topicScore = topicCoverageScore(cleanMessage, messageTokens, agent.guidelinesTopicMap ?? []);
    const categoryScore = overlapScore(messageTokens, tokenize(agent.category ?? ""));
    const nameScore = overlapScore(messageTokens, tokenize(agent.name));
    const descriptionScore = overlapScore(messageTokens, tokenize(agent.description ?? ""));

    let score = topicScore * 0.55 + categoryScore * 0.2 + nameScore * 0.15 + descriptionScore * 0.1;
    if (normalize(cleanMessage).includes(normalize(agent.name))) {
      score += 0.08;
    }
    score = Math.max(0, Math.min(1, score));

    if (score < threshold) continue;

    const candidate: AgentMatchResult = {
      agentId: agent._id,
      agentName: agent.name,
      score,
      reason: contributorLabel({ topics: topicScore, category: categoryScore, name: nameScore, description: descriptionScore }),
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}
