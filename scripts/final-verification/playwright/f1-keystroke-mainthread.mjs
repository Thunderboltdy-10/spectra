async (page) => {
  const formula = page.getByRole("textbox", { name: /Formula for/ });
  if (await formula.isVisible().catch(() => false)) {
    await formula.click();
  } else {
    const editor = page.locator(".ProseMirror, [contenteditable='true']").first();
    await editor.click({ timeout: 8000 });
  }
  return await page.evaluate(async () => {
    const times = [];
    for (let i = 0; i < 12; i += 1) {
      const start = performance.now();
      document.execCommand("insertText", false, i % 2 === 0 ? "x" : "y");
      times.push(performance.now() - start);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    }
    const sorted = times.slice().sort((a, b) => a - b);
    return {
      times,
      maxMs: Math.max(...times),
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    };
  });
}
