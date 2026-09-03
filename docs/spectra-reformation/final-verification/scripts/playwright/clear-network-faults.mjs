async (page) => {
  await page.unrouteAll({ behavior: "wait" });
  return { cleared: true, url: page.url() };
}
