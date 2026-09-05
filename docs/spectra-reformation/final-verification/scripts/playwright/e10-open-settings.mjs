async (page) => {
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-settings.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    heading: await page
      .getByRole("heading")
      .first()
      .innerText()
      .catch(() => null),
  };
}
