async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("");
  await search.fill("P8V1-E7-revoke");
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-search-revoke-file.png",
    fullPage: false,
  });
  return page.evaluate(() => {
    const text = document.body.innerText;
    return {
      url: location.href,
      found: /P8V1-E7-revoke/i.test(text),
      snippet: text.slice(
        Math.max(0, text.search(/Results for|P8V1-E7|No results/i)),
        Math.max(0, text.search(/Results for|P8V1-E7|No results/i)) + 500,
      ),
    };
  });
}
