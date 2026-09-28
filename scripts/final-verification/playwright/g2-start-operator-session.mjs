async (page) => {
  const submitted = await page.evaluate(() => {
    const form = document.querySelector("#operator-session-form");
    if (!(form instanceof HTMLFormElement)) return { ok: false, reason: "no form" };
    form.requestSubmit();
    return { ok: true };
  });
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/g2-operator-inspect.png",
    fullPage: false,
  });
  return {
    submitted,
    url: page.url(),
    text: await page.evaluate(() => document.body.innerText.slice(0, 2200)),
  };
}
