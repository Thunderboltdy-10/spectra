async (page) => {
  const config = await page.evaluate(() => ({
    title: sessionStorage.getItem("spectra.p8.artifactTitle") || "",
    method: sessionStorage.getItem("spectra.p8.closeMethod") || "header",
  }));
  const before = {
    url: page.url(),
    title: config.title,
    dialogs: await page.getByRole("dialog").count(),
  };
  if (config.method === "escape") {
    await page.keyboard.press("Escape");
  } else {
    const named = config.title
      ? page.getByRole("button", {
          name: new RegExp(
            `close.*${config.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${config.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*close`,
            "i",
          ),
        })
      : page.getByRole("button", {
          name: /close (work|artifact|document|sheet|presentation)|close/i,
        });
    const target = named.filter({ visible: true }).last();
    if ((await target.count()) === 0)
      return {
        ready: false,
        reason: "Set spectra.p8.artifactTitle or expose a named close control.",
      };
    await target.click();
  }
  await page.waitForTimeout(800);
  const dialog = page.getByRole("dialog").filter({ visible: true });
  return {
    ready: true,
    before,
    after: {
      url: page.url(),
      visibleDialogs: await dialog.count(),
      dialogText: await dialog.allTextContents(),
      titleStillVisible: config.title
        ? await page
            .getByText(config.title, { exact: true })
            .filter({ visible: true })
            .count()
        : null,
      activeElement: await page.evaluate(
        () =>
          document.activeElement?.getAttribute("aria-label") ||
          document.activeElement?.textContent?.trim().slice(0, 120) ||
          document.activeElement?.tagName,
      ),
    },
    note: "If a dirty-state choice appears, complete it visibly, then rerun readback rather than treating this intermediate result as pass.",
  };
}
