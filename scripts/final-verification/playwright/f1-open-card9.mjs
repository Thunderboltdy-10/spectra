async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("");
  await search.fill("P5V1-CARD9-TWO-HUMANS");
  await page.waitForTimeout(800);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.locator(".ProseMirror, [contenteditable='true']").first().waitFor({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f1-card9-open.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    hasEditor: await page.locator(".ProseMirror").first().isVisible().catch(() => false),
    snippet: await page.evaluate(() => document.body.innerText.slice(0, 700)),
  };
}
