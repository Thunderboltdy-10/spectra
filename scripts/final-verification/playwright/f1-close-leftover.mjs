async (page) => {
  const closeWork = page.getByRole("button", { name: "Close", exact: true });
  if (await closeWork.isVisible().catch(() => false)) {
    await closeWork.click();
    const discard = page.getByRole("button", { name: "Discard" });
    if (await discard.isVisible().catch(() => false)) await discard.click();
    await page.waitForTimeout(400);
  }
  const closeHome = page.getByRole("button", { name: "Close Home" });
  if (await closeHome.isVisible().catch(() => false)) {
    await closeHome.click();
    await page.waitForTimeout(200);
  }
  return {
    url: page.url(),
    text: await page.evaluate(() => document.body.innerText.slice(0, 400)),
  };
}
