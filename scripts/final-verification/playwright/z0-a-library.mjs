async (page) => {
  await page.goto("http://localhost:3000/library", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor({
    timeout: 20_000,
  });
  const heading = await page.locator("h1").first().textContent();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/z0-a-library.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    heading,
    bodyStart: (await page.locator("body").innerText()).slice(0, 400),
  };
}
