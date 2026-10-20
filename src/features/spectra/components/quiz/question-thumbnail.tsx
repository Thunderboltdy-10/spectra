import type { QuizQuestion } from "../artifact-content-model";
import { plainTextFromStored } from "../../rich-content";
import { OPTION_TYPES, QUIZ_TYPE_LABELS, optionLetter } from "./question-types";

/**
 * A question as the rail shows it: the sheet in miniature. The prompt in the
 * question's own type, then the shape of its answer — lettered options with
 * the right one filled, a ruled line to write on, a box for a long answer —
 * so a quiz reads down the rail the way slides do.
 */
export function QuestionThumbnail({ question }: { question: QuizQuestion }) {
  const prompt = plainTextFromStored(question.prompt);
  const points = question.points ?? 1;
  return (
    <div className="spectra-item-rail-preview rail-thumb" data-thumb="question">
      <p className="rail-thumb-kicker">
        <span>{QUIZ_TYPE_LABELS[question.type]}</span>
        <span>{points} {points === 1 ? "pt" : "pts"}</span>
      </p>
      <p className="rail-thumb-prompt" data-empty={!prompt || undefined}>
        {prompt || "Write the question"}
      </p>
      <AnswerShape question={question} />
    </div>
  );
}

function AnswerShape({ question }: { question: QuizQuestion }) {
  if (OPTION_TYPES.has(question.type)) {
    const many = question.type === "select_all";
    const right = (option: string) =>
      Boolean(option) && (many ? (question.correctAnswers ?? []).includes(option) : question.correctAnswer === option);
    const shown = question.options.slice(0, 4);
    return (
      <ol className="rail-thumb-options" data-many={many || undefined}>
        {shown.map((option, index) => (
          <li key={question.optionIds[index] ?? index} data-right={right(option) || undefined}>
            <span>{question.type === "ordering" ? index + 1 : optionLetter(index)}</span>
            <OptionText text={plainTextFromStored(option)} />
          </li>
        ))}
        {question.options.length > shown.length ? (
          <li data-more>+{question.options.length - shown.length} more</li>
        ) : null}
      </ol>
    );
  }
  if (question.type === "matching") {
    return (
      <ol className="rail-thumb-pairs">
        {(question.matchingPairs ?? []).slice(0, 3).map((pair) => (
          <li key={pair.id}>
            <span>{pair.left}</span>
            <span>{pair.right}</span>
          </li>
        ))}
      </ol>
    );
  }
  return <span className="rail-thumb-answer" data-type={question.type} aria-hidden />;
}

/** An option not yet written shows as a faint stroke where its words will go. */
function OptionText({ text }: { text: string }) {
  return text ? <span>{text}</span> : <span data-empty aria-hidden />;
}
