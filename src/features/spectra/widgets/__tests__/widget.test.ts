import { describe, expect, it } from "vitest";
import { showWidgetTool } from "../../ai/harness/tools/interaction";
import { normalizeCodeContent } from "../../code/model";
import { chooseWidgetArtifactType, widgetArtifactArgs, widgetSourceDocument } from "../widget-artifact";
import {
  WIDGET_CSP,
  WIDGET_LIMITS,
  WIDGET_SANDBOX,
  WIDGET_TOKENS,
  buildWidgetDocument,
  checkWidgetHtml,
  clampWidgetHeight,
  widgetFragment,
  widgetThemeCss,
} from "../widget-document";

const context = { signal: new AbortController().signal, runId: "r", toolCallId: "t" };
const slider = `<style>.v{color:var(--blue-ink)}</style><input type="range" id="a"><output class="v" id="o"></output><script>a.oninput=()=>o.textContent=a.value</script>`;

describe("the widget sandbox", () => {
  it("allows scripts and nothing else: no same-origin, forms, popups or navigation", () => {
    expect(WIDGET_SANDBOX).toBe("allow-scripts");
    expect(WIDGET_SANDBOX).not.toMatch(/same-origin|forms|popups|top-navigation|modals/);
  });

  it("carries a CSP with no network, no frames and no base or form targets", () => {
    const html = buildWidgetDocument({ title: "Angle", html: slider, theme: "light" });
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">`);
    for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'"])
      expect(WIDGET_CSP).toContain(directive);
    expect(WIDGET_CSP).not.toMatch(/https?:|\*/);
    // The CSP comes before anything the model wrote.
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf('type="range"'));
  });

  it("keeps the head its own when the model sends a whole document", () => {
    const fragment = widgetFragment(
      `<!doctype html><html><head><meta charset="utf-8"><title>x</title><style>p{}</style></head><body class="b"><p>Hi</p></body></html>`,
    );
    expect(fragment).toBe("<style>p{}</style><p>Hi</p>");
  });

  it("escapes the title", () => {
    expect(buildWidgetDocument({ title: "<script>x</script>", html: "<p>a</p>", theme: "light" })).toContain(
      "<title>&lt;script&gt;x&lt;/script&gt;</title>",
    );
  });
});

