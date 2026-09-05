async (page) => {
  const restore = page.getByRole("button", { name: /Restore as new version/i }).first();
  const info = await restore.evaluate((el) => ({
    disabled: el.hasAttribute("disabled") || el.getAttribute("disabled") === "",
    text: el.textContent,
  }));
  return {
    restore: info,
    url: page.url(),
  };
}
