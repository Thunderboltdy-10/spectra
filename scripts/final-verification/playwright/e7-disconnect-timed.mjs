async (page) => {
  const started = Date.now();
  await page.getByRole("button", { name: "Disconnect this computer" }).click();
  await page
    .getByRole("button", { name: "Connect this device" })
    .waitFor({ timeout: 8000 });
  const elapsedMs = Date.now() - started;
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-rebuilt-disconnect-settled.png",
    fullPage: false,
  });
  const text = await page.locator("body").innerText();
  return {
    elapsedMs,
    connectVisible: await page.getByRole("button", { name: "Connect this device" }).count(),
    disconnecting: /Disconnecting/.test(text),
    queued: /Changes queued safely/.test(text),
    notConnected: /not connected to Spectra|Not connected/i.test(text),
  };
}
