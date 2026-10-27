import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";

const executablePath = [process.env.SPECTRA_LAYOUT_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));

it.skipIf(!executablePath)("keeps editor validation, publication and progress notices visible with production styles", async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="spectra-quiz-studio"><div class="spectra-editor-body">
        <p role="status">Published <button>Unpublish</button></p>
        <div role="status">Resolve these before publishing</div>
      </div></div>
      <div class="code-studio"><div class="spectra-editor-body">
        <div role="status">Preparing export</div>
      </div></div>`);
    await page.addStyleTag({ content: readFileSync("src/styles/spectra-app.css", "utf8") });
    expect(await page.getByRole("button", { name: "Unpublish" }).isVisible()).toBe(true);
    expect(await page.getByText("Resolve these before publishing").isVisible()).toBe(true);
    expect(await page.getByText("Preparing export").isVisible()).toBe(true);
  } finally {
    await browser.close();
  }
});
