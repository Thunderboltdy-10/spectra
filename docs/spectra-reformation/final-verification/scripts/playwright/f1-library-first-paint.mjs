async (page) => {
  if (!page.__spectraP8Network) {
    const sanitize = (value) => String(value || "").replace(/[?#].*$/, "");
    const network = { responses: [], failures: [], pageErrors: [] };
    page.on("response", async (response) => {
      const headers = await response.allHeaders().catch(() => ({}));
      network.responses.push({
        at: Date.now(),
        url: sanitize(response.url()),
        status: response.status(),
        resourceType: response.request().resourceType(),
        contentLength: Number(headers["content-length"] || 0) || 0,
      });
    });
    page.on("requestfailed", (request) => {
      network.failures.push({
        at: Date.now(),
        url: sanitize(request.url()),
        resourceType: request.resourceType(),
        error: request.failure()?.errorText || "request failed",
      });
    });
    page.on("pageerror", (error) => {
      network.pageErrors.push({
        at: Date.now(),
        message: String(error.message || error).slice(0, 800),
      });
    });
    page.__spectraP8Network = network;
  }
  const install = () => {
    if (window.__spectraP8) return;
    const state = {
      startedAt: performance.now(),
      errors: [],
      warnings: [],
      rejections: [],
      longTasks: [],
      layoutShifts: [],
      websocket: {
        sentFrames: 0,
        sentBytes: 0,
        receivedFrames: 0,
        receivedBytes: 0,
      },
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput)
            state.layoutShifts.push({
              startTime: entry.startTime,
              value: entry.value,
            });
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
    window.__spectraP8 = state;
  };
  await page.addInitScript(install);
  page.__spectraP8Network.responses.length = 0;
  page.__spectraP8Network.failures.length = 0;
  page.__spectraP8Network.pageErrors.length = 0;
  const started = Date.now();
  await page.goto("http://localhost:3000/library", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor({
    timeout: 20_000,
  });
  const firstPaintAt = Date.now();
  const report = await page.evaluate(() => {
    const state = window.__spectraP8;
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name.replace(/[?#].*$/, ""),
      initiatorType: entry.initiatorType,
      duration: entry.duration,
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
    }));
    const fetchOrDocument = resources.filter(
      (entry) =>
        entry.initiatorType === "fetch" ||
        entry.initiatorType === "xmlhttprequest" ||
        entry.initiatorType === "navigation",
    );
    return {
      url: location.href,
      title: document.title,
      elapsedMs: state ? performance.now() - state.startedAt : null,
      longTasks: state?.longTasks ?? [],
      cumulativeLayoutShift: (state?.layoutShifts ?? []).reduce(
        (sum, entry) => sum + entry.value,
        0,
      ),
      heading: document.querySelector("h1")?.textContent || "",
      fetchOrDocumentCount: fetchOrDocument.length,
      fetchOrDocument: fetchOrDocument.map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize,
      })),
      largestFetchOrDocument: fetchOrDocument
        .slice()
        .sort((left, right) => right.transferSize - left.transferSize)
        .slice(0, 8),
    };
  });
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/f1-library-first-paint.png",
    fullPage: false,
  });
  const network = page.__spectraP8Network;
  const untilHeading = network.responses.filter(
    (response) => response.at <= firstPaintAt,
  );
  const d42 = untilHeading.filter(
    (response) =>
      response.resourceType === "document" ||
      response.resourceType === "fetch" ||
      response.resourceType === "xhr",
  );
  const byUrl = {};
  for (const response of d42) {
    byUrl[response.url] = (byUrl[response.url] || 0) + 1;
  }
  return {
    ...report,
    wallMs: Date.now() - started,
    d42: {
      requestCount: d42.length,
      largestContentLength: Math.max(
        0,
        ...d42.map((response) => response.contentLength),
      ),
      byUrl,
      duplicates: Object.entries(byUrl).filter(([, count]) => count > 1),
    },
    network: {
      responses: network.responses.length,
      untilHeading: untilHeading.length,
      failures: network.failures,
      pageErrors: network.pageErrors,
      failingStatuses: untilHeading.filter((response) => response.status >= 400),
    },
  };
}
