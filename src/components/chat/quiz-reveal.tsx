"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/chat/rich-text";
import { usePanel } from "@/context/panel-context";
import { parseQuiz, type ParsedQuizQuestion } from "@/lib/quiz-parser";

export type QuizQuestionResult = {
  id: string;
  prompt: string;
  selected?: string;
  correct?: string;
  isCorrect: boolean;
  explanation?: string;
};

export type QuizSubmitResult = {
  score: number;
  total: number;
  questions: QuizQuestionResult[];
  incorrectDetails: string[];
};

type QuizDifficulty = "easy" | "medium" | "hard";

type QuizRevealProps = {
  content: string;
  chatId?: string;
  difficulty?: QuizDifficulty;
  autoOpen?: boolean;
  onSubmitAnswers?: (result: QuizSubmitResult) => void;
  onFollowUp?: (message: string) => void;
  onModeChange?: (mode: string) => void;
};

function hashQuizContent(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function isQuizContent(content: string): boolean {
  const parsed = parseQuiz(content);
  return parsed.length >= 2 && parsed.every((question) => question.options.length >= 2);
}

function buildSubmission(questions: ParsedQuizQuestion[], answers: Record<string, string>): QuizSubmitResult {
  const results: QuizQuestionResult[] = questions.map((question) => {
    const selected = answers[question.id];
    const correct = question.correct;
    const isCorrect = Boolean(correct && selected && selected === correct);
    return {
      id: question.id,
      prompt: question.prompt,
      selected,
      correct,
      isCorrect,
      explanation: question.explanation,
    };
  });

  const score = results.filter((item) => item.isCorrect).length;
  const incorrectDetails = results
    .filter((item) => !item.isCorrect)
    .map((item) => `${item.id}: chose ${item.selected ?? "none"}, correct ${item.correct ?? "unknown"}`);

  return {
    score,
    total: questions.length,
    questions: results,
    incorrectDetails,
  };
}

export function QuizReveal({
  content,
  chatId,
  difficulty = "medium",
  autoOpen = false,
  onSubmitAnswers,
  onFollowUp,
  onModeChange,
}: QuizRevealProps) {
  const questions = useMemo(() => parseQuiz(content), [content]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const panelInstanceId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const { activeView, panelData, openPanel } = usePanel();

  const [aiExplanations, setAiExplanations] = useState<Record<string, string>>({});
  const [loadingExplanations, setLoadingExplanations] = useState(false);
  const storageKey = useMemo(() => `ai-school:quiz-progress:${hashQuizContent(content)}`, [content]);
  const panelOpen = activeView === "quiz" && panelData.quiz?.panelId === panelInstanceId;

  const score = useMemo(
    () =>
      submitted
        ? questions.filter((question) => question.correct && answers[question.id] === question.correct).length
        : 0,
    [answers, questions, submitted],
  );

  const fetchExplanations = useCallback(async (qs: ParsedQuizQuestion[], ans: Record<string, string>) => {
    if (!chatId) return; // Don't fetch without chatId
    setLoadingExplanations(true);
    try {
      const questionsPayload = qs.map((q) => ({
        question: q.prompt,
        selected: ans[q.id] ?? "none",
        correct: q.correct ?? "unknown",
        isCorrect: q.correct ? ans[q.id] === q.correct : false,
      }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId, // Pass chatId to avoid creating orphan chat
          mode: "general",
          message: `Explain each quiz answer briefly (1-2 sentences each). Questions:\n${questionsPayload
            .map((q, i) => `Q${i + 1}: ${q.question} (chose: ${q.selected}, correct: ${q.correct})`)
            .join("\n")}`,
          thinkingLevel: "low",
          routerMode: "auto",
          usePersonalResources: false,
          skipUserMessagePersist: true,
          autoSettings: { enhancePrompt: false, autoModel: true, autoThinking: false, autoSearch: false },
        }),
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const payload = JSON.parse(line) as { type: string; content?: string };
            if (payload.type === "delta" && payload.content) fullText += payload.content;
            if (payload.type === "done" && typeof payload.content === "string") fullText = payload.content;
          } catch { /* skip */ }
        }
      }
      // Parse explanations by Q number
      const explanationMap: Record<string, string> = {};
      for (let i = 0; i < qs.length; i++) {
        const qRegex = new RegExp(`Q${i + 1}[:.\\s]*(.+?)(?=Q${i + 2}[:.\\s]|$)`, "is");
        const match = fullText.match(qRegex);
        if (match?.[1]) {
          explanationMap[qs[i]!.id] = match[1].trim();
        }
      }
      setAiExplanations(explanationMap);
    } catch { /* ignore */ } finally {
      setLoadingExplanations(false);
    }
  }, [chatId]);

  useEffect(() => {
    setActiveIndex(0);
    setAiExplanations({});
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setSubmitted(false);
        setAnswers({});
        return;
      }
      const parsed = JSON.parse(raw) as { answers?: Record<string, string>; submitted?: boolean };
      setAnswers(parsed.answers ?? {});
      setSubmitted(Boolean(parsed.submitted));
    } catch {
      setSubmitted(false);
      setAnswers({});
    }
  }, [storageKey]);

  useEffect(() => {
    if (questions.length === 0) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          answers,
          submitted,
        }),
      );
    } catch {
      // Ignore storage failures.
    }
  }, [answers, questions.length, storageKey, submitted]);

  const openQuizPanel = useCallback(() => {
    openPanel("quiz", {
      quiz: {
        panelId: panelInstanceId,
        questions,
        answers,
        submitted,
        activeIndex,
        onSetIndex: setActiveIndex,
        onSelectAnswer: (questionId, letter) => {
          if (submitted) return;
          setAnswers((prev) => ({ ...prev, [questionId]: letter }));
        },
        onSubmit: () => {
          if (submitted) return;
          setSubmitted(true);
          onSubmitAnswers?.(buildSubmission(questions, answers));
          void fetchExplanations(questions, answers);
        },
      },
    });
  }, [
    activeIndex,
    answers,
    fetchExplanations,
    onSubmitAnswers,
    panelInstanceId,
    questions,
    submitted,
    openPanel,
  ]);

  useEffect(() => {
    if (!panelOpen) return;
    openQuizPanel();
  }, [openQuizPanel, panelOpen, submitted]);

  // Auto-open only for the latest quiz message to avoid stacked/flickering panels.
  useEffect(() => {
    if (autoOpen && questions.length > 0 && !submitted) {
      openQuizPanel();
    }
  }, [autoOpen, openQuizPanel, questions.length, submitted]);

  if (questions.length === 0) return null;

  const longQuiz = questions.length >= 3;
  const currentQuestion = questions[Math.min(activeIndex, Math.max(0, questions.length - 1))];
  const isLast = activeIndex >= questions.length - 1;

  function submitAnswers() {
    if (submitted) return;
    setSubmitted(true);
    onSubmitAnswers?.(buildSubmission(questions, answers));
    // Fetch AI explanations for incorrect answers
    void fetchExplanations(questions, answers);
  }

  function requestHarderQuiz() {
    onFollowUp?.("Create a harder quiz about the same topic with more challenging questions.");
  }

  function requestNewTopic() {
    onFollowUp?.("Suggest a related topic to quiz me on next.");
  }

  function requestExplanation() {
    const incorrectDetails = questions
      .filter((q) => answers[q.id] !== q.correct)
      .map((q) => `Q: "${q.prompt}" - chose "${answers[q.id] ?? "none"}" but correct was "${q.correct ?? "unknown"}"`);
    onFollowUp?.(`Explain why I got these wrong: ${incorrectDetails.join("; ")}`);
  }

  function requestRetry() {
    onFollowUp?.("Give me the same quiz again so I can retry.");
  }

  function switchToLearnMode() {
    const incorrectTopics = questions
      .filter((q) => answers[q.id] !== q.correct)
      .map((q) => q.prompt);
    onFollowUp?.(
      `I got ${score}/${questions.length}. Please teach me about the topics I got wrong: ${incorrectTopics.join(", ")}.`,
    );
    onModeChange?.("tutor");
  }

  function requestEasierQuiz() {
    onFollowUp?.("Create an easier version of this quiz with simpler questions.");
  }

  const scorePct = questions.length > 0 ? score / questions.length : 0;
  const isPerfect = score === questions.length;
  const isGood = scorePct > 0.7;
  const isLow = scorePct > 0.3 && !isGood;
  const difficultyLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  const difficultyBadgeClass =
    difficulty === "easy"
      ? "border-[color-mix(in_oklab,var(--success)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_15%,var(--bg-secondary))] text-[color-mix(in_oklab,var(--success)_85%,var(--text-primary))]"
      : difficulty === "hard"
        ? "border-[color-mix(in_oklab,var(--danger)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_12%,var(--bg-secondary))] text-[color-mix(in_oklab,var(--danger)_80%,var(--text-primary))]"
        : "border-[color-mix(in_oklab,var(--warning)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_15%,var(--bg-secondary))] text-[color-mix(in_oklab,var(--warning)_85%,var(--text-primary))]";
  // else: very low / zero

  if (longQuiz) {
    return (
      <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--mode-quiz)] px-2.5 py-1 text-xs font-medium text-white">
              Quiz - {questions.length} questions
            </span>
            <span className={`inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-medium ${difficultyBadgeClass}`}>
              Difficulty: {difficultyLabel}
            </span>
          </div>
          {submitted ? (
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {score}/{questions.length}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          This quiz opens in the unified right panel.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" onClick={openQuizPanel}>
            {panelOpen ? "Quiz Panel Open" : "Open Quiz Panel"}
          </Button>
          {!submitted ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Progress: {Object.keys(answers).length}/{questions.length}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--mode-quiz)] px-2.5 py-1 text-xs font-medium text-white">
          Quiz - {questions.length} questions
        </span>
        <span className={`inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-medium ${difficultyBadgeClass}`}>
          Difficulty: {difficultyLabel}
        </span>
        {submitted ? (
          <span className="text-sm font-medium">
            Score: {score}/{questions.length} ({Math.round((score / questions.length) * 100)}%)
          </span>
        ) : null}
      </div>

      {currentQuestion ? (
        <div className="card-entrance rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
          <div className="mb-3 flex items-start text-sm font-medium">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--mode-quiz)] text-xs text-white">
              {currentQuestion.id}
            </span>
            <RichText content={currentQuestion.prompt} className="flex-1 text-sm" />
          </div>
          <div className="space-y-2">
            {currentQuestion.options.map((option) => {
              const selected = answers[currentQuestion.id] === option.letter;
              const showCorrect = submitted && option.letter === currentQuestion.correct;
              const showWrong = submitted && selected && option.letter !== currentQuestion.correct;
              return (
                <button
                  key={`${currentQuestion.id}-${option.letter}`}
                  type="button"
                  disabled={submitted}
                  onClick={() => setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option.letter }))}
                  className={`quiz-option flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius-input)] border px-3 py-2.5 text-left text-sm transition disabled:cursor-default ${
                    showCorrect
                      ? "quiz-correct"
                      : showWrong
                        ? "quiz-incorrect"
                        : selected
                          ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--bg-primary))] ring-1 ring-[var(--accent-cyan)]/50"
                          : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                      selected
                        ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)] text-white"
                        : "border-[var(--border-default)]"
                    }`}
                  >
                    {option.letter}
                  </span>
                  <RichText content={option.text} className="flex-1 text-sm" />
                  {!submitted && selected ? (
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent-cyan)] bg-[var(--accent-cyan)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    </span>
                  ) : null}
                  {showCorrect ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : null}
                  {showWrong ? <XCircle className="h-4 w-4 text-[var(--danger)]" /> : null}
                </button>
              );
            })}
          </div>
          {submitted && (currentQuestion.explanation || aiExplanations[currentQuestion.id]) ? (
            <div className="mt-3 rounded-[var(--radius-input)] bg-[var(--bg-secondary)] p-2.5 text-xs text-[var(--text-secondary)]">
              <span>{answers[currentQuestion.id] === currentQuestion.correct ? "Correct! " : "Review: "}</span>
              <RichText content={currentQuestion.explanation || aiExplanations[currentQuestion.id] || ""} className="text-xs text-[var(--text-secondary)]" />
            </div>
          ) : submitted && loadingExplanations ? (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading AI explanation...
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div>
          {activeIndex > 0 ? (
            <Button type="button" variant="secondary" onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}>
              Back
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!submitted ? (
            <Button
              type="button"
              onClick={() => {
                if (isLast) {
                  submitAnswers();
                  return;
                }
                setActiveIndex((prev) => Math.min(questions.length - 1, prev + 1));
              }}
            >
              {isLast ? "Check Answers" : "Next"}
            </Button>
          ) : !isLast ? (
            <Button type="button" onClick={() => setActiveIndex((prev) => Math.min(questions.length - 1, prev + 1))}>
              Next
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1">
        {questions.map((question, index) => {
          const answered = Boolean(answers[question.id]);
          return (
            <div
              key={question.id}
              className={`h-1.5 flex-1 rounded-full ${
                index === activeIndex
                  ? "bg-[var(--mode-quiz)]"
                  : answered
                    ? "bg-[color-mix(in_oklab,var(--mode-quiz)_45%,var(--bg-secondary))]"
                    : "bg-[var(--border-default)]"
              }`}
            />
          );
        })}
      </div>

      {!submitted ? (
        <p className="text-xs text-[var(--text-secondary)]">
          Answered {Object.keys(answers).length}/{questions.length}
        </p>
      ) : (
        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-3 text-center">
            <p className="text-3xl font-bold">
              {score}/{questions.length}
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {isPerfect
                ? "Perfect score! Outstanding work."
                : isGood
                  ? "Great job! You're getting there."
                  : isLow
                    ? "Good effort. Review the missed questions."
                    : "Let's revisit this topic together."}
            </p>
          </div>
          {onFollowUp ? (
            <div className="flex flex-wrap justify-center gap-2">
              {isPerfect ? (
                <>
                  <Button type="button" size="sm" onClick={requestHarderQuiz}>
                    Harder Quiz
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={requestNewTopic}>
                    New Topic
                  </Button>
                </>
              ) : isGood || isLow ? (
                <>
                  <Button type="button" size="sm" onClick={requestExplanation}>
                    Explain Mistakes
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={requestRetry}>
                    Retry Quiz
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" size="sm" onClick={switchToLearnMode}>
                    Teach Me First
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={requestEasierQuiz}>
                    Easier Quiz
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
