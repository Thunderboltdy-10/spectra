async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("xlsx-run3");
  await page.waitForTimeout(800);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 2500));
  const counts = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].map(
      (el) => el.getAttribute("aria-label") || el.textContent || "",
    );
    return {
      visibleCards: document.querySelectorAll("[class*='organizer'] button, main button").length,
      sample: buttons.filter((text) => /xlsx|pptx|sheet|presentation|xlsx-run|Mocks/i.test(text)).slice(0, 20),
      totals: [...document.querySelectorAll("[aria-label$='in total'], [aria-label*='in total']")].map(
        (el) => el.getAttribute("aria-label") || el.textContent,
      ),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-library-search-xlsx.png",
    fullPage: false,
  });
  return { body: body.slice(0, 1200), counts };
}
