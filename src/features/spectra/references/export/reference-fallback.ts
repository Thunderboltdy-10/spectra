export type ReferenceFallback = {
  title: string;
  typeLabel: string;
  sourceArtifactId: string;
  sourceUrl: string;
  versionLabel: "Live" | "Pinned";
};

function escapeXml(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clipped(value: string, length: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > length
    ? `${normalized.slice(0, length - 1).trimEnd()}...`
    : normalized;
}

export function referenceFallbackSvg(fallback: ReferenceFallback) {
  const title = escapeXml(clipped(fallback.title || "Spectra reference", 70));
  const type = escapeXml(clipped(fallback.typeLabel || "Referenced artifact", 40));
  const url = escapeXml(clipped(fallback.sourceUrl, 94));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420" viewBox="0 0 960 420" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">${type} reference. ${fallback.versionLabel} in Spectra.</desc>
  <rect width="960" height="420" fill="#fbfbf8"/>
  <rect x="2" y="2" width="956" height="416" rx="18" fill="var(--bg-elevated)" stroke="#d9d9d3" stroke-width="4"/>
  <rect x="48" y="52" width="70" height="70" rx="14" fill="#f0edff"/>
  <text x="83" y="101" fill="var(--brand-primary)" text-anchor="middle" font-family="Manrope, Segoe UI, sans-serif" font-size="34" font-weight="800">S</text>
  <text x="150" y="82" fill="#686965" font-family="Manrope, Segoe UI, sans-serif" font-size="24" font-weight="700">${type}</text>
  <text x="150" y="116" fill="#858680" font-family="Manrope, Segoe UI, sans-serif" font-size="20">${fallback.versionLabel} Spectra reference</text>
  <text x="48" y="210" fill="#242622" font-family="Manrope, Segoe UI, sans-serif" font-size="42" font-weight="700">${title}</text>
  <line x1="48" y1="276" x2="912" y2="276" stroke="#e4e4de" stroke-width="2"/>
  <text x="48" y="326" fill="#686965" font-family="Manrope, Segoe UI, sans-serif" font-size="21">Open the live source in Spectra</text>
  <text x="48" y="364" fill="var(--brand-primary)" font-family="Manrope, Segoe UI, sans-serif" font-size="18">${url}</text>
</svg>`;
}

export async function renderReferenceFallbackPng(fallback: ReferenceFallback) {
  const svg = referenceFallbackSvg(fallback);
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 420;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("REFERENCE_FALLBACK_CANVAS_UNAVAILABLE");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("REFERENCE_FALLBACK_RENDER_FAILED")),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
