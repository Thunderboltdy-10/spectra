/*
 * show_widget visuals: the limits the tool enforces, the Spectra theme the
 * widget is drawn with, and the sandboxed document the thread renders.
 *
 * The widget runs in an iframe with sandbox="allow-scripts" only, so it has an
 * opaque origin: no access to the app, its cookies, storage or Convex. The
 * document carries a strict CSP (no network at all), and the only messages it
 * sends out are its height; the only one it accepts is the theme.
 */

export const WIDGET_LIMITS = Object.freeze({
  /** The whole snippet, markup, styles and scripts together. */
  maxHtmlChars: 60_000,
  maxScripts: 6,
  maxScriptChars: 40_000,
  maxTitleChars: 120,
  minHeight: 80,
  maxHeight: 720,
  defaultHeight: 320,
});

export const WIDGET_SANDBOX = "allow-scripts";

export const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export type WidgetTheme = "light" | "dark";

export const WIDGET_MESSAGE = { size: "spectra-widget:size", theme: "spectra-widget:theme" } as const;

const HUES = { red: "#ff647f", orange: "#ffab4a", yellow: "#f6d75d", green: "#48c997", blue: "#4f9fe6", violet: "#9176e8" } as const;

/** Paper and ink per mode, from docs/design/LANGUAGE.md. */
export const WIDGET_TOKENS: Record<WidgetTheme, Record<string, string>> = {
  light: {
    "paper-0": "#FBFAF7",
    "paper-1": "#F6F4EF",
    "paper-2": "#EFECE5",
    "paper-3": "#E6E2D9",
    "ink-1": "#141318",
    "ink-2": "#4A4852",
    "ink-3": "#7A7782",
    hairline: "rgb(20 19 24 / 0.08)",
  },
  dark: {
    "paper-0": "#121116",
    "paper-1": "#18171D",
    "paper-2": "#201F26",
    "paper-3": "#2A2931",
    "ink-1": "#F3F1EC",
    "ink-2": "#C4C1C9",
    "ink-3": "#8E8B95",
    hairline: "rgb(243 241 236 / 0.10)",
  },
};

const declarations = (tokens: Record<string, string>) =>
  Object.entries(tokens)
    .map(([name, value]) => `--${name}:${value}`)
    .join(";");

/**
 * The theme stylesheet: paper, ink, the six hues with a soft tint and a
 * text-safe ink each (mixed toward ink-1, so they hold contrast in both
 * modes), and the three type families. `data-theme` on the root picks the mode
 * in the thread; `data-spectra-theme` does in the code runtime a saved widget runs in.
 */
export function widgetThemeCss() {
  const hues = Object.entries(HUES)
    .map(
      ([name, value]) =>
        `--${name}:${value};--${name}-tint:color-mix(in oklab,var(--${name}) 18%,var(--paper-0));--${name}-ink:color-mix(in oklab,var(--${name}) 45%,var(--ink-1))`,
    )
    .join(";");
  return [
    `:root{color-scheme:light;${declarations(WIDGET_TOKENS.light)};${hues};--font-ui:Figtree,ui-sans-serif,system-ui,sans-serif;--font-reading:Newsreader,Georgia,"Times New Roman",serif;--font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace}`,
    `:root[data-theme="dark"],:root[data-spectra-theme="dark"]{color-scheme:dark;${declarations(WIDGET_TOKENS.dark)}}`,
    "*,*::before,*::after{box-sizing:border-box}",
    "html,body{margin:0;background:var(--paper-0);color:var(--ink-1);font:14px/1.5 var(--font-ui)}",
    "body{padding:16px}",
    "button,input,select,textarea{font:inherit;color:inherit}",
    "@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}",
  ].join("\n");
}

export class WidgetLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WidgetLimitError";
  }
}

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const FORBIDDEN = [
  { pattern: /<script\b[^>]*\bsrc\s*=/i, reason: "Scripts must be inline: the widget has no network access." },
  { pattern: /<link\b/i, reason: "Inline styles instead of <link>: the widget has no network access." },
  { pattern: /<(iframe|frame|object|embed)\b/i, reason: "Widgets cannot embed frames, objects or plugins." },
  { pattern: /<base\b/i, reason: "Widgets cannot set a <base>." },
  { pattern: /<meta\b[^>]*http-equiv/i, reason: "Widgets cannot set http-equiv meta tags." },
  { pattern: /\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//i, reason: "Inline images and assets (SVG or data: URLs): the widget has no network access." },
];

/** Throws WidgetLimitError with a reason the model can act on. */
export function checkWidgetHtml(html: string) {
  if (!html.trim()) throw new WidgetLimitError("html is empty.");
  if (html.length > WIDGET_LIMITS.maxHtmlChars)
    throw new WidgetLimitError(
      `The widget is ${html.length.toLocaleString("en")} characters; the limit is ${WIDGET_LIMITS.maxHtmlChars.toLocaleString("en")}. Simplify it, or make a code artifact for anything larger.`,
    );
  for (const rule of FORBIDDEN) if (rule.pattern.test(html)) throw new WidgetLimitError(rule.reason);
  const scripts = [...html.matchAll(SCRIPT_BLOCK)];
  if (scripts.length > WIDGET_LIMITS.maxScripts)
    throw new WidgetLimitError(`Use at most ${WIDGET_LIMITS.maxScripts} <script> blocks; this has ${scripts.length}.`);
  const scriptChars = scripts.reduce((total, match) => total + (match[2]?.length ?? 0), 0);
  if (scriptChars > WIDGET_LIMITS.maxScriptChars)
    throw new WidgetLimitError(
      `Scripts total ${scriptChars.toLocaleString("en")} characters; the limit is ${WIDGET_LIMITS.maxScriptChars.toLocaleString("en")}.`,
    );
}

/** A fragment, even when the model wrote a whole document: our head owns the CSP and theme. */
export function widgetFragment(html: string) {
  return html
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "")
    .trim();
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Reports the content height and follows the app's theme; nothing else crosses the frame. */
const BRIDGE = `(function(){var root=document.documentElement;var last=0;function report(){var h=Math.ceil(Math.max(root.scrollHeight,document.body?document.body.scrollHeight:0));if(h!==last){last=h;parent.postMessage({type:"${WIDGET_MESSAGE.size}",height:h},"*");}}window.addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(d&&d.type==="${WIDGET_MESSAGE.theme}"&&(d.theme==="light"||d.theme==="dark"))root.setAttribute("data-theme",d.theme);});if(typeof ResizeObserver==="function")new ResizeObserver(report).observe(root);window.addEventListener("load",report);report();})();`;

/** The sandboxed document for the thread's iframe. */
export function buildWidgetDocument(input: { title: string; html: string; theme: WidgetTheme }) {
  return [
    "<!doctype html>",
    `<html lang="en" data-theme="${input.theme}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeAttribute(input.title)}</title>`,
    `<style>${widgetThemeCss()}</style>`,
    "</head>",
    "<body>",
    widgetFragment(input.html),
    `<script>${BRIDGE}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

/** The height the frame takes for a reported content height. */
export function clampWidgetHeight(height: unknown) {
  const value = typeof height === "number" && Number.isFinite(height) ? height : WIDGET_LIMITS.defaultHeight;
  return Math.min(WIDGET_LIMITS.maxHeight, Math.max(WIDGET_LIMITS.minHeight, Math.ceil(value)));
}
