/* eslint-disable no-console */

import { countFlashcardPairs, normalizeFlashcardDeck } from "../src/lib/flashcard-format";
import { parseQuiz } from "../src/lib/quiz-parser";

type JsonRecord = Record<string, unknown>;

type StreamEvent = {
  type?: string;
  content?: string;
  phase?: string;
  modelUsed?: string;
  citations?: Array<{ url?: string; title?: string }>;
  error?: string;
  [key: string]: unknown;
};

type ValidationResult = {
  name: string;
  ok: boolean;
  details: string;
};

const BASE_URL = (process.env.APP_URL ?? process.env.SMOKE_TEST_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/bootstrap`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`bootstrap returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Server at ${BASE_URL} did not become ready: ${String(lastError)}`);
}

async function readJson<T>(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function apiGet<T>(path: string) {
  const response = await fetch(`${BASE_URL}${path}`);
  return readJson<T>(response);
}

async function apiSend<T>(path: string, init: RequestInit) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return readJson<T>(response);
}

async function createChat(params: {
  mode: string;
  thinkingLevel?: "low" | "medium" | "high";
  routerMode?: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  usePersonalResources?: boolean;
  agentId?: string;
  title?: string;
}) {
  const data = await apiSend<{ chatId: string }>("/api/chats", {
    method: "POST",
    body: JSON.stringify({
      mode: params.mode,
      thinkingLevel: params.thinkingLevel ?? "low",
      routerMode: params.routerMode ?? "auto",
      manualModel: params.manualModel,
      usePersonalResources: params.usePersonalResources ?? true,
      agentId: params.agentId,
      title: params.title,
    }),
  });
  return data.chatId;
}

async function loadChat(chatId: string) {
  return apiGet<{
    chat: JsonRecord;
    messages: Array<JsonRecord>;
  }>(`/api/chats/${encodeURIComponent(chatId)}`);
}

async function streamChat(params: {
  chatId: string;
  message: string;
  mode: string;
  thinkingLevel?: "low" | "medium" | "high";
  routerMode?: "auto" | "manual" | "openrouter_auto";
  agentId?: string;
  usePersonalResources?: boolean;
}) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: params.chatId,
      message: params.message,
      mode: params.mode,
      thinkingLevel: params.thinkingLevel ?? "low",
      routerMode: params.routerMode ?? "auto",
      agentId: params.agentId,
      usePersonalResources: params.usePersonalResources ?? true,
      autoSettings: {
        enhancePrompt: false,
        autoModel: true,
        autoThinking: true,
        autoSearch: true,
        enhanceMode: "off",
        thinkingMode: "auto",
        searchMode: "auto",
      },
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`Chat stream failed: ${response.status} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: StreamEvent[] = [];
  let assistantText = "";
  const phases = new Set<string>();
  let modelUsed: string | undefined;
  let citations: Array<{ url?: string; title?: string }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as StreamEvent;
      events.push(event);
      if (event.type === "delta" && typeof event.content === "string") {
        assistantText += event.content;
      }
      if (event.type === "phase" && typeof event.phase === "string") {
        phases.add(event.phase);
      }
      if (typeof event.modelUsed === "string" && event.modelUsed.trim()) {
        modelUsed = event.modelUsed;
      }
      if (Array.isArray(event.citations)) {
        citations = event.citations;
      }
      if (event.type === "error") {
        throw new Error(typeof event.error === "string" ? event.error : "Unknown stream error");
      }
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer) as StreamEvent;
    events.push(event);
    if (event.type === "delta" && typeof event.content === "string") {
      assistantText += event.content;
    }
    if (event.type === "phase" && typeof event.phase === "string") {
      phases.add(event.phase);
    }
    if (typeof event.modelUsed === "string" && event.modelUsed.trim()) {
      modelUsed = event.modelUsed;
    }
    if (Array.isArray(event.citations)) {
      citations = event.citations;
    }
  }

  return {
    events,
    assistantText: assistantText.trim(),
    phases: [...phases],
    modelUsed,
    citations,
  };
}

async function listMemoryEntries() {
  const payload = await apiGet<{ entries: Array<JsonRecord> }>("/api/memory");
  return payload.entries;
}

async function confirmMemoryEntry(entryId: string) {
  await apiSend("/api/memory", {
    method: "PATCH",
    body: JSON.stringify({
      action: "confirm",
      entryId,
    }),
  });
}

async function createAgent() {
  const payload = await apiSend<{ agentId: string }>("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      name: "Validation Chemistry Agent",
      description: "Validation-only agent for live route testing.",
      subjectArea: "Chemistry",
      gradeLevel: "IB",
      systemPrompt:
        "Always begin your answer with 'AGENT-ALPHA:' and keep the answer concise but correct. If chemistry is relevant, mention it explicitly.",
      avatarEmoji: "🧪",
      category: "Science",
      preferredMode: "tutor",
      visibility: "private",
    }),
  });
  return payload.agentId;
}

function assertResult(condition: boolean, name: string, details: string): ValidationResult {
  return { name, ok: condition, details };
}

