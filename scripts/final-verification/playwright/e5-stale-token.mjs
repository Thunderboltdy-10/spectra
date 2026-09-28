async (page) => {
  await page.unroute("**/api/spectra/collaboration/token");
  await page.route("**/api/spectra/collaboration/token", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "AUTH_NOT_SIGNED_IN: Sign in to continue." },
      }),
    });
  });
  return { installed: true, pattern: "/api/spectra/collaboration/token", status: 401 };
}
