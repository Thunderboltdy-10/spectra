async (page) => {
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-studio-before-type.png",
    fullPage: false,
  });
  const before = await page.evaluate(() => {
    const editor = document.querySelector(".ProseMirror");
    const status =
      document.querySelector("[role=status]")?.textContent?.trim() || null;
    const text = document.body.innerText;
    return {
      hasEditor: Boolean(editor),
      contentEditable: editor?.getAttribute("contenteditable") || null,
      editorText: editor instanceof HTMLElement ? editor.innerText.slice(0, 400) : null,
      status,
      readDontChange: /read these files but will never change/i.test(text),
      queued: /queued|Saving|Keep on this PC/i.test(text),
    };
  });
  const editor = page.locator(".ProseMirror").first();
  if (await editor.count()) {
    await editor.click({ timeout: 3000 }).catch(() => null);
    await page.keyboard.type("P8V1-E7-PENDING-WRITE");
    await page.waitForTimeout(1500);
  }
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-studio-after-type.png",
    fullPage: false,
  });
  const after = await page.evaluate(() => {
    const editor = document.querySelector(".ProseMirror");
    const text = document.body.innerText;
    return {
      hasMarker: /P8V1-E7-PENDING-WRITE/.test(
        editor instanceof HTMLElement ? editor.innerText : text,
      ),
      status:
        document.querySelector("[role=status]")?.textContent?.trim() || null,
      persistence: (
        text.match(/Saving|Saved|Queued|Connect this device|will never change|failed/i) ||
        []
      ).slice(0, 8),
      editorText:
        editor instanceof HTMLElement ? editor.innerText.slice(0, 500) : null,
    };
  });
  return { before, after, url: page.url() };
}
