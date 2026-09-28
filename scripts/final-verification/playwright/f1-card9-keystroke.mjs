async (page) => {
  const editor = page.locator(".ProseMirror, [contenteditable='true']").first();
  await editor.click({ timeout: 8000 });
  const samples = await page.evaluate(async () => {
    const target = document.querySelector(".ProseMirror, [contenteditable='true']");
    if (!target) return { error: "no editor" };
    target.focus();
    const times = [];
    for (let i = 0; i < 12; i += 1) {
      const start = performance.now();
      document.execCommand("insertText", false, i % 2 === 0 ? "x" : "y");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      times.push(performance.now() - start);
    }
    const state = window.__spectraP8;
    return {
      times,
      maxMs: Math.max(...times),
      medianMs: times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)],
      cls: (state?.layoutShifts ?? []).reduce((sum, entry) => sum + entry.value, 0),
      longTasks: state?.longTasks ?? [],
      url: location.href,
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f1-card9-keystroke.png",
    fullPage: false,
  });
  return samples;
}
