"use client";

import { useState } from "react";
import { SelectField } from "@/components/ui/select";
import { AlertCircle, Copy, ImageIcon, Loader2, RotateCcw, Trash2, Undo2, X } from "@/components/icons/glyph-icons";
import { targetAttrs } from "../../collaboration/target-attributes";
import { isStoredHtml, plainTextFromStored } from "../../rich-content";
import { aiRegionAttr, pathTouches } from "../ai-region-path";
import type { DeckCard } from "../artifact-content-model";
import { ChipInput } from "../sheet/chip-input";
import { SheetMore } from "../sheet/sheet-more";
import { CardDetails, cardDetailsSummary } from "./card-details";
import { CardFace } from "./card-face";
import { CardOcclusion, type MaskHandlers } from "./card-occlusion";

/*
 * One flashcard, written on a sheet (EDITORS.md, "Flashcards"). Front and
 * back are the same plain card, side by side on a wide page and stacked in the side panel. Swap sides turns both
 * over. A picture sits on the face it belongs to; an occlusion card is its
 * picture with patches over it. Tags and a picture are a press away; the rest
 * of a card's settings fold into More options.
 */

const CARD_TYPES = [
  { value: "basic", label: "Front and back" },
  { value: "cloze", label: "Fill the blank" },
  { value: "image_occlusion", label: "Hidden parts of a picture" },
];

export type CardImageState = {
  url?: string;
  busy: boolean;
  error?: string;
  pick: () => void;
  remove: () => void;
  dismissError: () => void;
};

