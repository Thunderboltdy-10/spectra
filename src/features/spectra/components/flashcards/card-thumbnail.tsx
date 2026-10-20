import { clozeAnswer, clozePrompt, type DeckCard } from "../artifact-content-model";
import { plainTextFromStored } from "../../rich-content";

/**
 * A card as the rail shows it: a small index card, the prompt above the rule
 * and the answer under it, as it is written on paper. A cloze shows its gap
 * above and the filled sentence below.
 */
export function CardThumbnail({ card }: { card: DeckCard }) {
  const cloze = card.variant === "cloze";
  const front = plainTextFromStored(card.front);
  const prompt = cloze ? clozePrompt(front) : front;
  const answer = cloze ? clozeAnswer(front) : plainTextFromStored(card.back);
  return (
    <div className="spectra-item-rail-preview rail-thumb" data-thumb="card">
      <p className="rail-thumb-prompt" data-empty={!prompt || undefined}>
        {prompt || "Write the prompt"}
      </p>
      <p className="rail-thumb-back" data-empty={!answer || undefined}>
        {answer || "Answer"}
      </p>
    </div>
  );
}
