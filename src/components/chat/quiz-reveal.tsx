"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correct?: string;
};

type QuizRevealProps = {
  content: string;
};

function parseQuiz(content: string): QuizQuestion[] {
  const [questionsPart, answersPartRaw = ""] = content.split(/\n##\s*(answers?|explanations?)\b/i);
  const answerMap = new Map<string, string>();
  const answersPart = `\n${answersPartRaw}`;
  for (const line of answersPart.split("\n")) {
    const m = line.match(/(\d+)\s*[:.)-]?\s*(?:correct\s*[:=]\s*)?([A-D])/i);
    if (m) answerMap.set(m[1]!, m[2]!.toUpperCase());
  }

  const blocks = questionsPart
    .split(/\n(?=\d+[.)]\s+)/)
    .map((item) => item.trim())
    .filter(Boolean);

  const out: QuizQuestion[] = [];
  for (const block of blocks) {
    const m = block.match(/^(\d+)[.)]\s*([\s\S]+)$/);
    if (!m) continue;
    const id = m[1]!;
    const rest = m[2]!;
    const lines = rest.split("\n").map((line) => line.trim()).filter(Boolean);
    const options = lines.filter((line) => /^[A-D][.)]\s+/.test(line));
    const promptLines = lines.filter((line) => !/^[A-D][.)]\s+/.test(line));
    out.push({
      id,
      prompt: promptLines.join(" "),
      options,
      correct: answerMap.get(id),
    });
  }
  return out;
}

export function QuizReveal({ content }: QuizRevealProps) {
  const questions = useMemo(() => parseQuiz(content), [content]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState(false);

  const score = useMemo(() => {
    if (!revealed) return null;
    let correct = 0;
    for (const question of questions) {
      if (!question.correct) continue;
      if (answers[question.id] === question.correct) correct += 1;
    }
    return { correct, total: questions.length };
  }, [answers, questions, revealed]);

  if (questions.length === 0) return null;

  return (
    <div className="space-y-4">
      {questions.map((question) => (
        <div key={question.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">
            {question.id}. {question.prompt}
          </p>
          <div className="space-y-1.5">
            {question.options.map((option) => {
              const letter = option.charAt(0).toUpperCase();
              const selected = answers[question.id] === letter;
              const isCorrect = revealed && question.correct === letter;
              const isWrongSelected = revealed && selected && question.correct && question.correct !== letter;
              return (
                <button
                  key={`${question.id}-${letter}`}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: letter }))}
                  className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    isCorrect
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : isWrongSelected
                        ? "border-rose-500/40 bg-rose-500/10"
                        : selected
                          ? "border-[var(--accent-cyan)]/45 bg-[var(--bg-secondary)]"
                          : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2">
        {!revealed ? (
          <Button type="button" onClick={() => setRevealed(true)}>Check Answers</Button>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setRevealed(false)}>Hide Answers</Button>
        )}
        {score ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Score: <span className="font-medium text-[var(--text-primary)]">{score.correct}/{score.total}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
