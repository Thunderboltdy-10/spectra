async (page) => {
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const restore = buttons.find((button) =>
      (button.textContent || "").includes("Restore as new version"),
    );
    if (!restore) return { ok: false, reason: "missing" };
    restore.click();
    return {
      ok: true,
      disabled: restore.hasAttribute("disabled"),
      text: restore.textContent,
    };
  });
  await page.waitForTimeout(4000);
  const body = await page.locator("body").innerText();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-restored-dom.png",
    fullPage: false,
  });
  return {
    clicked,
    historyOpen: /Comparing versions/i.test(body),
    conflict: /restore could not|still saving|withheld|queued for review|UNINITIALIZED/i.test(
      body,
    ),
    conflictSlice: body.match(
      /restore[\s\S]{0,180}|still saving[\s\S]{0,80}|withheld[\s\S]{0,80}/i,
    )?.[0],
    hasA: body.includes("P8V1-A-CARD9-MARKER"),
  };
}
