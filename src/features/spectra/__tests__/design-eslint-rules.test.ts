import { describe, expect, it } from "vitest";
import { Linter, type ESLint } from "eslint";
import spectraDesignRules from "../../../../scripts/eslint/spectra-design-rules.mjs";

/**
 * The baseline ESLint rules, proved against the escapes they exist to catch
 * (DS-1: 5,090 arbitrary values, 267 hexes, ~57 z-index values). A rule nobody
 * can fire is just a second census waiting to drift.
 */

const linter = new Linter({ configType: "flat" });

const ruleConfig: Linter.Config = {
  plugins: { spectra: spectraDesignRules as unknown as ESLint.Plugin },
  rules: {
    "spectra/no-arbitrary-value-classes": "error",
    "spectra/no-numeric-z-index": "error",
    "spectra/no-raw-hex-in-styles": "error",
  },
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
};

function lint(code: string) {
  return linter.verify(code, ruleConfig);
}

const render = (classExpr: string) =>
  `export function X() { return <div className={${classExpr}} />; }`;

describe("spectra/no-arbitrary-value-classes", () => {
  it("flags literal type, radius and shadow escapes", () => {
    const messages = lint(
      render('"text-[11px] rounded-[7px] shadow-[0_1px_2px_rgba(0,0,0,.2)]"'),
    );
    expect(
      messages.filter((m) => m.ruleId === "spectra/no-arbitrary-value-classes"),
    ).toHaveLength(3);
  });

  it("flags literal colour but not color-mix over tokens", () => {
    expect(lint(render('"bg-[#8b6ff0]"'))).toHaveLength(1);
    expect(lint(render('"bg-[rgba(27,20,12,0.2)]"'))).toHaveLength(1);
    expect(
      lint(
        render(
          '"bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-primary))]"',
        ),
      ),
    ).toHaveLength(0);
  });

  it("leaves token references and keyword radii alone", () => {
    expect(
      lint(render('"text-micro rounded-card shadow-[var(--shadow-lg)]"')),
    ).toHaveLength(0);
    expect(
      lint(render('"rounded-[var(--radius-container)] rounded-[inherit]"')),
    ).toHaveLength(0);
  });

  it("sees through cn() composition and template literals", () => {
    const messages = lint(
      render(
        "cn('text-[12px]', cond && `bg-[#ffffff]`, { 'rounded-[9px]': cond })",
      ),
    );
    expect(
      messages.filter((m) => m.ruleId === "spectra/no-arbitrary-value-classes"),
    ).toHaveLength(3);
  });

  it("flags raw hex anywhere in a class string", () => {
    const messages = lint(
      render(
        '"focus-visible:ring-[color-mix(in_oklab,#8b6ff0_55%,transparent)]"',
      ),
    );
    expect(messages.some((m) => m.messageId === "hex")).toBe(true);
  });
});

describe("spectra/no-numeric-z-index", () => {
  it("flags z utilities and literal zIndex styles", () => {
    expect(
      lint(render('"fixed inset-0 z-50"')).some(
        (m) => m.ruleId === "spectra/no-numeric-z-index",
      ),
    ).toBe(true);
    expect(
      lint(render('"absolute z-[220]"')).some(
        (m) => m.ruleId === "spectra/no-numeric-z-index",
      ),
    ).toBe(true);
    const styled = lint(
      `export function X() { return <div style={{ zIndex: 400 }} />; }`,
    );
    expect(
      styled.filter((m) => m.ruleId === "spectra/no-numeric-z-index"),
    ).toHaveLength(1);
  });

  it("accepts the named layers", () => {
    expect(
      lint(render('"fixed inset-0 z-modal z-composer-dock z-toast"')).filter(
        (m) => m.ruleId === "spectra/no-numeric-z-index",
      ),
    ).toHaveLength(0);
  });
});

describe("spectra/no-raw-hex-in-styles", () => {
  it("flags hex in style object colour properties", () => {
    const messages = lint(
      `export function X() { return <div style={{ backgroundColor: "#8b6ff0", opacity: 0.5 }} />; }`,
    );
    expect(
      messages.filter((m) => m.ruleId === "spectra/no-raw-hex-in-styles"),
    ).toHaveLength(1);
  });

  it("ignores non-colour properties and var() colours", () => {
    expect(
      lint(
        `export function X() { return <div style={{ backgroundColor: "var(--bg-primary)", top: 12 }} />; }`,
      ),
    ).toHaveLength(0);
  });
});
