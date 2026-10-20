"use client";

/*
 * The app's typefaces for a show_widget frame. The frame has no network (its
 * CSP allows data: fonts only), so the app reads its own @font-face rules for
 * Figtree, Newsreader and Plex Mono, fetches their Latin files once from its
 * own origin, and hands the frame the same faces as data: URLs. A visual in
 * the conversation is then set in the conversation's type, not system-ui.
 */

const FAMILIES = new Set(["Figtree", "Newsreader", "IBM Plex Mono"]);
/** next/font splits each family by script; the Latin file covers U+0-FF. */
const LATIN = /U\+0-FF\b/i;

let pending: Promise<string> | null = null;

function familyOf(rule: CSSFontFaceRule) {
  return rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
}

function latinFaces() {
  const faces: Array<{ rule: CSSFontFaceRule; base: string }> = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules))
      if (rule instanceof CSSFontFaceRule && FAMILIES.has(familyOf(rule)) && LATIN.test(rule.style.getPropertyValue("unicode-range")))
        faces.push({ rule, base: sheet.href ?? document.baseURI });
  }
  return faces;
}

async function dataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:font/woff2;base64,${btoa(binary)}`;
}

async function inlineFace({ rule, base }: { rule: CSSFontFaceRule; base: string }) {
  const match = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"));
  if (!match?.[1]) return "";
  const source = await dataUrl(new URL(match[1], base).href);
  const descriptor = (name: string) => rule.style.getPropertyValue(name).trim();
  return [
    "@font-face{",
    `font-family:"${familyOf(rule)}";`,
    `src:url(${source}) format("woff2");`,
    ...["font-style", "font-weight", "font-stretch"].flatMap((name) => (descriptor(name) ? [`${name}:${descriptor(name)};`] : [])),
    "font-display:swap}",
  ].join("");
}

/** The app's Latin faces as data: URL @font-face rules; "" when none can be read. */
export function widgetFontCss(): Promise<string> {
  if (typeof document === "undefined") return Promise.resolve("");
  if (pending) return pending;
  const read = Promise.all(latinFaces().map((face) => inlineFace(face).catch(() => ""))).then((faces) => faces.filter(Boolean).join("\n"));
  pending = read;
  // A failed read is not kept: the next widget tries again.
  void read.then((css) => {
    if (!css && pending === read) pending = null;
  });
  return read;
}
