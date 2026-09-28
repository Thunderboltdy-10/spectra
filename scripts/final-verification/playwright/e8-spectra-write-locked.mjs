async (page) => {
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e8-before-spectra-write.png",
    fullPage: false,
  });
  const cell = page.locator('[role="gridcell"], [data-address="A1"]').first();
  if (await cell.count()) await cell.click({ timeout: 4000 }).catch(() => undefined);
  await page.keyboard.press("F2");
  await page.keyboard.type("P8V1-E8-SPECTRA");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4000);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e8-after-spectra-write-locked.png",
    fullPage: false,
  });
  return page.evaluate(() => {
    const text = document.body.innerText;
    return {
      url: location.href,
      waitingOffice: /Waiting for Office|still has this file open|queued safely/i.test(text),
      conflict: /changed before Spectra|Nothing was overwritten|conflict/i.test(text),
      saved: /\bSaved\b/.test(text),
      statuses: [...document.querySelectorAll("[role=status]")]
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, 8),
      hits: (
        text.match(
          /Waiting for Office|still has this file open|Nothing was overwritten|Queued|Saving|Saved|conflict/gi,
        ) || []
      ).slice(0, 12),
    };
  });
}
