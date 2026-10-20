"use client";

import { useRef } from "react";
import { ImageIcon, Loader2, X } from "@/components/icons/glyph-icons";

/*
 * The picture a question asks about (EDITORS.md, "Quiz"). It sits under the
 * question, where the learner will see it, with its description beneath; until
 * there is one it is a quiet "Add image" beside "Add explanation". Dropping an
 * image anywhere on the sheet does the same.
 */

export type QuestionImageState = {
  url?: string;
  uploading: boolean;
  error?: string;
  upload: (file: File) => void;
  remove: () => void;
};

export function QuestionImage({ media, image, onAltText }: { media: { altText?: string }; image: QuestionImageState; onAltText: (altText: string) => void }) {
  return (
    <figure className="quiz-image">
      {image.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url} alt={media.altText ?? ""} />
      ) : (
        <div className="quiz-image-missing">
          <ImageIcon className="size-4" aria-hidden /> The image is not available
        </div>
      )}
      <figcaption>
        <input
          className="quiz-image-alt"
          value={media.altText ?? ""}
          placeholder="Describe the image for anyone who cannot see it"
          aria-label="Image description"
          onChange={(event) => onAltText(event.target.value)}
        />
        <button type="button" className="sheet-icon-button" aria-label="Remove image" title="Remove image" onClick={image.remove}>
          <X className="size-3.5" />
        </button>
      </figcaption>
    </figure>
  );
}

export function AddImageButton({ image }: { image: QuestionImageState }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="sheet-quiet" disabled={image.uploading} onClick={() => input.current?.click()}>
        {image.uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
        {image.uploading ? "Adding image" : "Add image"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) image.upload(file);
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}