describe("widget theming", () => {
  it("defines paper, ink, hues with tint and ink, and the type families", () => {
    const css = widgetThemeCss();
    for (const name of ["paper-0", "paper-3", "ink-1", "ink-3", "hairline", "font-ui", "font-reading", "font-mono"]) expect(css).toContain(`--${name}:`);
    for (const hue of ["red", "orange", "yellow", "green", "blue", "violet"])
      for (const suffix of ["", "-tint", "-ink"]) expect(css).toContain(`--${hue}${suffix}:`);
  });

  it("switches paper and ink for dark mode, in the thread and in the code runtime", () => {
    const css = widgetThemeCss();
    expect(css).toContain(`--paper-0:${WIDGET_TOKENS.light["paper-0"]}`);
    expect(css).toMatch(/:root\[data-theme="dark"\],:root\[data-spectra-theme="dark"\]\{color-scheme:dark;[^}]*--paper-0:#121116[^}]*--ink-1:#F3F1EC/);
  });

  it("starts the document in the app's mode and listens for later changes", () => {
    expect(buildWidgetDocument({ title: "a", html: "<p>a</p>", theme: "dark" })).toContain('<html lang="en" data-theme="dark">');
    expect(buildWidgetDocument({ title: "a", html: "<p>a</p>", theme: "light" })).toContain('<html lang="en" data-theme="light">');
    expect(buildWidgetDocument({ title: "a", html: "<p>a</p>", theme: "light" })).toContain("spectra-widget:theme");
  });
});

describe("widget limits", () => {
  it("accepts a normal widget", () => {
    expect(() => checkWidgetHtml(slider)).not.toThrow();
  });

  it.each([
    ["too long", "x".repeat(WIDGET_LIMITS.maxHtmlChars + 1), /limit is 60,000/],
    ["too many scripts", "<script>1</script>".repeat(WIDGET_LIMITS.maxScripts + 1), /at most 6 <script>/],
    ["too much script", `<script>${"a".repeat(WIDGET_LIMITS.maxScriptChars + 1)}</script>`, /Scripts total/],
    ["an external script", `<script src="https://cdn.example/x.js"></script>`, /inline/],
    ["a stylesheet link", `<link rel="stylesheet" href="https://fonts.example/a.css">`, /<link>/],
    ["a frame", `<iframe srcdoc="x"></iframe>`, /frames/],
    ["a remote image", `<img src="https://example.com/a.png">`, /no network/],
    ["a protocol-relative image", `<img src="//example.com/a.png">`, /no network/],
    ["a CSP override", `<meta http-equiv="Content-Security-Policy" content="default-src *">`, /http-equiv/],
    ["nothing", "   ", /empty/],
  ])("rejects %s", (_name, html, message) => {
    expect(() => checkWidgetHtml(html)).toThrow(message);
  });

  it("clamps the frame height", () => {
    expect(clampWidgetHeight(10)).toBe(WIDGET_LIMITS.minHeight);
    expect(clampWidgetHeight(5_000)).toBe(WIDGET_LIMITS.maxHeight);
    expect(clampWidgetHeight("tall")).toBe(WIDGET_LIMITS.defaultHeight);
    expect(clampWidgetHeight(401.2)).toBe(402);
  });

  it("turns a limit into an error the model can fix", () => {
    const tool = showWidgetTool();
    expect(() => tool.parse!({ title: "Big", html: "x".repeat(WIDGET_LIMITS.maxHtmlChars + 1) })).toThrow(/code artifact/);
    expect(() => tool.parse!({ title: "Net", html: `<script src="https://x.test/a.js"></script>` })).toThrow(/inline/);
  });

  it("shows a valid widget and tells the model the user can save it", async () => {
    const tool = showWidgetTool();
    const outcome = await tool.execute(tool.parse!({ title: "Angle", html: slider }), context);
    expect(outcome.widget).toEqual({ title: "Angle", html: slider });
    expect(outcome.content).toMatch(/save it as work/);
    expect(tool.effect).toBe("read");
  });
});

describe("saving a widget as work", () => {
  it("chooses code with the browser runtime and records why", () => {
    expect(chooseWidgetArtifactType(slider)).toMatchObject({ type: "code", runtime: "browser", reason: expect.stringMatching(/interactive/) });
    expect(chooseWidgetArtifactType("<svg><circle r='4'/></svg>").reason).toMatch(/HTML and SVG exactly as drawn/);
  });

  it("builds a runnable code artifact that opens on its preview, themed like the thread", () => {
    const args = widgetArtifactArgs({ title: "Projectile range", html: slider });
    expect(args).toMatchObject({ blueprintKey: "code", title: "Projectile range", source: "chat" });
    expect(args.contextSummary).toMatch(/Saved from a Spectra widget as code/);
    const content = normalizeCodeContent(args.content);
    expect(content.runtime).toBe("browser");
    expect(content.visualisation).toMatchObject({ enabled: true, openMode: "preview" });
    const entry = content.files.find((file) => file.id === content.entryFileId)!;
    expect(entry.path).toBe("index.html");
    expect(entry.source).toContain("--blue-ink:");
    expect(entry.source).toContain('type="range"');
    // The code runtime brings its own sandbox and CSP; the saved page carries no bridge script.
    expect(entry.source).not.toContain("spectra-widget:size");
  });

  it("strips markup from the saved page title", () => {
    expect(widgetSourceDocument("<b>Hi</b>", "<p>x</p>")).toContain("<title>bHi/b</title>");
  });
});
