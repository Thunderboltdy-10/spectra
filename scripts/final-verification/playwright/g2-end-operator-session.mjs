async (page) => {
  await page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find((el) =>
      /end session/i.test(el.textContent || ""),
    );
    button?.click();
  });
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/g2-operator-ended.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    text: await page.evaluate(() => document.body.innerText.slice(0, 1200)),
  };
}
