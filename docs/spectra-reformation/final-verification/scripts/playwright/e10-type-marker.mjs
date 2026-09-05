async (page) => {
  const marker =
    (await page.evaluate(() => sessionStorage.getItem("spectra.p8.e10Marker"))) ||
    "P8V1-E10-A ";
  const editor = page.locator(".ProseMirror, [contenteditable='true']").first();
  await editor.click({ timeout: 8000 });
  const inserted = await page.evaluate((text) => {
    const target = document.querySelector(".ProseMirror, [contenteditable='true']");
    if (!(target instanceof HTMLElement)) return { ok: false, reason: "no editor" };
    target.focus();
    const ok = document.execCommand("insertText", false, text);
    return {
      ok,
      contentEditable: target.getAttribute("contenteditable"),
      hasMarker: target.innerText.includes(text.trim()),
      head: target.innerText.slice(0, 240),
    };
  }, marker);
  return inserted;
}
