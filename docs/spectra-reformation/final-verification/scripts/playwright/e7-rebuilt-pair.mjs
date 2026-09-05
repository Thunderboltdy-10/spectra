async (page) => {
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll("script[src]")]
      .map((el) => el.getAttribute("src") || "")
      .find((src) => src.includes("/_next/static/")),
  );
  const buildId = scripts?.match(/\/_next\/static\/([^/]+)\//)?.[1] || null;
  const connect = page.getByRole("button", { name: "Connect this device" });
  if ((await connect.count()) > 0) {
    await connect.click();
    await page.getByText("This computer is connected to Spectra", { exact: false }).waitFor({ timeout: 15000 }).catch(() => null);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-rebuilt-paired.png",
    fullPage: false,
  });
  const text = await page.locator("body").innerText();
  return {
    buildId,
    connected: /This computer is connected/i.test(text),
    connectVisible: await page.getByRole("button", { name: "Connect this device" }).count(),
    disconnectVisible: await page
      .getByRole("button", { name: "Disconnect this computer" })
      .count(),
  };
}
