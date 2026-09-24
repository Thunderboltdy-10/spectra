async (page) => {
  if (page.__spectraP8Network) {
    page.__spectraP8Network.generation += 1;
    page.__spectraP8Network.responses.length = 0;
    page.__spectraP8Network.transfers.length = 0;
    page.__spectraP8Network.failures.length = 0;
    page.__spectraP8Network.pageErrors.length = 0;
  }
  return await page.evaluate(() => {
    if (!window.__spectraP8 || typeof window.__spectraP8.reset !== "function") {
      return { reset: false, reason: "Run install-observers.mjs first." };
    }
    window.__spectraP8.reset();
    return { reset: true, at: performance.now(), url: location.href };
  });
}
