async (page) => {
  await page.waitForTimeout(2500);
  const samples = await page.evaluate(async () => {
    const target = document.querySelector(".ProseMirror");
    if (!(target instanceof HTMLElement)) return { error: "no editor" };
    target.focus();
    const times = [];
    for (let i = 0; i < 16; i += 1) {
      const start = performance.now();
      document.execCommand("insertText", false, i % 2 === 0 ? "x" : "y");
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      times.push(performance.now() - start);
    }
    const sorted = times.slice().sort((a, b) => a - b);
    const text = document.body.innerText;
    return {
      times,
      maxMs: Math.max(...times),
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      saving: text.includes("Saving"),
      saved: /Saved|Up to date|Current/.test(text),
      url: location.href,
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-40page-keystroke.png",
    fullPage: false,
  });
  return samples;
}
