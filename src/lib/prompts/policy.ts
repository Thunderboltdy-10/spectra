import type { Citation, PackGuidelines, StudyMode } from "@/types";

export type TutorGate = {
  allowFinalSolution: boolean;
  attemptCount: number;
  hasReflection: boolean;
};

export function inferAttempt(text: string) {
  const normalized = text.trim().toLowerCase();
  if (normalized.length < 40) return false;
  const markers = ["i tried", "my approach", "therefore", "because", "equation", "substitute", "=", "->"];
  return markers.some((marker) => normalized.includes(marker));
}

export function inferReflection(text: string) {
  const normalized = text.trim().toLowerCase();
  const markers = ["i learned", "next time", "my mistake", "i realize", "misconception"];
  return markers.some((marker) => normalized.includes(marker));
}

export function tutorGate(attemptCount: number, hasReflection: boolean): TutorGate {
  return {
    attemptCount,
    hasReflection,
    allowFinalSolution: attemptCount >= 2 && hasReflection,
  };
}

export function buildSystemPrompt(params: {
  mode: StudyMode;
  strictness: "hard" | "medium" | "soft";
  guidelines?: PackGuidelines;
  sourceBlock?: string;
  gate: TutorGate;
  agent?: {
    name: string;
    description: string;
    systemPrompt: string;
    guidelinesSummary?: string;
    guidelinesTopicMap?: string[];
  };
  memoryProfile?: string;
  contextSummary?: string;
  searchBlock?: string;
  explainDepth?: "introductory" | "intermediate" | "advanced";
  quizDifficultyLevel?: number;
}) {
  const tutorRules =
    params.mode === "tutor"
      ? `Tutor mode policy:
- Use Socratic questioning first.
- Strictness: ${params.strictness}.
- Attempts so far: ${params.gate.attemptCount}.
- Reflection provided: ${params.gate.hasReflection}.
- Allow full worked solution now: ${params.gate.allowFinalSolution}.
- If full solution is not allowed, do NOT give the final answer; give one next step and one question.
- Always include one misconception check.`
      : "";

  const markerRules =
    params.mode === "marker"
      ? "Marker mode policy:\n- Provide rubric-like breakdown and score band.\n- Explain what earns marks and what loses marks.\n- Give 3 targeted drill questions.\n- Cite sources where available and avoid unsupported factual claims."
      : "";

  const scaffoldRules =
    params.mode === "exam"
      ? `Exam mode scaffold:
- Generate a short timed mini-paper and expectations.
- Use clear mark allocations and command verbs.
- After questions, provide a compact self-check rubric.`
    : params.mode === "draft_coach"
        ? `Draft Coach scaffold:
- Focus on structure, rubric fit, and concise actionable feedback.
- Provide revision pass order: thesis, evidence, paragraph coherence, style.`
        : "";

  const quizRules =
    params.mode === "quiz"
      ? `Quiz mode policy:
- Generate quiz questions with 4 options (A, B, C, D) each.
- Format each question as: "Q1. [question text]\\nA) [option]\\nB) [option]\\nC) [option]\\nD) [option]\\nCorrect: [letter]"
- Include one-line feedback per answer to reinforce retrieval practice.
- After listing all questions, provide a section "## Answers & Explanations" with the correct answer and brief explanation for each.
- Generate 5 questions by default unless the student specifies a number.
- Adaptive difficulty level: ${Math.max(1, Math.min(5, params.quizDifficultyLevel ?? 3))}.
- Difficulty guide:
  - Level 1-2: recall and recognition.
  - Level 3: application questions.
  - Level 4-5: analysis and evaluation.`
      : "";

  const flashcardRules =
    params.mode === "flashcard"
      ? `Flashcard mode policy:
- Generate flashcards as FRONT/BACK pairs.
- Format each card as: "FRONT: [question or term]\\nBACK: [answer or definition]"
- Keep each BACK concise (<55 words) and include one memory cue.
- Generate 5-10 cards per request unless specified otherwise.`
      : "";

  const researchRules =
    params.mode === "research"
      ? `Research mode policy:
- Provide comprehensive analysis with clear headings and structure.
- Include evidence, examples, and reasoning for claims.
- Present multiple perspectives where relevant.
- Include a short evidence matrix table with: claim | source | confidence.
- Include a "Source reliability scan" section with confidence notes.
- End with a clear conclusion or summary of findings.`
      : "";

  const explainRules =
    params.mode === "explain"
      ? `Explain mode policy:
- Use the Feynman technique.
- Start simple, then build complexity gradually.
- Detected depth: ${params.explainDepth ?? "intermediate"}.
- Introductory depth: use analogies, everyday language, and visual descriptions.
- Intermediate depth: include technical terms with concise definitions and worked examples.
- Advanced depth: include formal notation, edge cases, and research connections.
- End with a short "teach it back" prompt for the student.`
      : "";

  const generalRules =
    params.mode === "general"
      ? `General mode policy:
- Be helpful and pedagogical.
- Cite sources when relevant and available.
- Adapt to the student's needs and question type.`
      : "";

  const agentRules = params.agent
    ? `Agent profile:
- Name: ${params.agent.name}
- Description: ${params.agent.description}
- Custom behavior: ${params.agent.systemPrompt}
- Agent guidelines summary: ${params.agent.guidelinesSummary ?? "Not available"}
- Agent topics: ${(params.agent.guidelinesTopicMap ?? []).join(", ") || "Not available"}`
    : "";

  const memoryBlock = params.memoryProfile?.trim()
    ? `STUDENT PROFILE (use to personalize your responses):\n${params.memoryProfile}`
    : "";

  const contextSummary = params.contextSummary?.trim()
    ? `COMPACT CHAT SUMMARY:\n${params.contextSummary}`
    : "";

  const searchBlock = params.searchBlock?.trim()
    ? `WEB SEARCH RESULTS:\n${params.searchBlock}`
    : "";

  const guidelines = params.guidelines ?? {
    summary: "General school guidance.",
    topicMap: [],
    rubricHints: [],
    misconceptions: [],
  };

  return `You are a school tutor and marker for students and teachers.
You must follow study mode policy exactly and stay pedagogical.
Always ground claims in SOURCES when available.
Never claim a source you did not receive.

COURSE GUIDELINES:
Summary: ${guidelines.summary}
Topic map: ${guidelines.topicMap.join(", ") || "Not yet generated"}
Rubric hints: ${guidelines.rubricHints.join(" | ") || "Not yet generated"}
Common misconceptions: ${guidelines.misconceptions.join(" | ") || "Not yet generated"}

${memoryBlock}
${contextSummary}
${searchBlock}
${tutorRules}
${markerRules}
${scaffoldRules}
${quizRules}
${flashcardRules}
${researchRules}
${explainRules}
${generalRules}
${agentRules}

Output format:
1) Short answer or next step.
2) Explanation.
3) Include compact inline numeric references when sourcing facts, like [1], [2]. Do not include filename-style brackets like [filename p.X].
4) Why this response (one sentence).

SOURCES:
${params.sourceBlock || "No retrieved sources."}`;
}

export function enforceCitationFallback(citations: Citation[]): Citation[] {
  return citations;
}

export function markerVerificationPrompt(response: string) {
  return `You are a strict verifier. Check the assistant response for:
- Has citations section.
- No unsupported factual claims.
- Respects marker mode rubric breakdown requirement.
Reply ONLY in JSON: {"pass": boolean, "reason": string}.

RESPONSE:
${response}`;
}

export function checkPromptPolicyResponse(params: {
  mode: StudyMode;
  response: string;
}) {
  const text = params.response.toLowerCase();
  if (params.mode === "tutor") {
    return text.includes("misconception") && text.includes("?");
  }
  if (params.mode === "marker") {
    return text.includes("score") && text.includes("practice") && text.includes("citation");
  }
  return true;
}
