async (page) => {
  return await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource");
    const fetches = resources.filter(
      (entry) =>
        entry.initiatorType === "fetch" ||
        entry.initiatorType === "xmlhttprequest" ||
        entry.initiatorType === "navigation",
    );
    const sameOrigin = fetches.filter((entry) =>
      entry.name.startsWith(location.origin),
    );
    const documents = resources.filter(
      (entry) => entry.initiatorType === "navigation" || entry.name === location.href,
    );
    const byName = {};
    for (const entry of sameOrigin) {
      const name = entry.name.replace(/[?#].*$/, "");
      byName[name] = (byName[name] || 0) + 1;
    }
    return {
      fetchOrNav: fetches.length,
      sameOriginFetch: sameOrigin.length,
      uniqueSameOrigin: Object.keys(byName).length,
      byName,
      largest: sameOrigin
        .slice()
        .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
        .slice(0, 10)
        .map((entry) => ({
          name: entry.name.replace(/[?#].*$/, ""),
          transferSize: entry.transferSize || 0,
        })),
      navCount: documents.length,
    };
  });
}
