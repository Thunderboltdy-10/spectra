async (page) => {
  const expiresAt = 1788627567484;
  const remaining = expiresAt - Date.now() + 1500;
  if (remaining > 0) await page.waitForTimeout(remaining);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/g2-public-expired.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    expired: /unavailable|expired/i.test(text),
    text: text.slice(0, 600),
    waitedMs: remaining,
  };
}
