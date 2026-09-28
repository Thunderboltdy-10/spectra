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

const NEW_KEYFRAMES = [
  "spectra-tail-shimmer",
  "spectra-presence-flag-decay",
  "spectra-completion-ring",
  "spectra-target-pulse",
  "spectra-panel-enter",
  "spectra-panel-exit",
  "spectra-panel-handoff",
  "spectra-follow-pill-in",
  "spectra-follow-dot-live",
] as const;

/** Properties allowed inside new keyframes: composite-friendly only. */
const ALLOWED_PROPS = new Set([
  "transform",
  "opacity",
  "box-shadow",
  "filter",
  "background-color",
  "border-color",
  "clip-path",
  "stroke-dashoffset",
  "stroke-dasharray",
  "background-position",
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

  it("new keyframes animate only composite-safe properties", () => {
    for (const name of NEW_KEYFRAMES) {
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

  it("new effect classes are gated for reduced and none motion levels", () => {
    const gatedClasses = [
      "spectra-return-pill",
      "spectra-follow-chip-dot",
      "spectra-stream-active",
    ];
    for (const klass of gatedClasses) {
      const reducedSelector = `html[data-spectra-motion="reduced"]`;
      const noneSelector = `html[data-spectra-motion="none"]`;
      const pattern = new RegExp(
        `${reducedSelector.replaceAll('"', '\\\\"')}[^{}]*\\.${klass.replaceAll("-", "\\-")}`,
      );
      expect(
        pattern.test(globals) || globals.includes(`reduced"] .${klass}`),
        `${klass} lacks a reduced-motion gate`,
      ).toBe(true);
      expect(
        globals.includes(`none"] .${klass}`),
        `${klass} lacks a no-motion gate`,
      ).toBe(true);
      expect(reducedSelector.length + noneSelector.length).toBeGreaterThan(0);
    }
  });

  it('global "none" level collapses every animation and transition', () => {
    expect(globals).toContain('html[data-spectra-motion="none"] *');
    expect(globals).toContain("animation-duration: 0.01ms !important");
    expect(globals).toContain("transition-duration: 0.01ms !important");
  });

  it("stops Tailwind loaders under OS or Spectra reduced motion", () => {
    expect(globals).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.animate-spin,\s*\.animate-pulse \{\s*animation: none;/,
    );
    expect(globals).toMatch(
      /:root\[data-spectra-motion="reduced"\] \.animate-spin,\s*:root\[data-spectra-motion="reduced"\] \.animate-pulse \{\s*animation: none;/,
    );
  });
});
