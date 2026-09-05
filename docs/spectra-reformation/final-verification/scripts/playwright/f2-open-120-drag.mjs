async (page) => {
  const search = page.getByRole("textbox", { name: "Search Library" });
  await search.fill("");
  await search.fill("P8V1-F2-120-slide.pptx");
  await page.waitForTimeout(800);
  await page.keyboard.press("ArrowDown");
  const started = Date.now();
  await page.keyboard.press("Enter");
  const stage = page.locator(".presentation-stage").first();
  const appeared = await stage
    .waitFor({ state: "visible", timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(2000);
  const body = await page.evaluate(() => {
    const canvas = document.querySelector(".presentation-stage");
    const box = canvas instanceof HTMLElement ? canvas.getBoundingClientRect() : null;
    const text = document.body.innerText;
    return {
      url: location.href,
      caption: text.match(/You can modify|Read-only|Can modify|Refreshing|Sign in/)?.[0] || null,
      canvas: box && { w: box.width, h: box.height, x: box.x, y: box.y },
      slideText: text.includes("Slide") || Boolean(canvas),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-120-open.png",
    fullPage: false,
  });
  if (body.canvas && body.canvas.w > 100 && body.canvas.h > 100) {
    const startX = body.canvas.x + body.canvas.w * 0.4;
    const startY = body.canvas.y + body.canvas.h * 0.4;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 40, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-120-drag.png",
    fullPage: false,
  });
  return { ...body, appeared, wallMs: Date.now() - started };
}
