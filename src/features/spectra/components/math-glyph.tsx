"use client";

import katex from "katex";
import { memo, useLayoutEffect, useRef } from "react";
import { mathGalleryPreview } from "../editor/equation-gallery";

const drawn = new Map<string, string>();

/** One gallery tile's maths, drawn once and kept: a gallery opens again at once. */
function draw(latex: string, display: boolean) {
  const key = `${display ? "D" : "T"}${latex}`;
  let html = drawn.get(key);
  if (html === undefined) {
    html = katex.renderToString(mathGalleryPreview(latex), { throwOnError: false, displayMode: display, strict: "ignore" });
    drawn.set(key, html);
  }
  return html;
}

export const MathGlyph = memo(function MathGlyph({
  latex,
  display = false,
  className,
  fit = false,
}: {
  latex: string;
  display?: boolean;
  className?: string;
  /** Shrinks the maths until it fits its box, as a gallery tile needs for a large matrix. */
  fit?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const span = ref.current;
    const box = span?.parentElement;
    if (!fit || !span || !box) return;
    span.style.fontSize = "";
    const style = getComputedStyle(box);
    const room = {
      width: box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    };
    const size = span.getBoundingClientRect();
    if (!size.width || !size.height || room.width <= 0 || room.height <= 0) return;
    const scale = Math.min(1, room.width / size.width, room.height / size.height);
    if (scale < 1) span.style.fontSize = `${Math.floor(scale * 100)}%`;
  }, [fit, latex, display]);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={className ? `spectra-math-glyph ${className}` : "spectra-math-glyph"}
      dangerouslySetInnerHTML={{ __html: draw(latex, display) }}
    />
  );
});
