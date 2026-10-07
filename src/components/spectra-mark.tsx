import { useId } from "react";
import { MARK_POSE, PRISM_PALETTES, prismSvgMarkup } from "@/features/spectra/life/prism";

/*
 * Spectra's mark: the prism at rest, drawn from the same display list as the
 * island's live prism and the favicon (LIFE.md, "The prism"), so there is one
 * object at every size. Both themes are in the markup and the page's theme
 * shows one, so a server-rendered mark is right before any script runs.
 */

const BOX = 64;
const OPTIONS = { size: BOX, detail: "mark" } as const;

export function SpectraMark({
  size = 32,
  className,
  style,
  mono = false,
  title,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  /** In the surrounding text colour: inside a coloured chip or a line of text. */
  mono?: boolean;
  title?: string;
}) {
  const id = `m${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const markup = mono
    ? prismSvgMarkup(MARK_POSE, { ...OPTIONS, palette: PRISM_PALETTES.light }, { id, mono: true })
    : `<g class="spectra-mark-light">${prismSvgMarkup(MARK_POSE, { ...OPTIONS, palette: PRISM_PALETTES.light }, { id: `${id}l` })}</g>` +
      `<g class="spectra-mark-dark">${prismSvgMarkup(MARK_POSE, { ...OPTIONS, palette: PRISM_PALETTES.dark }, { id: `${id}d` })}</g>`;
  return (
    <svg
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={size}
      height={size}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`spectra-mark${className ? ` ${className}` : ""}`}
      style={{ display: "block", flexShrink: 0, overflow: "visible", ...style }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
