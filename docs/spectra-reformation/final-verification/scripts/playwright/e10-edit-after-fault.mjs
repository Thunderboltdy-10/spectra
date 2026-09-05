async (page) => {
  const marker =
    (await page.evaluate(() => sessionStorage.getItem("spectra.p8.e10Marker"))) ||
    "P8V1-E10-GW ";
  const editor = page.locator(".ProseMirror, [contenteditable='true']").first();
  const editorCount = await editor.count();
  if (editorCount === 0) {
    return { ok: false, reason: "no editor", url: page.url() };
  }
  await editor.click({ timeout: 8000 });
  const inserted = await page.evaluate((text) => {
    const target = document.querySelector(".ProseMirror, [contenteditable='true']");
    if (!(target instanceof HTMLElement)) return { ok: false, reason: "no editor" };
    target.focus();
    const ok = document.execCommand("insertText", false, text);
    return {
      ok,
      hasMarker: target.innerText.includes(text.trim()),
      head: target.innerText.slice(-180),
    };
  }, marker);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e10-a-after-gateway-kill.png",
    fullPage: false,
  });
  return { ...inserted, url: page.url() };
}
