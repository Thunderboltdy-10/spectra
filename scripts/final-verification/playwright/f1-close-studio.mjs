async (page) => {
  const studioClose = page
    .locator('complementary[aria-label="Work studio"]')
    .getByRole("button", { name: "Close", exact: true });
  if (await studioClose.isVisible().catch(() => false)) {
    await studioClose.click();
    const discard = page.getByRole("button", { name: "Discard" });
    const appeared = await discard
      .waitFor({ state: "visible", timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await page.waitForTimeout(600);
      if (await discard.isEnabled().catch(() => false)) {
        await discard.click({ force: true });
      } else {
        const save = page.getByRole("button", { name: /^Save$/, exact: true });
        if (await save.isEnabled().catch(() => false)) await save.click();
      }
    }
    await page.waitForTimeout(400);
  }
  return { url: page.url() };
}
