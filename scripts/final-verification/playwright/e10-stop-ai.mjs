async (page) => {
  const stop = page.getByRole("button", {
    name: /Stop Update P5V1-CARD9-TWO-HUMANS|Stop active response/i,
  });
  const clicked = [];
  const count = await stop.count();
  for (let i = 0; i < count; i += 1) {
    const btn = stop.nth(i);
    if (await btn.isVisible()) {
      const name = await btn.getAttribute("aria-label");
      await btn.click();
      clicked.push(name);
    }
  }
  await page.waitForTimeout(600);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-ai-stopped.png",
    fullPage: false,
  });
  return { clicked, remaining: await stop.count(), url: page.url() };
}
