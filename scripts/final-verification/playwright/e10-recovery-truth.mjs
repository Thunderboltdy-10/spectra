async (page) => {
  await page.waitForTimeout(2500);
  const text = await page
    .locator(".ProseMirror")
    .first()
    .innerText()
    .catch(() => "");
  const status = await page
    .locator('[role="status"], [data-spectra-sync], .spectra-workbar')
    .allInnerTexts()
    .catch(() => []);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-recovered.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    hasGw: text.includes("P8V1-E10-GW"),
    hasBr: text.includes("P8V1-E10-BR"),
    hasAi: text.includes("P8V1-E10-AI-MARKER"),
    hasA: text.includes("P8V1-A-CARD9-MARKER"),
    hasB: text.includes("P8V1-B-LIVE-MARKER"),
    head: text.slice(0, 400),
    status: status.slice(0, 8),
  };
}
