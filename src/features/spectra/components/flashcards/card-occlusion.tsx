"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { ImageIcon, Loader2, X } from "@/components/icons/glyph-icons";
import type { DeckCard } from "../artifact-content-model";

/*
 * An image occlusion card: the picture with numbered patches stuck over the
 * parts to recall. Dragging across the picture lays a new patch; pressing a
 * patch peels it off. Each patch may carry the word shown when it is revealed.
 */

export type MaskDraft = { x: number; y: number; currentX: number; currentY: number };

export type MaskHandlers = {
  draft?: MaskDraft;
  begin: (event: ReactPointerEvent<HTMLDivElement>) => void;
  move: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finish: (event: ReactPointerEvent<HTMLDivElement>) => void;
  cancel: () => void;
};

export function CardOcclusion({
  card,
  imageUrl,
  canEdit,
  busy,
  masks,
  onPickImage,
  onChange,
}: {
  card: DeckCard;
  imageUrl?: string;
  canEdit: boolean;
  busy: boolean;
  masks: MaskHandlers;
  onPickImage: () => void;
  onChange: (patch: Partial<DeckCard>) => void;
}) {
  const occlusions = card.occlusions ?? [];
  const removeMask = (maskId: string) => onChange({ occlusions: occlusions.filter((mask) => mask.id !== maskId) });

  if (!imageUrl) {
    return canEdit ? (
      <button type="button" className="occlusion-empty" onClick={onPickImage} disabled={busy}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : <ImageIcon className="size-5" />}
        <strong>Add the diagram to study</strong>
        <span>PNG, JPEG, WebP or GIF</span>
      </button>
    ) : (
      <p className="occlusion-empty">This card has no image yet.</p>
    );
  }

  const draft = masks.draft;
  return (
    <section className="occlusion" aria-label="Hidden regions">
      <div
        className="occlusion-stage"
        data-editable={canEdit || undefined}
        onPointerDown={canEdit ? masks.begin : undefined}
        onPointerMove={canEdit ? masks.move : undefined}
        onPointerUp={canEdit ? masks.finish : undefined}
        onPointerCancel={masks.cancel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={card.media?.altText || card.media?.name || "Card image"} draggable={false} />
        {occlusions.map((mask, index) => (
          <button
            key={mask.id}
            type="button"
            className="occlusion-patch"
            style={{ left: `${mask.x * 100}%`, top: `${mask.y * 100}%`, width: `${mask.width * 100}%`, height: `${mask.height * 100}%` }}
            title={canEdit ? "Peel off this patch" : undefined}
            disabled={!canEdit}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              removeMask(mask.id);
            }}
          >
            {index + 1}
          </button>
        ))}
        {draft ? (
          <span
            className="occlusion-patch occlusion-patch--draft"
            style={{
              left: `${Math.min(draft.x, draft.currentX) * 100}%`,
              top: `${Math.min(draft.y, draft.currentY) * 100}%`,
              width: `${Math.abs(draft.currentX - draft.x) * 100}%`,
              height: `${Math.abs(draft.currentY - draft.y) * 100}%`,
            }}
          />
        ) : null}
      </div>
      <p className="sheet-hint">
        {occlusions.length
          ? `${occlusions.length} hidden ${occlusions.length === 1 ? "region" : "regions"}, revealed with the answer`
          : canEdit
            ? "Drag across the picture to hide the first region"
            : "Nothing hidden yet"}
      </p>
      {occlusions.length ? (
        <ol className="occlusion-labels">
          {occlusions.map((mask, index) => (
            <li key={mask.id}>
              <span className="occlusion-label-number">{index + 1}</span>
              <input
                className="occlusion-label-text"
                value={mask.label ?? ""}
                onChange={(event) =>
                  onChange({ occlusions: occlusions.map((candidate) => (candidate.id === mask.id ? { ...candidate, label: event.target.value } : candidate)) })
                }
                placeholder="Word shown when revealed"
                readOnly={!canEdit}
                aria-label={`Label for hidden region ${index + 1}`}
              />
              {canEdit ? (
                <button type="button" className="sheet-icon-button" onClick={() => removeMask(mask.id)} aria-label={`Remove hidden region ${index + 1}`}>
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
