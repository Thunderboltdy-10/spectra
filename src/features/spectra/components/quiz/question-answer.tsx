"use client";

import { Shuffle } from "@/components/icons/glyph-icons";
import { AlertCircle, ArrowRight, Check, ChevronDown, ChevronUp, Plus, X } from "@/components/icons/glyph-icons";
import { targetAttrs } from "../../collaboration/target-attributes";
import { aiRegionAttr } from "../ai-region-path";
import { id, type QuizQuestion } from "../artifact-content-model";
import { answerKeyProblems, OPTION_TYPES, optionLetter } from "./question-types";

/*
 * The answer half of a question sheet (EDITORS.md, "Quiz"). Each type gets the
 * shape its answer has on paper: lettered options with the right one inked
 * green, an ordered list, pairs joined by an arrow, a number give or take, a
 * line for a short answer. What is wrong with the key is said under it, once,
 * in place of instructions that would always be there.
 */

type AnswerProps = {
  question: QuizQuestion;
  qPath: string;
  aiField: (suffix: string) => boolean;
  onChange: (patch: Partial<QuizQuestion>) => void;
};

export function QuestionAnswer(props: AnswerProps) {
  const { type } = props.question;
  if (OPTION_TYPES.has(type)) return <OptionsAnswer {...props} />;
  if (type === "matching") return <MatchingAnswer {...props} />;
  if (type === "numeric") return <NumericAnswer {...props} />;
  if (type === "long_response") return <RubricAnswer {...props} />;
  return <TextAnswer {...props} />;
}

function AnswerSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="sheet-section quiz-answer" aria-label={title}>
      <header className="sheet-section-head">
        <h3>{title}</h3>
        {hint ? <span className="sheet-hint">{hint}</span> : null}
      </header>
      {children}
    </section>
  );
}

