"use client";

import { useMemo } from "react";
import { svgImageSource } from "../presentation/diagram-image";
import { SandboxedArtifactRuntime } from "./sandboxed-artifact-runtime";

/**
 * A diagram on a slide is code Spectra wrote, drawn in place. It is not a work of
 * its own and there's no editor for it: people move and size it like any other
 * object, and ask Spectra to change the drawing. SVG is shown as a plain image, so it
 * can't run anything and costs nothing. Anything livelier runs in the same sandbox
 * as the code studio, and only on the slide being looked at.
 */
export function SlideDiagram({ code, alt, compact }: { code: string; alt?: string; compact: boolean }) {
  const source = code.trim();
  const image = useMemo(() => svgImageSource(source), [source]);
  const files = useMemo(() => [{ id: "diagram", path: "index.html", language: "html", source }], [source]);
  if (image)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={alt ?? ""}
        draggable={false}
        className="h-full w-full object-contain"
      />
    );
  if (compact)
    return (
      <div className="presentation-native-object" role="img" aria-label={alt ?? "Diagram"}>
        <strong>Diagram</strong>
        {alt ? <span>{alt}</span> : null}
      </div>
    );
  return (
    <SandboxedArtifactRuntime
      title={alt ?? "Diagram"}
      files={files}
      compact
      toolbar={false}
      className="pointer-events-none h-full w-full"
    />
  );
}
