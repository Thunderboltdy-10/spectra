import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import spectraDesignRules from "./scripts/eslint/spectra-design-rules.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  /*
   * Design-system baseline (P0.I4, ARCHITECTURE-PLATFORM §3): warn while the
   * adoption sweep burns the pre-existing escapes down; directories that are
   * clean flip to "error" below, starting with the primitive floor itself.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { spectra: spectraDesignRules },
    rules: {
      "spectra/no-arbitrary-value-classes": "warn",
      "spectra/no-numeric-z-index": "warn",
      "spectra/no-raw-hex-in-styles": "warn",
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "spectra/no-arbitrary-value-classes": "error",
      "spectra/no-numeric-z-index": "error",
      "spectra/no-raw-hex-in-styles": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
    "v1/**",
    "ai-education-workspace-landing-page/**",
    "workers/**",
    ".tmp-*/**",
    "bridge/target/**",
    // Generated browser scripts, immutable verification evidence, and local
    // runtime state are not product source. P6 keeps their exclusion narrow;
    // all src/ design and correctness rules remain enabled.
    ".playwright-cli/**",
    ".shots/**",
    ".spectra-local/**",
    // The portfolio film is its own Remotion package.
    "film/**",
    "scripts/final-verification/playwright/**",
  ]),
]);

export default eslintConfig;
