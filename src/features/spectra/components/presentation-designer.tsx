"use client";

import { useMemo, type ReactNode } from "react";
import type { PresentationContent, PresentationSlide } from "../presentation/model";
import {
  DECK_FAMILIES,
  currentDesign,
  designIdeas,
  designerRefusal,
  type DeckFamily,
} from "../presentation/designer";

/*
 * The Designer pane: the open slide drawn in each look Designer has for it,
 * one click to wear one, and below them the same looks for the whole deck at
 * once. The pictures are the real slide, so what is chosen is what is seen.
 */
export function PresentationDesigner({
  deck,
  slideIndex,
  readOnly,
  preview,
  onApply,
  onApplyDeck,
}: {
  deck: PresentationContent;
  slideIndex: number;
  readOnly: boolean;
  /** Draws one slide as a still picture, the same way the rail does. */
  preview: (slide: PresentationSlide) => ReactNode;
  onApply: (slide: PresentationSlide) => void;
  onApplyDeck: (family: DeckFamily) => void;
}) {
  const slide = deck.slides[slideIndex];
  const { theme, settings, nativeBinding } = deck;
  const ideas = useMemo(
    () => designIdeas(deck, slideIndex),
    // A design depends on this slide, the deck's colours and its shape, not on every other slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slide, slideIndex, theme, settings, nativeBinding],
  );
  const refusal = designerRefusal(deck, slideIndex);
  const wearing = slide ? currentDesign(slide) : undefined;

  return (
    <div className="presentation-designer">
      <section aria-labelledby="designer-slide">
        <h4 id="designer-slide">This slide</h4>
        {refusal ? (
          <p className="presentation-designer-note">{refusal}</p>
        ) : (
          <>
            <p className="presentation-designer-note">The same words and pictures, laid out in the deck&apos;s colours.</p>
            <ul className="presentation-designer-ideas">
              {ideas.map((idea) => (
                <li key={idea.id}>
                  <button
                    type="button"
                    className="presentation-designer-idea"
                    aria-pressed={wearing === idea.id}
                    disabled={readOnly}
                    onClick={() => onApply(idea.slide)}
                  >
                    {preview(idea.slide)}
                    <span>{idea.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section aria-labelledby="designer-deck">
        <h4 id="designer-deck">Every slide</h4>
        <p className="presentation-designer-note">
          One look across the deck: the first slide as its cover, pictures beside their words. Undo puts every slide back.
        </p>
        <div className="presentation-designer-families">
          {DECK_FAMILIES.map((family) => (
            <button key={family.id} type="button" disabled={readOnly} onClick={() => onApplyDeck(family.id)}>
              {family.name}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
