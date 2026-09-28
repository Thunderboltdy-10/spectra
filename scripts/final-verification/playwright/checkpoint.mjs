async (page) => {
  const report = await page.evaluate(() => {
    const state = window.__spectraP8;
    const label =
      sessionStorage.getItem("spectra.p8.checkpointLabel") || "checkpoint";
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name.replace(/[?#].*$/, ""),
      initiatorType: entry.initiatorType,
      duration: entry.duration,
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
      decodedBodySize: entry.decodedBodySize || 0,
    }));
    const animations = document
      .getAnimations()
      .filter((animation) => animation.playState === "running");
    return {
      label,
      url: location.href,
      title: document.title,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      elapsedMs: state ? performance.now() - state.startedAt : null,
      errors: state?.errors ?? [],
      warnings: state?.warnings ?? [],
      rejections: state?.rejections ?? [],
      longTasks: state?.longTasks ?? [],
      cumulativeLayoutShift: (state?.layoutShifts ?? []).reduce(
        (sum, entry) => sum + entry.value,
        0,
      ),
      layoutShifts: state?.layoutShifts ?? [],
      websocket: state?.websocket ?? null,
      socketLifecycle: state?.socketLifecycle ?? null,
      convexQueries: state?.convexQueries ?? null,
      observationCoverage: state ? { installedBeforeApp: state.installedBeforeApp, ...state.supported } : null,
      editorReadiness: state?.editorReadiness.map((entry) => ({ ...entry, elapsedMs: entry.at - state.startedAt })) ?? null,
      heap: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        semantics: "Chromium process heap sample; GC and other pages affect it" } : null,
      databaseIoReadBytes: null,
      checkpointWrites: null,
      resources: {
        count: resources.length,
        zeroTransferEntries: resources.filter((entry) => entry.transferSize === 0).length,
        semantics: "Observed ResourceTiming only; zero transfer can mean cache reuse or missing cross-origin timing. Do not treat the sum as complete network or DB I/O.",
        transferBytes: resources.reduce(
          (sum, entry) => sum + entry.transferSize,
          0,
        ),
        largest: resources
          .sort((left, right) => right.transferSize - left.transferSize)
          .slice(0, 12),
      },
      runningAnimations: animations.length,
      activeElement:
        document.activeElement?.getAttribute("aria-label") ||
        document.activeElement?.textContent?.trim().slice(0, 120) ||
        document.activeElement?.tagName,
    };
  });
  const label = /^[a-z0-9][a-z0-9-]{0,79}$/i.test(report.label)
    ? report.label
    : "checkpoint";
  const screenshot = `.shots/reformation/P8.V1/browser/${label}.png`;
  await page.screenshot({ path: screenshot, fullPage: false });
  const network = page.__spectraP8Network ?? {
    responses: [],
    failures: [],
    pageErrors: [],
  };
  return {
    ...report,
    screenshot,
    network: {
      transfers: network.transfers ?? [],
      pendingSizes: network.pendingSizes ?? null,
      responses: network.responses,
      failures: network.failures,
      pageErrors: network.pageErrors,
      failingStatuses: network.responses.filter(
        (response) => response.status >= 400,
      ),
      declaredTransferBytes: network.responses.some((response) => response.contentLength === null) ? null
        : network.responses.reduce((sum, response) => sum + response.contentLength, 0),
      declaredTransferCoverage: { known: network.responses.filter((response) => response.contentLength !== null).length, total: network.responses.length },
      semantics: "HTTP body/header sizes, ResourceTiming and WebSocket frame payloads are separate; none measure database I/O. Late observer installation cannot count pre-existing sockets or subscriptions.",
    },
  };
}
