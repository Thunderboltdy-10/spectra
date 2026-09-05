async (page) => {
  const keepExcel = page.getByRole("button", { name: "Keep Excel version" });
  if (await keepExcel.isVisible().catch(() => false)) {
    await keepExcel.click();
    await page.waitForTimeout(800);
  }
  const formula = page.getByRole("textbox", { name: /Formula for/ });
  await formula.click({ timeout: 8000 });
  await page.keyboard.press("End");
  const samples = await page.evaluate(async () => {
    const times = [];
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      document.execCommand("insertText", false, i % 2 === 0 ? "x" : "y");
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      times.push(performance.now() - start);
    }
    const sorted = times.slice().sort((a, b) => a - b);
    return {
      times,
      maxMs: Math.max(...times),
      medianMs: sorted[Math.floor(sorted.length / 2)],
      formula: document.querySelector('[aria-label^="Formula for"]')?.value || null,
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f1-sheets-commit.png",
    fullPage: false,
  });
  return samples;
}
