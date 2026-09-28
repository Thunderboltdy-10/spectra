async (page) => {
  const seed = page.getByText("P8V1-E7-PENDING-WRITE").first();
  if ((await seed.count()) === 0) {
    await page.getByText("P8V1-D3-UNIQUE-SEED-20260905").first().click();
  } else {
    await seed.click();
  }
  const inserted = await page.evaluate(() => {
    const editor = document.querySelector(".ProseMirror");
    if (!(editor instanceof HTMLElement)) return { ok: false, reason: "no editor" };
    editor.focus();
    const ok = document.execCommand("insertText", false, " P8V1-E7-PENDING-HELD ");
    return {
      ok,
      hasHeld: editor.innerText.includes("P8V1-E7-PENDING-HELD"),
      hasFirst: editor.innerText.includes("P8V1-E7-PENDING-WRITE"),
      head: editor.innerText.slice(0, 160),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/e7-held-pending-before-revoke.png",
    fullPage: false,
  });
  return inserted;
}
