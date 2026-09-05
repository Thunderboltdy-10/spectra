async (page) => {
  const href = page.url();
  const artifactId = /artifactId=([^&]+)/.exec(href)?.[1];
  return page.evaluate(async (id) => {
    const response = await fetch("/api/spectra/lenses/office", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open", artifactId: id }),
    });
    const text = await response.text();
    return {
      status: response.status,
      text: text.slice(0, 1500),
    };
  }, artifactId);
}
