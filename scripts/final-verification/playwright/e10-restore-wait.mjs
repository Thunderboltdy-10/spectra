async (page) => {
  await page.waitForTimeout(12000);
  const body = await page.locator("body").innerText();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-restore-after-wait.png",
    fullPage: false,
  });
  return {
    historyOpen: /Comparing versions/i.test(body),
    stillSaving: /still saving your latest edit/i.test(body),
    withheld: /withheld|could not be applied/i.test(body),
    uninitialized: /UNINITIALIZED/i.test(body),
    liveConflict: /collaborator is editing/i.test(body),
    slice: body.includes("still saving")
      ? body.slice(body.indexOf("still saving") - 40, body.indexOf("still saving") + 160)
      : body.includes("could not")
        ? body.slice(Math.max(0, body.indexOf("could not") - 40), body.indexOf("could not") + 160)
        : null,
  };
}
