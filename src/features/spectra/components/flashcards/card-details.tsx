"use client";

import { SelectField } from "@/components/ui/select";
import { targetAttrs } from "../../collaboration/target-attributes";
import { aiRegionAttr } from "../ai-region-path";
import type { DeckCard } from "../artifact-content-model";

/*
 * What most cards never need, folded under the sheet's "More options"
 * (EDITORS.md, "Flashcards"): how hard it is and how it is going, where it is
 * filed, what else counts as right, why, and where it came from. The fold's
 * line names whatever is set away from the defaults.
 */

const DIFFICULTY = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const CONFIDENCE = [
  { value: "unknown", label: "Not rated yet" },
  { value: "weak", label: "Giving you trouble" },
  { value: "medium", label: "Still working on it" },
  { value: "strong", label: "You find it easy" },
];

const PLACEMENT = [
  { value: "front", label: "The front" },
  { value: "back", label: "The back" },
];

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The fold's line: what is set, or what can be. */
export function cardDetailsSummary(card: DeckCard) {
  const parts: string[] = [];
  if (card.difficulty && card.difficulty !== "medium") parts.push(card.difficulty);
  if (card.bidirectional) parts.push("studied both ways");
  if (card.explanation?.trim()) parts.push("explanation");
  if (card.acceptedAlternatives?.length) parts.push(plural(card.acceptedAlternatives.length, "other answer"));
  if (card.learningObjective?.trim()) parts.push("objective");
  if (card.sourceRefs?.length) parts.push(plural(card.sourceRefs.length, "source"));
  if (card.language?.trim()) parts.push(card.language.trim());
  if (!parts.length) return "Difficulty, explanation, other answers, sources";
  const line = parts.join(", ");
  return line[0]!.toUpperCase() + line.slice(1);
}

const list = (value: string, separator: string) =>
  value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);

export function CardDetails({
  card,
  cardPath,
  sections,
  canEdit,
  aiField,
  onChange,
}: {
  card: DeckCard;
  /** `/cards/N`. */
  cardPath: string;
  sections: string[];
  canEdit: boolean;
  aiField: (suffix: string) => boolean;
  onChange: (patch: Partial<DeckCard>) => void;
}) {
  const control = (suffix: string) => ({ "data-ai-region": aiRegionAttr(aiField(suffix)), ...targetAttrs(`${cardPath}/${suffix}`) });
  const media = card.media;
  return (
    <div className="sheet-options">
      <div className="sheet-option">
        <span>Difficulty</span>
        <div {...control("difficulty")}>
          <SelectField
            ariaLabel="Difficulty"
            size="sm"
            disabled={!canEdit}
            value={card.difficulty ?? "medium"}
            onChange={(value) => onChange({ difficulty: value as DeckCard["difficulty"] })}
            options={DIFFICULTY}
          />
        </div>
      </div>
      <div className="sheet-option">
        <span>How it is going</span>
        <div {...control("confidence")}>
          <SelectField
            ariaLabel="Confidence"
            size="sm"
            disabled={!canEdit}
            value={card.confidence ?? "unknown"}
            onChange={(value) => onChange({ confidence: value as DeckCard["confidence"] })}
            options={CONFIDENCE}
          />
        </div>
      </div>
      <div className="sheet-option">
        <span>Section</span>
        <div {...control("section")}>
          <SelectField
            ariaLabel="Section"
            size="sm"
            disabled={!canEdit}
            value={card.section || "Section 1"}
            onChange={(section) => onChange({ section })}
            options={sections.map((section) => ({ value: section, label: section }))}
          />
        </div>
      </div>
      <label className="sheet-option">
        <span>Language</span>
        <input
          className="sheet-input"
          value={card.language ?? ""}
          placeholder="English"
          aria-label="Language"
          readOnly={!canEdit}
          onChange={(event) => onChange({ language: event.target.value })}
          {...control("language")}
        />
      </label>
      {media && card.variant !== "image_occlusion" ? (
        <div className="sheet-option">
          <span>Picture on</span>
          <div {...control("media/placement")}>
            <SelectField
              ariaLabel="Place image on"
              size="sm"
              disabled={!canEdit}
              value={media.placement ?? "front"}
              onChange={(value) => onChange({ media: { ...media, placement: value as "front" | "back" } })}
              options={PLACEMENT}
            />
          </div>
        </div>
      ) : null}
      {media ? (
        <label className="sheet-option sheet-option--wide">
          <span>Picture description</span>
          <input
            className="sheet-input"
            value={media.altText ?? ""}
            placeholder="What the picture shows, for anyone who cannot see it"
            aria-label="Image description"
            readOnly={!canEdit}
            onChange={(event) => onChange({ media: { ...media, altText: event.target.value } })}
            {...control("media/altText")}
          />
        </label>
      ) : null}
      <label className="sheet-option sheet-option--wide">
        <span>Why it is right</span>
        <textarea
          className="sheet-input sheet-input--text"
          value={card.explanation ?? ""}
          placeholder="Shown after the answer, in a sentence or two"
          aria-label="Explanation"
          readOnly={!canEdit}
          onChange={(event) => onChange({ explanation: event.target.value })}
          {...control("explanation")}
        />
      </label>
      <label className="sheet-option sheet-option--wide">
        <span>Also accept</span>
        <input
          className="sheet-input"
          value={(card.acceptedAlternatives ?? []).join("; ")}
          placeholder="Other ways to say the answer, separated by semicolons"
          aria-label="Accepted alternatives"
          readOnly={!canEdit}
          onChange={(event) => onChange({ acceptedAlternatives: list(event.target.value, ";") })}
          {...control("acceptedAlternatives")}
        />
      </label>
      <label className="sheet-option sheet-option--wide">
        <span>Learning objective</span>
        <input
          className="sheet-input"
          value={card.learningObjective ?? ""}
          placeholder="What this card helps you recall"
          aria-label="Learning objective"
          readOnly={!canEdit}
          onChange={(event) => onChange({ learningObjective: event.target.value })}
          {...control("learningObjective")}
        />
      </label>
      <label className="sheet-option sheet-option--wide">
        <span>Sources</span>
        <input
          className="sheet-input"
          value={(card.sourceRefs ?? []).join(", ")}
          placeholder="Chapter 3, lecture notes"
          aria-label="Sources / provenance"
          readOnly={!canEdit}
          onChange={(event) => onChange({ sourceRefs: list(event.target.value, ",") })}
          {...control("sourceRefs")}
        />
      </label>
      <label className="sheet-option sheet-option--wide sheet-option--check">
        <span>Both ways</span>
        <span className="sheet-check">
          <input
            type="checkbox"
            checked={card.bidirectional === true}
            disabled={!canEdit || (card.variant ?? "basic") !== "basic"}
            onChange={() => onChange({ bidirectional: !card.bidirectional })}
            {...control("bidirectional")}
          />
          {(card.variant ?? "basic") === "basic" ? "Also study it from the back to the front" : "Only front-and-back cards can be studied both ways"}
        </span>
      </label>
    </div>
  );
}
