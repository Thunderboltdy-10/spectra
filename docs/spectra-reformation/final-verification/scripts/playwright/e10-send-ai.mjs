async (page) => {
  const box = page.getByRole("textbox", {
    name: /Ask Spectra about P5V1-CARD9-TWO-HUMANS/i,
  });
  await box.click({ timeout: 8000 });
  await box.fill(
    "Append a final paragraph containing only P8V1-E10-AI-MARKER to this document. Do not change other text.",
  );
  await page.getByRole("button", { name: "Send command" }).click();
  await page.waitForTimeout(1500);
  const follow = page.getByRole("button", {
    name: /Follow the AI as it works|Stop following the AI/i,
  });
  return {
    url: page.url(),
    sendEnabled: await page.getByRole("button", { name: "Send command" }).isEnabled(),
    followCount: await follow.count(),
    followLabel: (await follow.count())
      ? await follow.first().getAttribute("aria-label")
      : null,
    bodyHasE10Ai: await page
      .locator(".ProseMirror")
      .first()
      .innerText()
      .then((text) => text.includes("P8V1-E10-AI-MARKER"))
      .catch(() => false),
  };
}
