async (page) => {
  const live = page.getByRole("button", {
    name: /Update P5V1-CARD9-TWO-HUMANS/i,
  });
  if ((await live.count()) > 0) {
    await live.first().click({ timeout: 5000 }).catch(() => {});
  }
  const follow = page.getByRole("button", {
    name: /Follow the AI as it works|Stop following the AI/i,
  });
  const beforeCount = await follow.count();
  if (beforeCount > 0) {
    const btn = follow.first();
    const before = {
      label: await btn.getAttribute("aria-label"),
      pressed: await btn.getAttribute("aria-pressed"),
    };
    if (before.pressed !== "true") await btn.click();
    await page.waitForTimeout(400);
    const after = {
      label: await btn.getAttribute("aria-label"),
      pressed: await btn.getAttribute("aria-pressed"),
    };
    await page.screenshot({
      path: ".shots/reformation/P8.V1/browser/e10-a-follow.png",
      fullPage: false,
    });
    return { openedLive: true, beforeCount, before, after, url: page.url() };
  }
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-follow-missing.png",
    fullPage: false,
  });
  return { openedLive: true, beforeCount, followVisible: false, url: page.url() };
}
