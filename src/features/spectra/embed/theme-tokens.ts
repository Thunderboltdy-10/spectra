// Only presentation values cross the frame boundary, never all root variables.
export const SPECTRA_EMBED_THEME_TOKENS = [
  "--bg-primary",
  "--bg-secondary",
  "--bg-tertiary",
  "--bg-elevated",
  "--bg-hover",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
  "--text-inverse",
  "--border-default",
  "--border-subtle",
  "--border-strong",
  "--brand-primary",
  "--brand-accent",
  "--accent-cyan",
  "--accent-violet",
  "--accent-mint",
  "--accent-gold",
  "--accent-orange",
  "--accent-coral",
  "--danger",
  "--success",
  "--warning",
  "--font-sans",
  "--font-display",
  "--font-mono",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
  "--radius-container",
  "--radius-input",
  "--radius-pill",
] as const;

// Preserve the SDK's existing names as aliases of the actual Spectra tokens.
export const SPECTRA_EMBED_TOKEN_ALIASES = {
  ink: ["--text-primary", "CanvasText"],
  muted: ["--text-secondary", "GrayText"],
  line: ["--border-default", "GrayText"],
  paper: ["--bg-primary", "Canvas"],
  mint: ["--accent-mint", "Highlight"],
  cyan: ["--accent-cyan", "Highlight"],
  violet: ["--brand-primary", "Highlight"],
  orange: ["--accent-orange", "Highlight"],
} as const;

export type SpectraSandboxTheme = {
  theme: "light" | "dark";
  reducedMotion: boolean;
  themeTokens: Partial<
    Record<(typeof SPECTRA_EMBED_THEME_TOKENS)[number], string>
  >;
};

export function sanitizeSpectraThemeTokens(
  value: unknown,
): SpectraSandboxTheme["themeTokens"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const values = value as Record<string, unknown>;
  return Object.fromEntries(
    SPECTRA_EMBED_THEME_TOKENS.flatMap((key) => {
      const token = values[key];
      return typeof token === "string" &&
        token.trim().length > 0 &&
        token.length <= 256 &&
        !/[<>;{}]|(?:url|expression)\s*\(/i.test(token)
        ? [[key, token.trim()]]
        : [];
    }),
  );
}

export function readSpectraSandboxTheme(
  forceReducedMotion = false,
): SpectraSandboxTheme {
  if (typeof window === "undefined")
    return {
      theme: "light",
      reducedMotion: forceReducedMotion,
      themeTokens: {},
    };
  const root = window.document.documentElement;
  const style = window.getComputedStyle(root);
  return {
    theme:
      root.classList.contains("dark") || root.dataset.theme === "dark"
        ? "dark"
        : "light",
    reducedMotion:
      forceReducedMotion ||
      ["none", "reduced"].includes(root.dataset.spectraMotion ?? "") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    themeTokens: sanitizeSpectraThemeTokens(
      Object.fromEntries(
        SPECTRA_EMBED_THEME_TOKENS.map((key) => [
          key,
          style.getPropertyValue(key),
        ]),
      ),
    ),
  };
}
