async (page) => {
  const offline = (await page.evaluate(() => sessionStorage.getItem("spectra.p8.offline"))) === "1";
  await page.context().setOffline(offline);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: offline
      ? ".shots/reformation/P8.V1/browser/e10-a-offline.png"
      : ".shots/reformation/P8.V1/browser/e10-a-online.png",
    fullPage: false,
  });
  return { offline, url: page.url() };
}
