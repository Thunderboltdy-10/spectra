/*
 * A diagram on a slide is SVG code. On screen it's drawn in place; a PowerPoint
 * or PDF needs it as a picture, so it is drawn to one here, in the browser.
 */

/** The diagram's code when this object is one. */
export function diagramCode(object: { type?: string; content?: unknown }) {
  if (object.type !== "embed" || !object.content || typeof object.content !== "object") return null;
  const diagram = (object.content as { diagram?: { code?: unknown } }).diagram;
  return typeof diagram?.code === "string" && diagram.code.trim() ? diagram.code.trim() : null;
}

/**
 * Drawing SVG as an image is stricter than drawing it in a page: it needs its
 * namespace and has to be well-formed. Code that isn't can't be drawn this way.
 */
export function svgImageSource(source: string) {
  if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source)) return null;
  const namespaced = /<svg[^>]*\sxmlns=/i.test(source)
    ? source
    : source.replace(/<svg(?=[\s>])/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (typeof DOMParser !== "undefined" && new DOMParser().parseFromString(namespaced, "image/svg+xml").querySelector("parsererror"))
    return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(namespaced)}`;
}

/** The diagram at this size, kept in proportion and centred; null when it can't be drawn as a picture. */
export async function diagramPicture(code: string, width: number, height: number, sharpness = 3) {
  const source = svgImageSource(code);
  if (!source) return null;
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = source;
  });
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * sharpness));
  canvas.height = Math.max(1, Math.round(height * sharpness));
  const context = canvas.getContext("2d");
  if (!context) return null;
  const ratio = (image.naturalWidth || 4) / (image.naturalHeight || 3);
  const drawWidth = Math.min(canvas.width, canvas.height * ratio);
  const drawHeight = drawWidth / ratio;
  context.drawImage(image, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
  return canvas;
}
