"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type QuizQuestion = {
  number: number;
  question: string;
  options: { letter: string; text: string }[];
  correct: string;
  explanation?: string;
};

function parseQuizFromContent(content: string): QuizQuestion[] | null {
  const questions: QuizQuestion[] = [];
  const lines = content.split("\n");

  let current: Partial<QuizQuestion> | null = null;
  let inAnswers = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#{1,3}\s*(answers|explanations)/i.test(trimmed)) {
      inAnswers = true;
      continue;
    }

    const questionMatch = trimmed.match(/^(?:Q|Question\s*)?(\d+)[.)]\s*(.+)/i);
    if (questionMatch && !inAnswers) {
      if (current?.question && current.options && current.options.length >= 2) {
        questions.push(current as QuizQuestion);
      }
      current = {
        number: parseInt(questionMatch[1]),
        question: questionMatch[2],
        options: [],
        correct: "",
      };
      continue;
    }

    const optionMatch = trimmed.match(/^([A-D])[.)]\s*(.+)/);
    if (optionMatch && current && !inAnswers) {
      current.options = current.options || [];
      current.options.push({ letter: optionMatch[1], text: optionMatch[2] });
      continue;
    }

    const correctMatch = trimmed.match(/^Correct:\s*([A-D])/i);
    if (correctMatch && current) {
      current.correct = correctMatch[1];
      continue;
    }

    if (inAnswers) {
      const answerMatch = trimmed.match(/^(?:Q|Question\s*)?(\d+)[.):\s]*(?:\*{0,2}([A-D])\*{0,2})?[.):\s]*(.*)/i);
      if (answerMatch) {
        const qNum = parseInt(answerMatch[1]);
        const q = questions.find((q) => q.number === qNum) || (current?.number === qNum ? current : null);
        if (q) {
          if (answerMatch[2]) q.correct = answerMatch[2];
          if (answerMatch[3]) q.explanation = answerMatch[3].trim();
        }
      }
    }
  }

  if (current?.question && current.options && current.options.length >= 2) {
    questions.push(current as QuizQuestion);
  }

  return questions.length >= 2 ? questions : null;
}

export function isQuizContent(content: string): boolean {
  const hasOptions = /[A-D][.)]\s*.+/m.test(content);
  const hasQuestions = /(?:Q|Question\s*)\d+[.)]/i.test(content) || /^\d+[.)]\s*.+/m.test(content);
  return hasOptions && hasQuestions;
}

type QuizViewProps = {
  content: string;
};

export function QuizView({ content }: QuizViewProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const questions = parseQuizFromContent(content);
  if (!questions) return null;

  const score = submitted
    ? questions.filter((q) => answers[q.number] === q.correct).length
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--mode-quiz)] px-2.5 py-1 text-xs font-medium text-white">
          Quiz - {questions.length} questions
        </span>
        {submitted && (
          <span className="text-sm font-medium">
            Score: {score}/{questions.length} ({Math.round((score / questions.length) * 100)}%)
          </span>
        )}
      </div>

      {questions.map((q) => {
        const selected = answers[q.number];
        const isCorrect = submitted && selected === q.correct;
        const isWrong = submitted && selected && selected !== q.correct;

        return (
          <div
            key={q.number}
            className="card-entrance rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]"
            style={{ animationDelay: `${q.number * 50}ms` }}
          >
            <p className="mb-3 text-sm font-medium">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--mode-quiz)] text-xs text-white">
                {q.number}
              </span>
              {q.question}
            </p>

            <div className="space-y-2">
              {q.options.map((opt) => {
                const isSelected = selected === opt.letter;
                const showCorrect = submitted && opt.letter === q.correct;
                const showWrong = submitted && isSelected && opt.letter !== q.correct;

                return (
                  <button
                    key={opt.letter}
                    type="button"
                    disabled={submitted}
                    onClick={() =>
                      setAnswers((prev) => ({ ...prev, [q.number]: opt.letter }))
                    }
                    className={`quiz-option flex w-full items-center gap-3 rounded-[var(--radius-input)] border px-3 py-2.5 text-left text-sm transition ${
                      showCorrect
                        ? "quiz-correct"
                        : showWrong
                          ? "quiz-incorrect"
                          : isSelected
                            ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_8%,var(--bg-primary))]"
                            : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--border-default)]"
                      }`}
                    >
                      {opt.letter}
                    </span>
                    <span className="flex-1">{opt.text}</span>
                    {showCorrect && <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}
                    {showWrong && <XCircle className="h-4 w-4 text-[var(--danger)]" />}
                  </button>
                );
              })}
            </div>

            {submitted && q.explanation && (
              <p className="mt-3 rounded-[var(--radius-input)] bg-[var(--bg-secondary)] p-2.5 text-xs text-[var(--text-secondary)]">
                {isCorrect ? "Correct! " : isWrong ? "Incorrect. " : ""}
                {q.explanation}
              </p>
            )}
          </div>
        );
      })}

      {!submitted && (
        <Button
          onClick={() => setSubmitted(true)}
          disabled={Object.keys(answers).length === 0}
        >
          Submit Answers ({Object.keys(answers).length}/{questions.length})
        </Button>
      )}

      {submitted && (
        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-center">
          <p className="text-2xl font-bold">
            {score}/{questions.length}
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            {score === questions.length
              ? "Perfect score!"
              : score >= questions.length * 0.7
                ? "Great job!"
                : "Keep practicing!"}
          </p>
        </div>
      )}
    </div>
  );
}
