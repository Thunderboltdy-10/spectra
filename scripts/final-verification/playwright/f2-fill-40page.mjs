async (page) => {
  const inserted = await page.evaluate(async () => {
    const editor = document.querySelector(".ProseMirror");
    if (!(editor instanceof HTMLElement)) return { ok: false, reason: "no ProseMirror" };
    editor.focus();
    const parts = [];
    for (let pageNumber = 1; pageNumber <= 40; pageNumber += 1) {
      parts.push(`<h1>P8.V1 F2 page ${pageNumber}</h1>`);
      for (let paragraph = 1; paragraph <= 8; paragraph += 1) {
        parts.push(
          `<p>Page ${pageNumber} paragraph ${paragraph}. Density fixture for first useful paint and keystroke measurement at document scale.</p>`,
        );
      }
    }
    const html = parts.join("");
    const ok = document.execCommand("insertHTML", false, html);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      ok,
      textLength: editor.innerText.length,
      hasPage1: editor.innerText.includes("P8.V1 F2 page 1"),
      hasPage40: editor.innerText.includes("P8.V1 F2 page 40"),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f2-40page-native-fill.png",
    fullPage: false,
  });
  return inserted;
}
