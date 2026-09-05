async (page) => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page
    .locator(".ProseMirror")
    .first()
    .innerText()
    .catch(() => "");
  const body = await page.locator("body").innerText();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-hard-reload.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    hasA: text.includes("P8V1-A-CARD9-MARKER"),
    hasB: text.includes("P8V1-B-LIVE-MARKER"),
    hasGw: text.includes("P8V1-E10-GW"),
    hasBr: text.includes("P8V1-E10-BR"),
    hasAi: text.includes("P8V1-E10-AI-MARKER"),
    saving: /Saving/i.test(body),
    signIn: /Sign in to continue/i.test(body),
    reconnect: /Reconnecting|Connection interrupted/i.test(body),
    head: text.slice(0, 400),
  };
}
