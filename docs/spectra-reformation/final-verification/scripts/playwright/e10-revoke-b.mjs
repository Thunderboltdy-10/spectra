async (page) => {
  const more = page.getByRole("button", { name: "More work actions" });
  const expanded = await more.getAttribute("aria-expanded");
  if (expanded !== "true") await more.click();
  await page.getByRole("menuitem", { name: "Share work" }).click({ timeout: 8000 });
  await page.waitForTimeout(700);
  const remove = page.getByRole("button", { name: "Remove access" });
  const dialog = await page
    .getByRole("dialog")
    .innerText()
    .catch(async () =>
      page.locator('[aria-modal="true"]').first().innerText().catch(() => ""),
    );
  const removeCount = await remove.count();
  if (removeCount > 0) {
    await remove.first().click();
    await page.waitForTimeout(900);
  }
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-revoke-b.png",
    fullPage: false,
  });
  return { removeCount, dialog: String(dialog).slice(0, 700), url: page.url() };
}
