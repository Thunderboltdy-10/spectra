async (page) => {
  const formula = page.getByRole("textbox", { name: /Formula for/ });
  await formula.click({ timeout: 8000 });
  return await page.evaluate(() => {
    const input = document.querySelector('[aria-label^="Formula for"]');
    if (!(input instanceof HTMLInputElement)) return { error: "no input" };
    const marks = [];
    const onInput = () => marks.push({ phase: "input", rel: performance.now() - start });
    input.addEventListener("input", onInput, true);
    const start = performance.now();
    document.execCommand("insertText", false, "N");
    const end = performance.now();
    input.removeEventListener("input", onInput, true);
    return {
      execMs: end - start,
      marks,
      regionTargets: document.querySelectorAll("[data-spectra-target]").length,
    };
  });
}
