async (page) => {
  await page.waitForTimeout(4000);
  const report = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      url: location.href,
      title: document.querySelector('input[aria-label="Untitled work"]')?.value
        || document.querySelector('[value*="P8V1"]')?.value
        || null,
      hasPage1: text.includes("P8.V1 F2 page 1"),
      hasPage40: text.includes("P8.V1 F2 page 40"),
      importing: /import|opening|loading/i.test(text.slice(0, 4000)),
      studio: text.slice(text.indexOf("DOCUMENT") >= 0 ? text.indexOf("DOCUMENT") : 0, (text.indexOf("DOCUMENT") >= 0 ? text.indexOf("DOCUMENT") : 0) + 1200),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-40page-after-wait.png",
    fullPage: false,
  });
  return report;
}
