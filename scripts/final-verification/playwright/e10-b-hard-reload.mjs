async (page) => {
  await page.goto(
    "http://localhost:3000/library?artifactId=wx76fh3p6w3x5qd06gxewprs0h8djr5d",
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForTimeout(2500);
  const text = await page
    .locator(".ProseMirror")
    .first()
    .innerText()
    .catch(() => "");
  const body = await page.locator("body").innerText();
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-b-hard-reload.png",
    fullPage: false,
  });
  return {
    url: page.url(),
    role: await page
      .locator("text=student")
      .first()
      .innerText()
      .catch(() => null),
    hasA: text.includes("P8V1-A-CARD9-MARKER"),
    canModify: /You can modify this work/i.test(body),
    readOnly: /read-only|no longer have access|access removed|not shared/i.test(
      body,
    ),
    head: text.slice(0, 240),
    bodyHead: body.slice(0, 400),
  };
}
