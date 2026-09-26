import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { buildSpectraSandboxDocument } from "../embed/sandbox-protocol";
import { sanitizeSpectraThemeTokens } from "../embed/theme-tokens";

const documents = [];
const initialTheme = {
  theme: "dark",
  reducedMotion: true,
  themeTokens: {
    "--text-primary": "#eeebe7",
    "--bg-primary": "#121211",
    "--brand-primary": "#9a87ff",
  },
};

function runtime(authoredStyle = "") {
  const result = buildSpectraSandboxDocument({
    channel: "theme-test",
    title: "Theme test",
    initialTheme,
    files: [
      {
        path: "index.html",
        source: `${authoredStyle}<main><button>Explore</button></main><script>window.initialInk = SpectraEmbed.tokens.ink; window.cachedTokens = SpectraEmbed.tokens; window.interactionCount = 7;</script>`,
      },
    ],
  });
  const dom = new JSDOM(result.srcDoc, { runScripts: "outside-only" });
  documents.push(dom);
  const win = dom.window;
  win.fetch = async () => new Response();
  win.requestAnimationFrame = () => 0;
  win.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  for (const script of Array.from(win.document.scripts))
    win.eval(script.textContent);
  function message(change, correctSource = true) {
    win.dispatchEvent(
      new win.MessageEvent("message", {
        source: correctSource ? win : null,
        data: {
          type: "spectra:host",
          channel: "theme-test",
          theme: "light",
          reducedMotion: false,
          ...change,
        },
      }),
    );
  }
  return { win, message };
}

afterEach(async () => {
  // Let the sandbox's queued observer callbacks finish before JSDOM destroys
  // its document; closing first would turn valid callbacks into teardown errors.
  await Promise.resolve();
  for (const dom of documents.splice(0)) dom.window.close();
});

describe("executed sandbox theme protocol", () => {
  it("makes captured Spectra tokens available before standalone artifact code runs", () => {
    const { win } = runtime();
    expect(win.initialInk).toBe("#eeebe7");
    expect(win.cachedTokens.violet).toBe("#9a87ff");
    expect(win.getComputedStyle(win.document.documentElement).colorScheme).toBe(
      "dark",
    );
    expect(win.document.documentElement.dataset.spectraReducedMotion).toBe(
      "true",
    );
    expect(Object.isFrozen(win.cachedTokens)).toBe(true);
  });

  it("updates cached SDK aliases and CSS defaults without replacing interaction state", () => {
    const { win, message } = runtime();
    const main = win.document.querySelector("main");
    const sheet = win.document.querySelector("#spectra-theme-tokens").sheet;
    const rule = sheet.cssRules[0];
    message({
      themeTokens: { "--text-primary": "#211f1c", "--bg-primary": "#fbfaf8" },
    });
    expect(win.cachedTokens.ink).toBe("#211f1c");
    expect(win.cachedTokens.paper).toBe("#fbfaf8");
    expect(win.document.documentElement.dataset.spectraTheme).toBe("light");
    expect(win.interactionCount).toBe(7);
    expect(win.document.querySelector("main")).toBe(main);
    expect(win.document.querySelector("#spectra-theme-tokens").sheet).toBe(sheet);
    expect(sheet.cssRules[0]).toBe(rule);
    expect(
      win
        .getComputedStyle(win.document.documentElement)
        .getPropertyValue("--brand-primary"),
    ).toBe("");
  });

  it("preserves a visual's intentional theme above Spectra defaults", () => {
    const { win, message } = runtime(
      "<style>:root{--text-primary:#123456;color-scheme:light}</style>",
    );
    expect(win.initialInk).toBe("#123456");
    message({ theme: "dark", themeTokens: { "--text-primary": "#eeeeee" } });
    expect(win.cachedTokens.ink).toBe("#123456");
    expect(win.getComputedStyle(win.document.documentElement).colorScheme).toBe(
      "light",
    );
  });

  it("ignores forged origins/channels and unknown or injected token properties", () => {
    const { win, message } = runtime();
    message({ themeTokens: { "--text-primary": "#111111" } }, false);
    message({
      channel: "another-frame",
      themeTokens: { "--text-primary": "#222222" },
    });
    expect(win.cachedTokens.ink).toBe("#eeebe7");
    message({
      themeTokens: {
        "--text-primary": "red;}body{display:none",
        "--private-value": "secret",
        "--bg-primary": "url(https://evil.example)",
      },
    });
    const style = win.getComputedStyle(win.document.documentElement);
    expect(style.getPropertyValue("--private-value")).toBe("");
    expect(style.getPropertyValue("--text-primary")).toBe("");
    expect(style.getPropertyValue("--bg-primary")).toBe("");
    expect(
      win.document.querySelector("#spectra-theme-tokens").sheet.cssRules[0].cssText,
    ).not.toContain("display:none");
  });

  it("keeps a captured snapshot when a legacy host sends only the theme flag", () => {
    const { win, message } = runtime();
    message({ theme: "light" });
    expect(win.cachedTokens.ink).toBe("#eeebe7");
    expect(win.getComputedStyle(win.document.documentElement).colorScheme).toBe(
      "light",
    );
  });

  it("bounds the token contract before embedding initial data in exported HTML", () => {
    expect(
      sanitizeSpectraThemeTokens({
        "--bg-primary": " #121211 ",
        "--private-value": "private",
        "--font-sans": "x".repeat(257),
        "--brand-primary": "</style><script>alert(1)</script>",
      }),
    ).toEqual({ "--bg-primary": "#121211" });
  });
});
