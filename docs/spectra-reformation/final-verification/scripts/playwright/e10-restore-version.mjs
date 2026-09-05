async (page) => {
  const restore = page.getByRole("button", { name: /Restore as new version/i });
  if ((await restore.count()) === 0) {
    await page.screenshot({
      path: ".shots/reformation/P8.V1/browser/e10-a-restore-missing.png",
      fullPage: false,
    });
    return { restored: false, reason: "no restore button", url: page.url() };
  }
  await restore.first().click({ force: true });
  await page.waitForTimeout(15000);
  const text = await page
    .locator(".ProseMirror")
    .first()
    .innerText()
    .catch(() => "");
  const body = await page.locator("body").innerText();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-restored.png",
    fullPage: false,
  });
  return {
    restored: true,
    hasA: text.includes("P8V1-A-CARD9-MARKER") || body.includes("P8V1-A-CARD9-MARKER"),
    hasAi: text.includes("P8V1-E10-AI-MARKER") || body.includes("P8V1-E10-AI-MARKER"),
    head: text.slice(0, 400),
    url: page.url(),
  };
}
