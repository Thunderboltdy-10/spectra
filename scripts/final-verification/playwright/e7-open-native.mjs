async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("");
  await search.fill("P8V1-D3-unique");
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-search-native.png",
    fullPage: false,
  });
  const listing = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      url: location.href,
      hasUnique: /P8V1-D3-unique/i.test(text),
      hasSmoke: /P8P1-smoke/i.test(text),
      snippet: text.slice(
        Math.max(0, text.search(/Results for|P8V1-D3|No results/i)),
        Math.max(0, text.search(/Results for|P8V1-D3|No results/i)) + 700,
      ),
    };
  });
  if (listing.hasUnique) {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);
  }
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-native-open.png",
    fullPage: false,
  });
  return {
    ...listing,
    afterUrl: page.url(),
    afterSnippet: await page.evaluate(() =>
      document.body.innerText.slice(0, 900),
    ),
  };
}
