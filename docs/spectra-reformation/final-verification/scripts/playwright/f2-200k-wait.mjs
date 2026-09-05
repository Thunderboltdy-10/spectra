async (page) => {
  const started = Date.now();
  await page.waitForTimeout(8000);
  const report = await page.evaluate(() => {
    const text = document.body.innerText;
    const formula = document.querySelector('[aria-label^="Formula for"]');
    const empty = text.includes("Empty sheet");
    return {
      url: location.href,
      empty,
      saving: text.includes("Saving"),
      caption: text.match(/You can modify|Read-only|Can modify|Refreshing|Waiting|conflict/)?.[0] || null,
      formula: formula && "value" in formula ? String(formula.value) : formula?.textContent || null,
      gridCount: document.querySelectorAll('[role="gridcell"]').length,
      a1: document.querySelector('[role="gridcell"]')?.textContent?.slice(0, 80) || null,
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-200k-wait.png",
    fullPage: false,
  });
  return { ...report, waitedMs: Date.now() - started };
}