export function CardSheet({
  card,
  cardIndex,
  cardNumber,
  canEdit,
  sections,
  aiChangedPaths = [],
  problem,
  dirty,
  image,
  masks,
  detailsOpen,
  onDetailsOpenChange,
  detailsAiPath,
  onChange,
  onDuplicate,
  onRemove,
  onRevert,
  onFocusSide,
}: {
  card: DeckCard;
  cardIndex: number;
  cardNumber: number;
  canEdit: boolean;
  sections: string[];
  aiChangedPaths?: string[];
  /** Why this card is not ready, in the owner's words: a duplicate, or what it still needs. */
  problem?: string;
  /** The card differs from when it was opened, so it can be put back. */
  dirty: boolean;
  image: CardImageState;
  masks: MaskHandlers;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  /** A folded setting Spectra just changed, so the toggle can carry its target. */
  detailsAiPath?: string;
  onChange: (patch: Partial<DeckCard>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onRevert: () => void;
  onFocusSide: (side: "front" | "back") => void;
}) {
  const [turn, setTurn] = useState(0);
  const cardPath = `/cards/${cardIndex}`;
  const aiField = (suffix: string) => pathTouches(aiChangedPaths, `${cardPath}/${suffix}`);
  const variant = card.variant ?? "basic";
  const occlusion = variant === "image_occlusion";
  const placement = card.media?.placement ?? "front";

  const picture = (side: "front" | "back") =>
    !occlusion && image.url && placement === side ? (
      <figure className="index-card-picture">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={card.media?.altText || card.media?.name || "Card image"} />
        {canEdit ? (
          <button type="button" className="sheet-icon-button" onClick={image.remove} disabled={image.busy} aria-label="Remove card image" title="Remove picture">
            <X className="size-3.5" />
          </button>
        ) : null}
      </figure>
    ) : undefined;

  const swap = () => {
    setTurn((current) => current + 1);
    onChange({ front: card.back, back: card.front });
  };

  return (
    <article className="editor-sheet sheet-leaf card-sheet" data-anchor-region={card.id} aria-label={`Card ${cardNumber}`}>
      <header className="card-sheet-head">
        <div className="card-sheet-head-main">
          <div className="sheet-type-chip" data-ai-region={aiRegionAttr(aiField("variant"))} {...targetAttrs(`${cardPath}/variant`)}>
            <SelectField
              ariaLabel="Card type"
              size="sm"
              disabled={!canEdit}
              value={variant}
              onChange={(next) => {
                const nextVariant = next as DeckCard["variant"];
                onChange({
                  variant: nextVariant,
                  ...(nextVariant !== "basic" ? { bidirectional: false } : {}),
                  // A cloze front is marked in plain text.
                  ...(nextVariant === "cloze" && isStoredHtml(card.front) ? { front: plainTextFromStored(card.front) } : {}),
                });
              }}
              options={CARD_TYPES}
            />
          </div>
          {problem ? (
            <p className="card-sheet-problem" aria-live="polite">
              <AlertCircle className="size-3.5" aria-hidden />
              {problem}
            </p>
          ) : sections.length > 1 ? (
            <span className="sheet-hint">{card.section || "Section 1"}</span>
          ) : null}
        </div>
        {canEdit ? (
          <div className="sheet-tools">
            {dirty ? (
              <button type="button" className="sheet-icon-button" onClick={onRevert} aria-label="Revert this card" title="Put this card back as it was">
                <Undo2 className="size-4" />
              </button>
            ) : null}
            <button type="button" className="sheet-icon-button" onClick={onDuplicate} aria-label="Duplicate card" title="Duplicate">
              <Copy className="size-4" />
            </button>
            <button type="button" className="sheet-icon-button" onClick={onRemove} aria-label="Remove card" title="Remove">
              <Trash2 className="size-4" />
            </button>
          </div>
        ) : null}
      </header>

      {occlusion ? (
        <CardOcclusion
          card={card}
          imageUrl={image.url}
          canEdit={canEdit}
          busy={image.busy}
          masks={masks}
          onPickImage={image.pick}
          onChange={onChange}
        />
      ) : null}

      <div className="index-card-pair" data-occlusion={occlusion || undefined}>
        <CardFace
          key={variant}
          side="front"
          value={card.front}
          placeholder={variant === "cloze" ? "Write the sentence, then hide the words to recall" : occlusion ? "What to name (optional)" : "The question or prompt"}
          disabled={!canEdit}
          cloze={variant === "cloze"}
          onChange={(front) => onChange({ front })}
          onFocus={() => onFocusSide("front")}
          aiActive={aiField("front")}
          path={`${cardPath}/front`}
          picture={picture("front")}
          turn={turn}
        />
        <CardFace
          side="back"
          value={card.back}
          placeholder="The answer"
          disabled={!canEdit}
          onChange={(back) => onChange({ back })}
          onFocus={() => onFocusSide("back")}
          aiActive={aiField("back")}
          path={`${cardPath}/back`}
          note={{ value: card.hint ?? "", onChange: (hint) => onChange({ hint }), aiActive: aiField("hint"), path: `${cardPath}/hint` }}
          picture={picture("back")}
          turn={turn}
        />
        {/* After both sides, so Tab goes from the prompt straight to the answer. */}
        {canEdit && !occlusion ? (
          <button type="button" className="index-card-swap" onClick={swap} aria-label="Swap sides" title="Swap front and back">
            <RotateCcw className="size-4" />
          </button>
        ) : (
          <span className="index-card-gap" aria-hidden />
        )}
      </div>

      <div className="card-sheet-adds">
        {canEdit && !occlusion && !card.media ? (
          <button type="button" className="sheet-quiet" onClick={image.pick} disabled={image.busy}>
            {image.busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />} Add picture
          </button>
        ) : null}
        {canEdit && occlusion && card.media ? (
          <button type="button" className="sheet-quiet" onClick={image.pick} disabled={image.busy}>
            {image.busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />} Replace picture
          </button>
        ) : null}
        <ChipInput
          label="tag"
          values={card.tags ?? []}
          max={8}
          disabled={!canEdit}
          onChange={(tags) => onChange({ tags })}
          attrs={{ "aria-label": "Tags", ...targetAttrs(`${cardPath}/tags`) }}
        />
      </div>
      {image.error ? (
        <p className="card-sheet-problem" role="alert">
          <AlertCircle className="size-3.5" aria-hidden />
          {image.error}
          <button type="button" className="sheet-quiet" onClick={image.dismissError}>
            Dismiss
          </button>
        </p>
      ) : null}

      <SheetMore
        open={detailsOpen}
        onOpenChange={onDetailsOpenChange}
        summary={cardDetailsSummary(card)}
        toggleAttrs={detailsAiPath ? targetAttrs(detailsAiPath) : undefined}
      >
        <CardDetails card={card} cardPath={cardPath} sections={sections} canEdit={canEdit} aiField={aiField} onChange={onChange} />
      </SheetMore>
    </article>
  );
}
