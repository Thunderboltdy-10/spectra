import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";

const executablePath = [process.env.SPECTRA_LAYOUT_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));

it.skipIf(!executablePath)("types and navigates collaborative paragraphs with the production containment styles", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "ts",
      contents: `import {Editor} from '@tiptap/core';
        import StarterKit from '@tiptap/starter-kit';
        import Collaboration from '@tiptap/extension-collaboration';
        import * as Y from 'yjs';
        import {StableBlockId} from './src/features/spectra/editor/stable-block-id';
        import {ParagraphFrame} from './src/features/spectra/editor/document-structure';
        const editor = new Editor({element:document.getElementById('editor'),extensions:[StarterKit.configure({undoRedo:false}),Collaboration.configure({document:new Y.Doc()}),StableBlockId,ParagraphFrame]});
        window.auditExport = () => editor.getHTML();`,
    },
    bundle: true, write: false, platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="spectra-document-studio" data-layout="continuous"><div id="editor"></div></div>');
    await page.addStyleTag({ content: readFileSync("src/styles/spectra-document-desk.css", "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.locator(".ProseMirror").click();
    await page.keyboard.type("First typing line.", { delay: 25 });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+b");
    await page.keyboard.type("Second bold line.", { delay: 25 });
    await page.keyboard.press("Control+b");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Third plain line.", { delay: 25 });
    expect(await page.locator(".ProseMirror > p").allTextContents()).toEqual(["First typing line.", "Second bold line.", "Third plain line."]);
    expect(await page.locator(".ProseMirror strong").allTextContents()).toEqual(["Second bold line."]);
    expect(await page.locator(".ProseMirror > p").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).contentVisibility))).toEqual(["auto", "auto", "visible"]);
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Fourth line.", { delay: 25 });
    expect(await page.locator(".ProseMirror > p").allTextContents()).toEqual(["First typing line.", "Second bold line.", "Third plain line.", "Fourth line."]);
    await page.keyboard.press("Control+Shift+Home");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("First typing line.");
    expect(await page.evaluate("window.auditExport()")).not.toContain("data-editor-selection");
  } finally {
    await browser.close();
  }
});
