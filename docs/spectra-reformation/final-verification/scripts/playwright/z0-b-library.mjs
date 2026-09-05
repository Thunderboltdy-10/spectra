async (page) => {
  await page.goto("http://localhost:3000/library", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor({
    timeout: 20_000,
  });
  const heading = await page.locator("h1").first().textContent();
  const text = await page.locator("body").innerText();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/z0-b-library.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    heading,
    hasUnique: text.includes("P8V1-D3-unique"),
    bodyStart: text.slice(0, 400),
  };
}
