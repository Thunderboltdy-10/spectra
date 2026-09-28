async (page) => {
  const mode = await page.evaluate(
    () => sessionStorage.getItem("spectra.p8.followInput") || "wheel",
  );
  const follow = page
    .getByRole("button", {
      name: /Follow the AI as it works|Stop following the AI/i,
    })
    .filter({ visible: true })
    .first();
  if ((await follow.count()) === 0)
    return { ready: false, reason: "Reach an active Follow AI state first." };
  const before = await follow.evaluate((element) => ({
    label: element.getAttribute("aria-label") || element.textContent?.trim(),
    pressed: element.getAttribute("aria-pressed"),
    state: element.getAttribute("data-state"),
  }));
  if (mode === "keyboard") await page.keyboard.press("ArrowDown");
  else if (mode === "pointer")
    await page.mouse.click(
      Math.max(8, (page.viewportSize()?.width || 800) / 2),
      Math.max(8, (page.viewportSize()?.height || 600) / 2),
    );
  else await page.mouse.wheel(0, 180);
  await page.waitForTimeout(500);
  const after = await follow
    .evaluate((element) => ({
      label: element.getAttribute("aria-label") || element.textContent?.trim(),
      pressed: element.getAttribute("aria-pressed"),
      state: element.getAttribute("data-state"),
    }))
    .catch(() => ({ label: null, pressed: null, state: "detached" }));
  const disengaged =
    after.state === "detached" ||
    after.pressed === "false" ||
    !/following/i.test(after.label || "");
  return {
    ready: true,
    input: mode,
    before,
    after,
    disengaged,
    url: page.url(),
  };
}
