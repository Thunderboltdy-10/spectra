async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("P8V1-F2-120-slide.pptx");
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-b-search-120.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    hasDeck: text.includes("P8V1-F2-120-slide"),
    snippet: text.slice(0, 700),
  };
}
