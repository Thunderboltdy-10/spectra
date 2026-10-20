"use client";

import { useState } from "react";
import { SelectField } from "@/components/ui/select";
import { ChevronDown, ChevronUp, Copy, Plus, Trash2, X } from "@/components/icons/glyph-icons";
import { targetAttrs } from "../../collaboration/target-attributes";
import { aiRegionAttr, pathTouches } from "../ai-region-path";
import type { QuizQuestion } from "../artifact-content-model";
import { ArtifactRichTextEditor } from "../artifact-rich-text-editor";
import { SheetMore } from "../sheet/sheet-more";
import { QuestionAnswer } from "./question-answer";
import { QuestionDetails, questionDetailsSummary } from "./question-details";
import { AddImageButton, QuestionImage, type QuestionImageState } from "./question-image";
import { QUIZ_TYPE_OPTIONS, retypeQuestion } from "./question-types";

/*
 * One quiz question, written on a sheet (EDITORS.md, "Quiz"). It reads the way
 * the learner will meet it: the number stamped in the margin, the question in
 * the display serif, its picture, then the answer in the shape that type has
 * on paper. The explanation and the picture are a press away rather than empty
 * boxes; marks, timing, tags, feedback and pooling fold into More options.
 */

export function QuestionSheet({
  question,
  questionNumber,
  questionCount,
  questionIndex,
  aiChangedPaths = [],
  image,
  detailsOpen,
  onDetailsOpenChange,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
}: {
  question: QuizQuestion;
  questionNumber: number;
  questionCount: number;
  questionIndex: number;
  aiChangedPaths?: string[];
  image: QuestionImageState;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<QuizQuestion>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  /** Moves this question to `toIndex`. Bounds are enforced by the caller. */
  onMove: (toIndex: number) => void;
}) {
  const [explaining, setExplaining] = useState(false);
  const qPath = `/questions/${questionIndex}`;
  const aiField = (suffix: string) => pathTouches(aiChangedPaths, `${qPath}/${suffix}`);
  const showExplanation = explaining || Boolean(question.explanation?.trim());

  return (
    <article
      className="editor-sheet sheet-leaf quiz-sheet"
      data-anchor-region={question.id}
      aria-label={`Question ${questionNumber}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        const file = event.dataTransfer.files?.[0];
        if (!file?.type.startsWith("image/")) return;
        event.preventDefault();
        image.upload(file);
      }}
    >
      <header className="quiz-sheet-head">
        <div className="quiz-sheet-head-main">
          <div className="sheet-type-chip" data-ai-region={aiRegionAttr(aiField("type"))} {...targetAttrs(`${qPath}/type`)}>
            <SelectField
              ariaLabel="Question type"
              size="sm"
              value={question.type}
              onChange={(value) => onChange(retypeQuestion(question, value as QuizQuestion["type"]))}
              options={QUIZ_TYPE_OPTIONS}
            />
          </div>
          <div className="quiz-prompt" data-ai-region={aiRegionAttr(aiField("prompt"))}>
            <ArtifactRichTextEditor
              key={question.id}
              value={question.prompt}
              variant="bare"
              autoFocus={!question.prompt}
              onChange={(prompt) => onChange({ prompt })}
              path={`${qPath}/prompt`}
              placeholder="Ask your question"
              label="Question"
            />
          </div>
        </div>
        <div className="sheet-tools">
          <button type="button" className="sheet-icon-button" onClick={() => onMove(questionIndex - 1)} disabled={questionIndex === 0} aria-label="Move question earlier" title="Move earlier">
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            className="sheet-icon-button"
            onClick={() => onMove(questionIndex + 1)}
            disabled={questionIndex >= questionCount - 1}
            aria-label="Move question later"
            title="Move later"
          >
            <ChevronDown className="size-4" />
          </button>
          <button type="button" className="sheet-icon-button" onClick={onDuplicate} aria-label="Duplicate question" title="Duplicate">
            <Copy className="size-4" />
          </button>
          <button type="button" className="sheet-icon-button" onClick={onRemove} aria-label="Remove question" title="Remove">
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      {question.media ? <QuestionImage media={question.media} image={image} onAltText={(altText) => onChange({ media: { ...question.media!, altText } })} /> : null}

      <QuestionAnswer question={question} qPath={qPath} aiField={aiField} onChange={onChange} />

      {showExplanation ? (
        <section className="sheet-section" aria-label="Explanation">
          <header className="sheet-section-head">
            <h3>Why it is right</h3>
            <span className="sheet-hint">Shown once they have answered</span>
            <button
              type="button"
              className="sheet-icon-button ml-auto"
              aria-label="Remove the explanation"
              title="Remove"
              onClick={() => {
                setExplaining(false);
                if (question.explanation) onChange({ explanation: "" });
              }}
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="quiz-explanation" data-ai-region={aiRegionAttr(aiField("explanation"))}>
            <ArtifactRichTextEditor
              key={`${question.id}:explanation`}
              value={question.explanation ?? ""}
              format="markdown"
              autoFocus={explaining && !question.explanation}
              onChange={(explanation) => onChange({ explanation })}
              path={`${qPath}/explanation`}
              placeholder="The reasoning, in a sentence or two"
              label="Explanation"
            />
          </div>
        </section>
      ) : null}

      {!showExplanation || !question.media ? (
        <div className="quiz-sheet-adds">
          {showExplanation ? null : (
            <button type="button" className="sheet-quiet" onClick={() => setExplaining(true)}>
              <Plus className="size-3.5" /> Add explanation
            </button>
          )}
          {question.media ? null : <AddImageButton image={image} />}
        </div>
      ) : null}
      {image.error ? (
        <p className="quiz-problems" aria-live="polite">
          {image.error}
        </p>
      ) : null}

      <SheetMore open={detailsOpen} onOpenChange={onDetailsOpenChange} summary={questionDetailsSummary(question)}>
        <QuestionDetails question={question} qPath={qPath} aiField={aiField} onChange={onChange} />
      </SheetMore>
    </article>
  );
}
