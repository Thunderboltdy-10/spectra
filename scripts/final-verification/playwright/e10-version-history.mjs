async (page) => {
  const more = page.getByRole("button", { name: "More work actions" });
  const expanded = await more.getAttribute("aria-expanded");
  if (expanded !== "true") await more.click();
  await page.getByRole("menuitem", { name: "Version history" }).click({
    timeout: 8000,
  });
  await page.waitForTimeout(1200);
  const body = await page.locator("body").innerText();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-version-history.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    hasMarker: body.includes("P8V1-A-CARD9-MARKER"),
    hasHistory: /version|history|restore/i.test(body),
    head: body.slice(0, 900),
  };
}
