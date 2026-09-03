async (page) => {
  const config = await page.evaluate(() => {
    const raw =
      sessionStorage.getItem("spectra.p8.sequenceDelays") ||
      "0,250,1000,5000,15000";
    return {
      label: sessionStorage.getItem("spectra.p8.sequenceLabel") || "sequence",
      delays: raw
        .split(",")
        .map((value) => Number(value.trim()))
        .filter(
          (value) => Number.isFinite(value) && value >= 0 && value <= 120000,
        ),
    };
  });
  const label = /^[a-z0-9][a-z0-9-]{0,60}$/i.test(config.label)
    ? config.label
    : "sequence";
  const delays = [...new Set(config.delays)].sort(
    (left, right) => left - right,
  );
  const frames = [];
  let elapsed = 0;
  for (let index = 0; index < delays.length; index += 1) {
    const wait = delays[index] - elapsed;
    if (wait > 0) await page.waitForTimeout(wait);
    elapsed = delays[index];
    const state = await page.evaluate(() => ({
      url: location.href,
      live: [
        ...document.querySelectorAll("[role=status],[role=alert],[aria-live]"),
      ]
        .map((element) => element.textContent?.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .slice(0, 40),
      busy: [...document.querySelectorAll("[aria-busy=true]")].map(
        (element) =>
          element.getAttribute("aria-label") ||
          element.textContent?.trim().replace(/\s+/g, " ").slice(0, 160) ||
          element.tagName,
      ),
      runningAnimations: document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
    }));
    const screenshot = `.shots/reformation/P8.V1/browser/${label}-${String(index).padStart(2, "0")}-${elapsed}ms.png`;
    await page.screenshot({ path: screenshot, fullPage: false });
    frames.push({ index, elapsedMs: elapsed, screenshot, ...state });
}
  return { label, frames };
}