function OptionsAnswer({ question, qPath, aiField, onChange }: AnswerProps) {
  const ordering = question.type === "ordering";
  const fixed = question.type === "true_false";
  const many = question.type === "select_all";
  const problems = answerKeyProblems(question);
  const isCorrect = (option: string) => Boolean(option) && (many ? (question.correctAnswers ?? []).includes(option) : question.correctAnswer === option);

  const updateOption = (index: number, value: string) => {
    const options = [...question.options];
    const previous = options[index] ?? "";
    options[index] = value;
    onChange({
      options,
      correctAnswer: question.correctAnswer === previous ? value : question.correctAnswer,
      correctAnswers: (question.correctAnswers ?? []).map((answer) => (answer === previous ? value : answer)),
    });
  };
  const toggleCorrect = (option: string) => {
    if (!option) return;
    if (!many) return onChange({ correctAnswer: option });
    const current = question.correctAnswers ?? [];
    onChange({ correctAnswers: current.includes(option) ? current.filter((answer) => answer !== option) : [...current, option] });
  };
  const swap = (from: number, to: number) => {
    const options = [...question.options];
    const optionIds = [...question.optionIds];
    [options[from], options[to]] = [options[to]!, options[from]!];
    [optionIds[from], optionIds[to]] = [optionIds[to]!, optionIds[from]!];
    onChange({ options, optionIds, correctAnswers: options });
  };
  const remove = (index: number) => {
    const removed = question.options[index];
    onChange({
      options: question.options.filter((_, candidate) => candidate !== index),
      optionIds: question.optionIds.filter((_, candidate) => candidate !== index),
      correctAnswer: question.correctAnswer === removed ? "" : question.correctAnswer,
      correctAnswers: (question.correctAnswers ?? []).filter((answer) => answer !== removed),
    });
  };
  const shuffle = () => {
    const paired = question.options.map((option, index) => ({ option, optionId: question.optionIds[index] ?? id("option") }));
    for (let index = paired.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [paired[index], paired[target]] = [paired[target]!, paired[index]!];
    }
    onChange({ options: paired.map(({ option }) => option), optionIds: paired.map(({ optionId }) => optionId) });
  };

  return (
    <AnswerSection title={ordering ? "In the right order" : "Options"} hint={ordering ? "Learners get them shuffled" : many ? "Every correct one counts" : undefined}>
      <ol className="quiz-options" data-ordering={ordering || undefined}>
        {question.options.map((option, index) => {
          const correct = !ordering && isCorrect(option);
          return (
            <li key={question.optionIds[index] ?? index} className="quiz-option" data-correct={correct || undefined}>
              {ordering ? (
                <span className="quiz-option-key" aria-hidden>
                  {index + 1}
                </span>
              ) : (
                <button
                  type="button"
                  className="quiz-option-key"
                  aria-pressed={correct}
                  aria-label={`${many && correct ? "Unmark" : "Mark"} option ${index + 1} correct`}
                  title={correct ? "Correct answer" : "Mark as the correct answer"}
                  onClick={() => toggleCorrect(option)}
                  {...targetAttrs(`${qPath}/${many ? "correctAnswers" : "correctAnswer"}`, `option:${index}`, "toggle")}
                >
                  {correct ? <Check className="size-3.5" /> : optionLetter(index)}
                </button>
              )}
              <OptionText
                value={option}
                readOnly={fixed}
                placeholder={`Option ${index + 1}`}
                aria-label={`Option ${index + 1}`}
                onChange={(value) => updateOption(index, value)}
                data-ai-region={aiRegionAttr(aiField(`options/${index}`))}
                {...targetAttrs(`${qPath}/options/${index}`)}
              />
              {correct ? <span className="quiz-option-flag">Correct</span> : null}
              <span className="quiz-option-tools">
                {ordering ? (
                  <>
                    <button type="button" className="sheet-icon-button" disabled={index === 0} onClick={() => swap(index, index - 1)} aria-label={`Move option ${index + 1} earlier`}>
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="sheet-icon-button"
                      disabled={index === question.options.length - 1}
                      onClick={() => swap(index, index + 1)}
                      aria-label={`Move option ${index + 1} later`}
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </>
                ) : null}
                {fixed ? null : (
                  <button type="button" className="sheet-icon-button" onClick={() => remove(index)} aria-label={`Remove option ${index + 1}`} title="Remove option">
                    <X className="size-3.5" />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {fixed ? null : (
        <div className="quiz-answer-foot">
          <button type="button" className="sheet-quiet" onClick={() => onChange({ options: [...question.options, ""], optionIds: [...question.optionIds, id("option")] })}>
            <Plus className="size-3.5" /> Add option
          </button>
          {ordering || question.options.length < 3 ? null : (
            <button type="button" className="sheet-quiet" onClick={shuffle}>
              <Shuffle className="size-3.5" /> Shuffle
            </button>
          )}
        </div>
      )}
      <AnswerProblems problems={problems} />
    </AnswerSection>
  );
}

/** One option's words: a single line that wraps, so a long answer is read in full. */
function OptionText({
  onChange,
  ...field
}: Omit<React.ComponentProps<"textarea">, "onChange" | "className" | "rows"> & { onChange: (value: string) => void }) {
  return (
    <textarea
      {...field}
      className="quiz-option-text"
      rows={1}
      onChange={(event) => onChange(event.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
    />
  );
}

function AnswerProblems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <ul className="quiz-problems" aria-live="polite">
      {problems.map((problem) => (
        <li key={problem}>
          <AlertCircle className="size-3.5" aria-hidden />
          {problem}
        </li>
      ))}
    </ul>
  );
}

function MatchingAnswer({ question, qPath, aiField, onChange }: AnswerProps) {
  const pairs = question.matchingPairs ?? [];
  const update = (pairId: string, side: "left" | "right", value: string) =>
    onChange({ matchingPairs: pairs.map((candidate) => (candidate.id === pairId ? { ...candidate, [side]: value } : candidate)) });
  return (
    <AnswerSection title="Pairs" hint="The right side is shuffled for learners">
      <ol className="quiz-pairs">
        {pairs.map((pair, index) => (
          <li key={pair.id} className="quiz-pair">
            <OptionText
              value={pair.left}
              placeholder={`Prompt ${index + 1}`}
              aria-label={`Prompt ${index + 1}`}
              onChange={(value) => update(pair.id, "left", value)}
              data-ai-region={aiRegionAttr(aiField(`matchingPairs/${index}/left`) || aiField(`matchingPairs/${index}`))}
              {...targetAttrs(`${qPath}/matchingPairs/${index}/left`)}
            />
            <ArrowRight className="size-3.5 quiz-pair-arrow" aria-hidden />
            <OptionText
              value={pair.right ?? ""}
              placeholder={`Match ${index + 1}`}
              aria-label={`Match ${index + 1}`}
              onChange={(value) => update(pair.id, "right", value)}
              data-ai-region={aiRegionAttr(aiField(`matchingPairs/${index}/right`) || aiField(`matchingPairs/${index}`))}
              {...targetAttrs(`${qPath}/matchingPairs/${index}/right`)}
            />
            <span className="quiz-option-tools">
              <button
                type="button"
                className="sheet-icon-button"
                disabled={pairs.length <= 2}
                onClick={() => onChange({ matchingPairs: pairs.filter((candidate) => candidate.id !== pair.id) })}
                aria-label={`Remove matching pair ${index + 1}`}
              >
                <X className="size-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="quiz-answer-foot">
        <button type="button" className="sheet-quiet" onClick={() => onChange({ matchingPairs: [...pairs, { id: id("pair"), left: "", right: "" }] })}>
          <Plus className="size-3.5" /> Add pair
        </button>
      </div>
    </AnswerSection>
  );
}

function NumericAnswer({ question, qPath, aiField, onChange }: AnswerProps) {
  return (
    <AnswerSection title="Answer">
      <div className="quiz-numeric">
        <input
          type="number"
          className="quiz-answer-line quiz-answer-line--number"
          value={question.correctAnswer ?? ""}
          placeholder="42"
          aria-label="Expected number"
          onChange={(event) => onChange({ correctAnswer: event.target.value })}
          data-ai-region={aiRegionAttr(aiField("correctAnswer"))}
          {...targetAttrs(`${qPath}/correctAnswer`)}
        />
        <span className="sheet-hint">give or take</span>
        <input
          type="number"
          min={0}
          step="any"
          className="quiz-answer-line quiz-answer-line--tolerance"
          value={question.numericTolerance ?? 0}
          aria-label="Accepted tolerance"
          onChange={(event) => onChange({ numericTolerance: Math.max(0, Number(event.target.value) || 0) })}
          data-ai-region={aiRegionAttr(aiField("numericTolerance"))}
          {...targetAttrs(`${qPath}/numericTolerance`)}
        />
      </div>
    </AnswerSection>
  );
}

function TextAnswer({ question, qPath, aiField, onChange }: AnswerProps) {
  const blank = question.type === "fill_blank";
  return (
    <AnswerSection title="Answer">
      <input
        className="quiz-answer-line"
        value={question.correctAnswer ?? ""}
        placeholder={blank ? "The words that fill the blank" : "What a right answer says"}
        aria-label={blank ? "Primary accepted answer" : "Expected answer"}
        onChange={(event) => onChange({ correctAnswer: event.target.value })}
        data-ai-region={aiRegionAttr(aiField("correctAnswer"))}
        {...targetAttrs(`${qPath}/correctAnswer`)}
      />
      {blank ? (
        <label className="quiz-also">
          <span className="sheet-hint">Also accept</span>
          <input
            className="quiz-answer-line"
            value={(question.correctAnswers ?? []).join("; ")}
            placeholder="Another spelling; an equivalent phrase"
            aria-label="Other accepted answers"
            onChange={(event) =>
              onChange({
                correctAnswers: event.target.value
                  .split(";")
                  .map((answer) => answer.trim())
                  .filter(Boolean),
              })
            }
            data-ai-region={aiRegionAttr(aiField("correctAnswers"))}
            {...targetAttrs(`${qPath}/correctAnswers`)}
          />
        </label>
      ) : null}
    </AnswerSection>
  );
}

function RubricAnswer({ question, qPath, aiField, onChange }: AnswerProps) {
  return (
    <AnswerSection title="What a strong answer includes" hint="Not marked automatically">
      <textarea
        className="quiz-rubric"
        value={question.rubric ?? ""}
        placeholder="The points a good answer makes, so learners can check their own"
        aria-label="Formative rubric / review guidance"
        onChange={(event) => onChange({ rubric: event.target.value })}
        data-ai-region={aiRegionAttr(aiField("rubric"))}
        {...targetAttrs(`${qPath}/rubric`)}
      />
    </AnswerSection>
  );
}
