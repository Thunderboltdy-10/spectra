async (page) => {
  const body = await page.evaluate(() => {
    const text = document.body.innerText;
    const studio = text.slice(text.indexOf("Econ Dec Mocks"), text.indexOf("Econ Dec Mocks") + 900);
    const canvas = document.querySelector(".presentation-stage, [data-slide-id], [data-testid='slide-canvas'], .spectra-slide, [aria-label*='Slide']");
    const box = canvas instanceof HTMLElement ? canvas.getBoundingClientRect() : null;
    return {
      url: location.href,
      caption: text.match(/You can modify|Read-only|Can modify|Refreshing|Sign in/)?.[0] || null,
      studio,
      canvas: box && { w: box.width, h: box.height, x: box.x, y: box.y },
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f1-deck-ready.png",
    fullPage: false,
  });
  if (body.canvas) {
    const startX = body.canvas.x + body.canvas.w * 0.4;
    const startY = body.canvas.y + body.canvas.h * 0.4;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 40, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f1-deck-drag.png",
    fullPage: false,
  });
  return body;
}
