async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("");
  await search.fill("P8V1-F2-40-page.docx");
  await page.waitForTimeout(800);
  await page.keyboard.press("ArrowDown");
  const started = Date.now();
  await page.keyboard.press("Enter");
  const editor = page.locator(".ProseMirror").first();
  const appeared = await editor
    .waitFor({ state: "visible", timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(2500);
  const report = await page.evaluate(() => {
    const text = document.body.innerText;
    const editorNode = document.querySelector(".ProseMirror");
    return {
      url: location.href,
      heading: document.querySelector("h1")?.textContent || "",
      hasEditor: Boolean(editorNode),
      textLength: editorNode instanceof HTMLElement ? editorNode.innerText.length : 0,
      caption: text.match(/You can modify|Read-only|Can modify|Refreshing|Sign in/)?.[0] || null,
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-40page-open.png",
    fullPage: false,
  });
  return { ...report, appeared, wallMs: Date.now() - started };
}
