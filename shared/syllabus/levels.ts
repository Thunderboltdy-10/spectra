import type { SyllabusLevel } from "./types";

/** A heading that ends "(HL)" or "(AHL)" opens a section only HL students take. */
export const HL_HEADING = /\((?:A?HL)(?: only)?\)\s*$/i;
const SL_HEADING = /\(SL(?: only)?\)\s*$/i;

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```/;

/** Every heading, its depth, and whether it sits in an HL-only section. */
export function outlineOf(markdown: string) {
  const out: Array<{ heading: string; depth: number; hlOnly: boolean; slOnly?: boolean }> = [];
  const open: Array<{ depth: number; hl: boolean; sl: boolean }> = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(line);
    if (!heading) continue;
    const depth = heading[1]!.length;
    while (open.length && open[open.length - 1]!.depth >= depth) open.pop();
    const hl = HL_HEADING.test(heading[2]!) || open.some((item) => item.hl);
    const sl = SL_HEADING.test(heading[2]!) || open.some((item) => item.sl);
    open.push({ depth, hl, sl });
    out.push({ heading: heading[2]!.trim(), depth, hlOnly: hl, ...(sl ? { slOnly: true } : {}) });
  }
  return out;
}

/** Drop sections belonging only to the other level, including its assessment. */
export function markdownForLevel(markdown: string, level: SyllabusLevel | null | undefined) {
  if (!level) return markdown;
  const out: string[] = [];
  let skipping: number | null = null;
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      if (skipping !== null && depth <= skipping) skipping = null;
      if (skipping === null && (level === "SL" ? HL_HEADING : SL_HEADING).test(heading[2]!)) skipping = depth;
    }
    if (skipping === null) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
