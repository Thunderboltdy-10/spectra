async (page) => {
  const seed = page.getByText("P8V1-D3-UNIQUE-SEED-20260905").first();
  await seed.click();
  const inserted = await page.evaluate(() => {
    const editor = document.querySelector(".ProseMirror");
    if (!(editor instanceof HTMLElement)) return { ok: false, reason: "no editor" };
    editor.focus();
    const ok = document.execCommand("insertText", false, "P8V1-E7-PENDING-WRITE ");
    return {
      ok,
      contentEditable: editor.getAttribute("contenteditable"),
      hasMarker: editor.innerText.includes("P8V1-E7-PENDING-WRITE"),
      head: editor.innerText.slice(0, 120),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-pending-write-inserted.png",
    fullPage: false,
  });
  return inserted;
}
