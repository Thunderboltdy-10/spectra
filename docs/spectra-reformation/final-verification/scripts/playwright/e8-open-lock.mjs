async (page) => {
  if (!page.url().includes("/library")) {
    await page.goto("http://localhost:3000/library");
  }
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.waitFor({ timeout: 15000 });
  await search.fill("");
  await search.fill("P8V1-E8-lock");
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e8-search-lock.png",
    fullPage: false,
  });
  const found = await page.getByRole("row", { name: /P8V1-E8-lock/ }).count();
  if (found) {
    await page.getByRole("row", { name: /P8V1-E8-lock/ }).first().click();
    await page.waitForTimeout(5000);
  }
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e8-lock-open.png",
    fullPage: false,
  });
  return page.evaluate(() => {
    const text = document.body.innerText;
    return {
      url: location.href,
      found: /P8V1-E8-lock/i.test(text),
      sheets: /SHEETS|Sheets|Lock/i.test(text),
      openButton: /Open in Spectra/i.test(text),
      waitingOffice: /Waiting for Office|still has this file open/i.test(text),
    };
  });
}
