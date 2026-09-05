async (page) => {
  const editor = page.locator(".ProseMirror").first();
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("P8V1-E7-PENDING-WRITE ");
  await page.waitForTimeout(800);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-pending-write-before-revoke.png",
    fullPage: false,
  });
  return page.evaluate(() => {
    const editorEl = document.querySelector(".ProseMirror");
    const text = document.body.innerText;
    return {
      contentEditable: editorEl?.getAttribute("contenteditable"),
      hasMarker: /P8V1-E7-PENDING-WRITE/.test(
        editorEl instanceof HTMLElement ? editorEl.innerText : "",
      ),
      status:
        [...document.querySelectorAll("[role=status]")]
          .map((el) => el.textContent?.trim())
          .filter(Boolean)
          .slice(0, 6) || [],
      persistenceHits: (
        text.match(
          /Saving|Saved|Queued|Copy on this PC|Connect this device|will never change|Updating/g,
        ) || []
      ).slice(0, 12),
    };
  });
}
