async (page) => {
  const samples = await page.evaluate(() => {
    const target = document.querySelector(".ProseMirror");
    if (!(target instanceof HTMLElement)) return { error: "no editor" };
    target.focus();
    const times = [];
    for (let i = 0; i < 24; i += 1) {
      const start = performance.now();
      document.execCommand("insertText", false, i % 2 === 0 ? "x" : "y");
      times.push(performance.now() - start);
    }
    const sorted = times.slice().sort((a, b) => a - b);
    return {
      times,
      maxMs: Math.max(...times),
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
      longTasks: (window.__spectraP8?.longTasks ?? []).slice(-8),
      url: location.href,
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-40page-keystroke-sync.png",
    fullPage: false,
  });
  return samples;
}
