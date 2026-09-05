async (page) => {
  const close = page.getByRole("button", { name: /Save or discard before closing|Close work/ });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    const discard = page.getByRole("button", { name: "Discard" });
    if (await discard.isVisible().catch(() => false)) await discard.click();
    await page.waitForTimeout(500);
  }
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("");
  await search.fill("P8V1-F2-200k-cell.xlsx");
  await page.waitForTimeout(800);
  await page.keyboard.press("ArrowDown");
  const started = Date.now();
  await page.keyboard.press("Enter");
  const grid = page.locator('[role="gridcell"]').first();
  const appeared = await grid
    .waitFor({ state: "visible", timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  const wallMs = Date.now() - started;
  const report = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      url: location.href,
      heading: document.querySelector("h1")?.textContent || "",
      hasGrid: Boolean(document.querySelector('[role="gridcell"]')),
      gridCount: document.querySelectorAll('[role="gridcell"]').length,
      caption:
        text.match(/You can modify|Read-only|Can modify|Refreshing|Sign in|conflict/)?.[0] ||
        null,
      frozenHint: text.includes("Updating") || text.includes("Reconnecting"),
      snippet: text.slice(
        Math.max(0, text.indexOf("P8V1-F2-200k")),
        Math.max(0, text.indexOf("P8V1-F2-200k")) + 500,
      ),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-200k-open.png",
    fullPage: false,
  });
  return { ...report, appeared, wallMs };
}
