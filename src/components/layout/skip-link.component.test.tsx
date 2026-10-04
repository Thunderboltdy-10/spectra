import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import { AppShell } from "./app-shell";

// The installed jsdom runtime has no type package; describe only this fixture API.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { window: { document: Document } };
};

const route = vi.hoisted(() => ({ pathname: "/settings", ready: true }));
vi.mock("next/font/google", () => ({ Manrope: () => ({ variable: "font-main" }), IBM_Plex_Mono: () => ({ variable: "font-mono" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams("section=appearance") }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode } & { prefetch?: boolean }) => { delete props.prefetch; return <a {...props}>{children}</a>; } }));
vi.mock("@clerk/nextjs", () => ({ ClerkProvider: ({ children }: { children: ReactNode }) => children, useClerk: () => ({ openUserProfile: vi.fn() }) }));
vi.mock("@/lib/clerk-config", () => ({ getClerkPublishableKey: () => undefined }));
vi.mock("@/lib/boot-diagnostics", () => ({ checkDeploymentConsistency: () => {} }));
vi.mock("@/components/providers", () => ({ Providers: ({ children }: { children: ReactNode }) => children }));
vi.mock("../account-storage-boundary", () => ({ useAccountStorageReady: () => route.ready }));
vi.mock("@/features/spectra/data/use-catalog-pages", () => ({ useWorkspaceCatalog: () => ({ items: [] }) }));
vi.mock("@/features/spectra/components/catalog-progress", () => ({ CatalogProgress: () => null }));
vi.mock("@/components/spectra-logo", () => ({ SpectraLogo: () => null }));
vi.mock("@/components/signed-in-continue", () => ({ SignedInContinue: () => null }));
vi.mock("@/components/keyboard-shortcuts", () => ({ KeyboardShortcutsRegistrar: () => null, KeyboardShortcutsHelp: () => null, ShortcutsButton: () => null }));
vi.mock("@/features/spectra/components/universal-kbar", () => ({ UniversalKBar: () => null }));
vi.mock("@/features/spectra/components/viewport-readiness-mount", () => ({ ViewportReadinessMount: () => null }));
vi.mock("@/features/spectra/components/route-side-panel-host", () => ({ RouteSidePanelHost: () => null }));
vi.mock("@/features/spectra/components/viewport-reference-picker", () => ({ ViewportReferencePicker: () => null }));
vi.mock("@/features/spectra/components/global-route-workbench", () => ({ GlobalRouteWorkbench: () => null }));
vi.mock("@/features/spectra/bridge/product-offline-banner", () => ({ ProductOfflineBanner: () => null }));
vi.mock("@/features/spectra/collaboration/app-choreography-host", () => ({ AppChoreographyMount: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({ OverflowMenu: () => null }));

function shellHtml() {
  return renderToStaticMarkup(<RootLayout><AppShell><button>Page content action</button></AppShell></RootLayout>);
}

it("gives the global skip link one target inside the content landmark, beyond navigation", () => {
  const doc = new JSDOM(shellHtml()).window.document;
  const target = doc.getElementById("main-content");
  expect(target?.tagName).toBe("MAIN");
  expect(target?.getAttribute("tabindex")).toBe("-1");
  expect(target?.querySelector("nav")).toBeNull();
  expect(doc.querySelectorAll("#main-content")).toHaveLength(1);
  expect(target?.textContent).toContain("Page content action");
});

// An isolated browser loads only server-rendered fixtures and the real skip-link
// enhancement. It never visits the running product or reads an account session.
const executablePath = [process.env.SPECTRA_LAYOUT_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));
const browserSuite = executablePath ? describe : describe.skip;
let browser: Browser;
let enhancement: string | undefined;
browserSuite("native skip-link keyboard order", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath, headless: true });
    if (existsSync(resolve("src/components/ui/skip-link.tsx"))) {
      const result = await build({ stdin: { contents: 'import React from "react"; import { hydrateRoot } from "react-dom/client"; import { SkipLink } from "./src/components/ui/skip-link"; hydrateRoot(document.getElementById("skip-fixture-host"), React.createElement(SkipLink));', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", define: { "process.env.NODE_ENV": '"production"' } });
      enhancement = result.outputFiles[0]!.text;
    }
  });
  afterAll(async () => { await browser?.close(); });

  async function pageWith(html: string, hydrate = true) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const doc = new JSDOM(html).window.document;
    const link = doc.querySelector(".skip-link")!;
    const host = doc.createElement("div"); host.id = "skip-fixture-host";
    link.replaceWith(host); host.append(link);
    // Root layout's unrelated storage bootstrap is unnecessary for this fixture.
    doc.querySelectorAll("script").forEach(script => script.remove());
    await page.setContent(doc.documentElement.outerHTML);
    if (hydrate && enhancement) {
      await page.addScriptTag({ content: enhancement });
      await page.waitForFunction(() => Object.keys(document.querySelector(".skip-link")!).some(key => key.startsWith("__reactProps")));
    }
    return page;
  }

  it("continues into the page after Enter on Skip to content and the next Tab", async () => {
    const page = await pageWith(shellHtml());
    try {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Skip to content");
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("MAIN");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Page content action");
    } finally { await page.close(); }
  });

  it("uses the shell landmark even before hydration", async () => {
    const page = await pageWith(shellHtml(), false);
    try {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Page content action");
    } finally { await page.close(); }
  });

  it("retains a usable fallback on pages without an AppShell", async () => {
    const page = await pageWith(renderToStaticMarkup(<RootLayout><main><button>Standalone content action</button></main></RootLayout>));
    try {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Standalone content action");
    } finally { await page.close(); }
  });
});
