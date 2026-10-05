import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAYERS, LAYER_CLASS } from "@/components/ui/layers";

/**
 * The stacking contract, proven from its own files (ARCHITECTURE-PLATFORM §3).
 *
 * The defect this guards against is numeric negotiation: 90/94/95/96 sibling
 * dialogs, a z-220 composer, a z-chrome0 share dialog, two 2147483000s. The
 * contract only survives if the tokens exist, stay ordered, map to classes
 * every primitive uses, and no overlay can take a number instead of a name.
 */

const TOKENS_PATH = join(process.cwd(), "src/styles/spectra-tokens.css");
const APP_CSS_PATH = join(process.cwd(), "src/styles/spectra-app.css");
const COOKIE_CONSENT_PATH = join(
  process.cwd(),
  "src/components/cookie-consent-manager.tsx",
);

const EXPECTED: Array<[string, number]> = [
  ["base", 0],
  ["chrome", 40],
  ["dropdown", 60],
  ["panel", 80],
  ["modal", 100],
  ["composer-dock", 120],
  ["toast", 140],
];

describe("layering contract", () => {
  const tokens = readFileSync(TOKENS_PATH, "utf8");

  it("declares exactly the seven layers, in contract order", () => {
    expect(LAYERS).toEqual(EXPECTED.map(([name]) => name));
  });

  it("wires each layer to its Tailwind z-* class and its --z-* token", () => {
    for (const [name, value] of EXPECTED) {
      expect(LAYER_CLASS[name as (typeof LAYERS)[number]]).toBe(`z-${name}`);
      expect(tokens).toMatch(new RegExp(`--z-${name}\\s*:\\s*${value}\\s*;`));
    }
  });

  it("exposes every layer through the @theme so the utilities exist", () => {
    for (const [name] of EXPECTED) {
      expect(tokens).toMatch(new RegExp(`--z-index-${name}\\s*:`));
    }
  });

  it("keeps the order: chrome < dropdown < panel < modal < composer-dock < toast", () => {
    const values = EXPECTED.map(([, value]) => value);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1]!);
    }
  });

  it("keeps global consent decisions above the composer dock", () => {
    const consentSource = readFileSync(COOKIE_CONSENT_PATH, "utf8");
    expect(consentSource).toContain("bottom-4 z-toast");
    expect(consentSource).toContain('layer="toast"');
    expect(consentSource).toContain("<Dialog open={settingsOpen}");
    expect(consentSource).toContain("<DialogTrigger asChild>");
    expect(consentSource).not.toMatch(/z-(?:chrome|modal)/);
    expect(consentSource).not.toContain('className="fixed inset-0');
  });

  it("mutes the island while a modal dialog or version history overlay is open", () => {
    const appCss = readFileSync(APP_CSS_PATH, "utf8");
    expect(appCss).toMatch(/body:has\(\[role="dialog"\]\[aria-modal="true"\]\) \[data-island-root\],/);
    expect(appCss).toMatch(/body:has\(\[role="dialog"\]\[aria-modal="true"\]\) \[data-island-root\] \*/);
    expect(appCss).toMatch(/body:has\(\[aria-label="Version history comparison"\]\) \[data-island-root\]/);
    expect(appCss).not.toContain("spectra-workbench-live-stack");
    const adminDialog = readFileSync(
      join(process.cwd(), "src/features/spectra/administration/shared.tsx"),
      "utf8",
    );
    // The admin dialog must portal to <body> as an aria-modal dialog so the
    // mute above applies. The shared DialogContent does both (see
    // modal-focus.test), so it must stay on it rather than a hand-rolled portal.
    expect(adminDialog).toContain("@/components/ui/dialog");
    expect(adminDialog).toMatch(/<DialogContent\s+layer="composer-dock"/);
    const dialogSource = readFileSync(
      join(process.cwd(), "src/components/ui/dialog.tsx"),
      "utf8",
    );
    expect(dialogSource).toContain('aria-modal="true"');
    expect(adminDialog).not.toContain("createPortal");
  });
});

describe("focus suppression (DS-4) stays deleted", () => {
  const appCss = readFileSync(APP_CSS_PATH, "utf8");

  it("has no global :focus-visible kill on form elements", () => {
    expect(appCss).not.toMatch(
      new RegExp(
        "^(input|textarea|select):focus-visible[^\\{]*\\{[^\\}]*outline:\\s*none\\s*!important",
        "ms",
      ),
    );
  });

  it("keeps the global focus ring that replaces it", () => {
    expect(appCss).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring\)/,
    );
  });
});
