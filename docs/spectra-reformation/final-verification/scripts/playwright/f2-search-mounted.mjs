async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("");
  await search.fill("P8V1-F2");
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-search-mounted.png",
    fullPage: false,
  });
  return page.evaluate(() => {
    const text = document.body.innerText;
    return {
      url: location.href,
      hasDocx: text.includes("P8V1-F2-40-page"),
      hasXlsx: text.includes("P8V1-F2-200k-cell"),
      hasPptx: text.includes("P8V1-F2-120-slide"),
      snippet: text.slice(text.indexOf("Results for"), text.indexOf("Results for") + 900),
    };
  });
}
