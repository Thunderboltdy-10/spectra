async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("");
  await search.fill("Econ Dec Mocks.pptx");
  await page.waitForTimeout(700);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f1-deck-open.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    text: await page.evaluate(() => document.body.innerText.slice(0, 900)),
  };
}
