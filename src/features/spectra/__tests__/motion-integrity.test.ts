// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static motion-integrity gates (Phase 14.9, INV-22):
 *
 * 1. Animation is presentation-only. Canonical content must reach the
 *    canonical renderer un-gated; reveal scheduling never delays or alters
 *    the semantic state that persistence, completion and a11y depend on.
 * 2. New animation keyframes animate only composite-safe properties so they
 *    can never thrash layout mid-motion.
 * 3. Reduced-motion gating exists for every new effect class.
 */

const globals = [
  "src/app/globals.css",
  "src/styles/spectra-tokens.css",
  "src/styles/spectra-app.css",
  "src/styles/spectra-landing.css",
  "src/styles/spectra-field.css",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const conversationSurface = readFileSync(
  "src/features/spectra/components/conversation-surface.tsx",
  "utf8",
);

/** Every keyframe in the product (the landing page included). A new one is
    checked the moment it is written; there is no list to remember. */
const ALL_KEYFRAMES = [
  ...new Set([...globals.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]!)),
];

/** Properties keyframes may animate: composite or paint only, never layout. */
const ALLOWED_PROPS = new Set([
  "transform",
  // The landing page's name sweep: a registered property on one word of type.
  "--sweep",
  // The sign-in frame's turning light: a registered angle on one border.
  "--auth-turn",
  // The individual transform properties are composited like transform. A
  // keyframe on `scale` lifts a board node without overriding the transform
  // that places it.
  "scale",
  "translate",
  "rotate",
  "opacity",
  "box-shadow",
  "filter",
  "background-color",
  "border-color",
  "clip-path",
  "stroke-dashoffset",
  "stroke-dasharray",
  "background-position",
  "background-position-x",
  "background",
  "color",
  "stroke-opacity",
  "fill-opacity",
]);

function keyframeBlock(name: string): string {
  const start = globals.indexOf(`@keyframes ${name}`);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let end = start;
  for (; end < globals.length; end += 1) {
    const char = globals[end];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return globals.slice(start, end + 1);
}

describe("motion integrity", () => {
  it("INV-22: canonical streamed content renders without animation gating", () => {
    // The canonical live exchange must pass straight through the rich-content
    // renderer; the reveal layer is a sibling wrapper, not a filter.
    expect(conversationSurface).toContain("content={liveExchange.content}");
    expect(conversationSurface).toContain("LiveContentReveal");
  });

  it("every keyframe animates only composite-safe properties", () => {
    expect(ALL_KEYFRAMES.length).toBeGreaterThan(20);
    for (const name of ALL_KEYFRAMES) {
      const block = keyframeBlock(name);
      const animated = new Set<string>();
      for (const match of block.matchAll(/([a-z-]+)\s*:/g)) {
        const prop = match[1]!;
        // `from`, `to`, `0%`, timing phrases are selectors, not declarations.
        if (["from", "to"].includes(prop)) continue;
        if (/^\d/.test(prop)) continue;
        animated.add(prop);
      }
      for (const prop of animated) {
        expect(
          ALLOWED_PROPS.has(prop),
          `@keyframes ${name} animates layout property "${prop}"`,
        ).toBe(true);
      }
    }
  });

  it("one reduced-motion contract covers every animation, from the preference and the OS", () => {
    // Every element (and pseudo-element) collapses keyframe animations to a
    // single near-instant iteration under the "reduced" and "none" levels
    // and under the OS setting, so no animation needs a per-class gate and a
    // new one cannot ship without a reduced-motion path.
    for (const level of ["reduced", "none"]) {
      expect(globals).toContain(
        `html[data-spectra-motion="${level}"] *::before`,
      );
    }
    expect(globals).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{[^}]*--motion-fast: 0ms;[^}]*\}\s*\*,\s*\*::before,\s*\*::after \{\s*animation-duration: 0\.01ms !important;\s*animation-iteration-count: 1 !important;/,
    );
    expect(globals).toContain("transition-duration: 0.01ms !important");
    // Loaders and shimmers are stopped by the contract, not bespoke rules.
    expect(globals).not.toMatch(
      /\.animate-spin,\s*\.animate-pulse \{\s*animation: none;/,
    );
  });
});
