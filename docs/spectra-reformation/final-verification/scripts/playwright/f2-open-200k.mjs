async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("P8V1-F2-200k-cell.xlsx");
  await page.waitForTimeout(800);
  await page.keyboard.press("ArrowDown");
  const started = Date.now();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(8000);
  const report = await page.evaluate(() => {
    const text = document.body.innerText;
    const grid = document.querySelector('[role="grid"], [data-address], .spectra-sheet');
    return {
      url: location.href,
      hasGrid: Boolean(grid),
      refreshing: text.includes("Refreshing access"),
      caption: text.match(/You can modify|Read-only|Can modify|Refreshing|Sign in/)?.[0] || null,
      studio: text.includes("SHEET") || text.includes("Sheets") || text.includes("P8V1-F2-200k"),
      snippet: text.slice(Math.max(0, text.indexOf("P8V1-F2-200k")), Math.max(0, text.indexOf("P8V1-F2-200k")) + 700),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-200k-open.png",
    fullPage: false,
  });
  return { ...report, wallMs: Date.now() - started };
}
