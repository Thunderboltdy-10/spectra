"use client";

import { SelectField } from "@/components/ui/select";
import { targetAttrs } from "../../collaboration/target-attributes";
import { aiRegionAttr } from "../ai-region-path";
import type { QuizQuestion } from "../artifact-content-model";
import { ChipInput } from "../sheet/chip-input";
import { NumberField } from "@/components/ui/number-field";

/*
 * What most questions never need, folded under the sheet's "More options"
 * (EDITORS.md, "Quiz"): marks and timing, how it is filed, what a learner is
 * told after answering, where it came from, and how it is drawn from a pool.
 * The fold's line names whatever is set away from the defaults.
 */

const DIFFICULTY = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const BLOOM = [
  { value: "remember", label: "Remember" },
  { value: "understand", label: "Understand" },
  { value: "apply", label: "Apply" },
  { value: "analyze", label: "Analyze" },
  { value: "evaluate", label: "Evaluate" },
  { value: "create", label: "Create" },
];

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The fold's line: what is set, or what can be. */
export function questionDetailsSummary(question: QuizQuestion) {
  const parts: string[] = [];
  const points = question.points ?? 1;
  if (points !== 1) parts.push(plural(points, "point"));
  if (question.difficulty && question.difficulty !== "medium") parts.push(question.difficulty);
  if (question.tags?.length) parts.push(plural(question.tags.length, "tag"));
  if (question.feedback?.trim()) parts.push("feedback");
  if (question.sourceRefs?.length) parts.push(plural(question.sourceRefs.length, "source"));
  if (question.poolId) parts.push("drawn from a pool");
  if (!parts.length) return "Points, difficulty, tags, feedback";
  const line = parts.join(", ");
  return line[0]!.toUpperCase() + line.slice(1);
}

type DetailsProps = {
  question: QuizQuestion;
  qPath: string;
  aiField: (suffix: string) => boolean;
  onChange: (patch: Partial<QuizQuestion>) => void;
};

export function QuestionDetails({ question, qPath, aiField, onChange }: DetailsProps) {
  const control = (suffix: string) => ({ "data-ai-region": aiRegionAttr(aiField(suffix)), ...targetAttrs(`${qPath}/${suffix}`) });
  return (
    <div className="sheet-options">
      <label className="sheet-option">
        <span>Worth</span>
        <span className="sheet-option-minutes">
          <NumberField
            min={1}
            className="sheet-input"
            value={question.points ?? 1}
            aria-label="Points"
            onChange={(event) => onChange({ points: Math.max(1, Number(event.target.value) || 1) })}
            {...control("points")}
          />
          {(question.points ?? 1) === 1 ? "point" : "points"}
        </span>
      </label>
      <div className="sheet-option">
        <span>Difficulty</span>
        <div {...control("difficulty")}>
          <SelectField
            ariaLabel="Difficulty"
            size="sm"
            value={question.difficulty ?? "medium"}
            onChange={(value) => onChange({ difficulty: value as QuizQuestion["difficulty"] })}
            options={DIFFICULTY}
          />
        </div>
      </div>
      <label className="sheet-option">
        <span>Time to answer</span>
        <span className="sheet-option-minutes">
          <NumberField
            min={0}
            className="sheet-input"
            value={question.timeLimitSeconds ?? 90}
            aria-label="Time (seconds)"
            onChange={(event) => onChange({ timeLimitSeconds: Math.max(0, Number(event.target.value) || 0) })}
            {...control("timeLimitSeconds")}
          />
          seconds
        </span>
      </label>
      <div className="sheet-option">
        <span>Thinking skill</span>
        <div {...control("bloomLevel")}>
          <SelectField
            ariaLabel="Bloom's taxonomy level"
            size="sm"
            value={question.bloomLevel ?? "remember"}
            onChange={(value) => onChange({ bloomLevel: value as NonNullable<QuizQuestion["bloomLevel"]> })}
            options={BLOOM}
          />
        </div>
      </div>
      <div className="sheet-option">
        <span>Tags</span>
        <ChipInput label="tag" values={question.tags ?? []} onChange={(tags) => onChange({ tags })} attrs={control("tags")} />
      </div>
      <div className="sheet-option">
        <span>Standards</span>
        <ChipInput label="standard" values={question.standards ?? []} onChange={(standards) => onChange({ standards })} attrs={control("standards")} />
      </div>
      <label className="sheet-option sheet-option--wide">
        <span>After answering</span>
        <textarea
          className="sheet-input sheet-input--text"
          value={question.feedback ?? ""}
          placeholder="A next step to offer, right or wrong"
          aria-label="Formative feedback / next step"
          onChange={(event) => onChange({ feedback: event.target.value })}
          {...control("feedback")}
        />
      </label>
      <label className="sheet-option sheet-option--wide">
        <span>Sources</span>
        <input
          className="sheet-input"
          value={(question.sourceRefs ?? []).join(", ")}
          placeholder="Textbook p. 42, class notes"
          aria-label="Sources / provenance"
          onChange={(event) =>
            onChange({
              sourceRefs: event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
          {...control("sourceRefs")}
        />
      </label>
      <label className="sheet-option">
        <span>Section</span>
        <input className="sheet-input" value={question.section ?? ""} placeholder="Foundations" aria-label="Section" onChange={(event) => onChange({ section: event.target.value || undefined })} />
      </label>
      <label className="sheet-option">
        <span>Random pool</span>
        <span className="sheet-option-minutes">
          <input
            className="sheet-input quiz-detail-pool"
            value={question.poolId ?? ""}
            placeholder="None"
            aria-label="Random pool"
            title="Questions with the same pool name share one draw count. Ungrouped questions always appear."
            onChange={(event) =>
              onChange({ poolId: event.target.value || undefined, poolDrawCount: event.target.value ? (question.poolDrawCount ?? 1) : undefined })
            }
          />
          {question.poolId ? (
            <>
              draw
              <NumberField
                min={1}
                max={100}
                className="sheet-input"
                value={question.poolDrawCount ?? 1}
                aria-label="Questions drawn from pool"
                onChange={(event) => onChange({ poolDrawCount: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })}
              />
            </>
          ) : null}
        </span>
      </label>
    </div>
  );
}
