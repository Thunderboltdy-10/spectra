async (page) => {
  await page.waitForTimeout(4000);
  const before = await page.evaluate(() => document.body.innerText);
  const cell = page.locator('[role="gridcell"], [data-address="A1"]').first();
  if (await cell.count()) await cell.click({ timeout: 4000 }).catch(() => undefined);
  await page.keyboard.type("F2");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      url: location.href,
      refreshing: text.includes("Refreshing access"),
      caption: text.match(/You can modify|Read-only|Can modify|Refreshing/)?.[0] || null,
      hasGrid: Boolean(document.querySelector('[role="grid"], [data-address]')),
      fx: document.body.innerText.includes("fx"),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-200k-commit.png",
    fullPage: false,
  });
  return { beforeRefreshing: before.includes("Refreshing access"), ...after };
}