async function main() {
  const results: ValidationResult[] = [];

  await waitForServer();
  const bootstrap = await apiGet<{
    actor: { email: string; role: string };
    models: Array<JsonRecord>;
    agents: Array<JsonRecord>;
  }>("/api/bootstrap");

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Actor: ${bootstrap.actor.email} (${bootstrap.actor.role})`);
  console.log(`Models loaded: ${bootstrap.models.length}`);

  const simpleChatId = await createChat({
    mode: "general",
    thinkingLevel: "low",
    routerMode: "auto",
    title: "Live validation simple route",
  });
  const simpleRun = await streamChat({
    chatId: simpleChatId,
    mode: "general",
    thinkingLevel: "low",
    routerMode: "auto",
    message: "Answer in one sentence: what is 2 + 2?",
  });
  const simpleChat = await loadChat(simpleChatId);
  const simpleAssistant = [...simpleChat.messages].reverse().find((message) => message.role === "assistant");
  results.push(assertResult(
    Boolean(simpleRun.assistantText && simpleAssistant?.modelUsed),
    "simple-route",
    `model=${String(simpleAssistant?.modelUsed ?? simpleRun.modelUsed ?? "missing")} phases=${simpleRun.phases.join(",") || "none"}`,
  ));

  const researchChatId = await createChat({
    mode: "research",
    thinkingLevel: "high",
    routerMode: "auto",
    title: "Live validation research route",
  });
  const researchRun = await streamChat({
    chatId: researchChatId,
    mode: "research",
    thinkingLevel: "high",
    routerMode: "auto",
    message: "What happened in the most recent SpaceX Starship flight test? Cite sources and note the exact date.",
  });
  const researchChat = await loadChat(researchChatId);
  const researchAssistant = [...researchChat.messages].reverse().find((message) => message.role === "assistant");
  const researchRouteTrace = (researchAssistant?.routeTrace ?? {}) as { toolchain?: string[] };
  results.push(assertResult(
    Boolean(
      typeof researchAssistant?.modelUsed === "string"
      && (
        (Array.isArray(researchAssistant?.citations) && researchAssistant.citations.length > 0)
        || (Array.isArray(researchRun.citations) && researchRun.citations.length > 0)
        || (researchRouteTrace.toolchain ?? []).includes("web_search")
      ),
    ),
    "research-route",
    `model=${String(researchAssistant?.modelUsed ?? "missing")} citations=${Array.isArray(researchAssistant?.citations) ? researchAssistant.citations.length : researchRun.citations.length} toolchain=${(researchRouteTrace.toolchain ?? []).join(",") || "none"}`,
  ));

  const quizChatId = await createChat({
    mode: "quiz",
    thinkingLevel: "medium",
    routerMode: "auto",
    title: "Live validation quiz mode",
  });
  await streamChat({
    chatId: quizChatId,
    mode: "quiz",
    thinkingLevel: "medium",
    routerMode: "auto",
    message: "Create exactly 3 multiple-choice quiz questions about photosynthesis with answers and explanations.",
  });
  const quizChat = await loadChat(quizChatId);
  const quizAssistant = [...quizChat.messages].reverse().find((message) => message.role === "assistant");
  const quizQuestions = parseQuiz(String(quizAssistant?.content ?? ""));
  results.push(assertResult(
    quizQuestions.length >= 3,
    "quiz-mode",
    `parsed_questions=${quizQuestions.length}`,
  ));

  const flashcardChatId = await createChat({
    mode: "flashcard",
    thinkingLevel: "medium",
    routerMode: "auto",
    title: "Live validation flashcards",
  });
  await streamChat({
    chatId: flashcardChatId,
    mode: "flashcard",
    thinkingLevel: "medium",
    routerMode: "auto",
    message: "Create 4 flashcards about mitochondria.",
  });
  const flashcardChat = await loadChat(flashcardChatId);
  const flashcardAssistant = [...flashcardChat.messages].reverse().find((message) => message.role === "assistant");
  const flashcardCount = countFlashcardPairs(normalizeFlashcardDeck(String(flashcardAssistant?.content ?? "")));
  results.push(assertResult(
    flashcardCount >= 4,
    "flashcard-mode",
    `flashcard_pairs=${flashcardCount}`,
  ));

  const beforeMemory = await listMemoryEntries();
  const memoryChatId = await createChat({
    mode: "general",
    thinkingLevel: "low",
    routerMode: "auto",
    title: "Live validation memory",
  });
  await streamChat({
    chatId: memoryChatId,
    mode: "general",
    thinkingLevel: "low",
    routerMode: "auto",
    message: "Remember that I prefer concise step-by-step explanations with one worked example.",
  });
  const afterMemory = await listMemoryEntries();
  const newMemoryEntry = afterMemory.find((entry) => !beforeMemory.some((previous) => previous._id === entry._id));
  if (newMemoryEntry?._id) {
    await confirmMemoryEntry(String(newMemoryEntry._id));
  }

  const recallChatId = await createChat({
    mode: "general",
    thinkingLevel: "low",
    routerMode: "auto",
    title: "Live validation memory recall",
  });
  const recallRun = await streamChat({
    chatId: recallChatId,
    mode: "general",
    thinkingLevel: "low",
    routerMode: "auto",
    message: "Before you answer, say what you remember about how I prefer to learn. Then explain what a derivative is.",
  });
  const memoryRecallOkay =
    /step[- ]by[- ]step|worked example|concise/i.test(recallRun.assistantText)
    || Boolean(newMemoryEntry?._id);
  results.push(assertResult(
    memoryRecallOkay,
    "memory-flow",
    `new_entry=${String(newMemoryEntry?._id ?? "none")} recall_excerpt=${recallRun.assistantText.slice(0, 140)}`,
  ));

  const agentId = await createAgent();
  const agentChatId = await createChat({
    mode: "tutor",
    thinkingLevel: "low",
    routerMode: "auto",
    agentId,
    title: "Live validation agent route",
  });
  const agentRun = await streamChat({
    chatId: agentChatId,
    mode: "tutor",
    thinkingLevel: "low",
    routerMode: "auto",
    agentId,
    message: "Explain balancing chemical equations in two short sentences.",
  });
  results.push(assertResult(
    agentRun.assistantText.startsWith("AGENT-ALPHA:"),
    "agent-flow",
    agentRun.assistantText.slice(0, 140),
  ));

  console.log("\nValidation results");
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.details}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error("Live validation failed:", error);
  process.exitCode = 1;
});
