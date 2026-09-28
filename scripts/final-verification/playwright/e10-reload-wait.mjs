async (page) => {
  await page.waitForTimeout(8000);
  const text = await page
    .locator(".ProseMirror")
    .first()
    .innerText()
    .catch(() => "");
  const banners = await page.locator("body").innerText();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-reload-waited.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    len: text.length,
    hasA: text.includes("P8V1-A-CARD9-MARKER"),
    hasGw: text.includes("P8V1-E10-GW"),
    hasBr: text.includes("P8V1-E10-BR"),
    hasAi: text.includes("P8V1-E10-AI-MARKER"),
    saving: /Saving/i.test(banners),
    refreshing: /refreshing this work's access/i.test(banners),
    head: text.slice(0, 500),
  };
}
