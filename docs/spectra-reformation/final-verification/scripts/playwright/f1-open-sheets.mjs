async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("P8V1-E8-lock.xlsx");
  await page.waitForTimeout(700);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3500);
  const commit = await page.evaluate(async () => {
    const cell = document.querySelector('[role="gridcell"], .spectra-sheet-cell, [data-address]');
    const start = performance.now();
    if (cell instanceof HTMLElement) {
      cell.click();
      document.execCommand("insertText", false, "F1");
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      url: location.href,
      ms: performance.now() - start,
      text: document.body.innerText.slice(0, 800),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f1-sheets-open.png",
    fullPage: false,
  });
  return commit;
}
