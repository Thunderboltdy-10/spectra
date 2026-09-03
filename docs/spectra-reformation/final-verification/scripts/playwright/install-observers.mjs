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
    const byteLength = (value) => {
      if (typeof value === "string")
        return new TextEncoder().encode(value).byteLength;
      if (value instanceof ArrayBuffer) return value.byteLength;
      if (ArrayBuffer.isView(value)) return value.byteLength;
      if (value instanceof Blob) return value.size;
      return 0;
    };
    const text = (value) => {
      try {
        return typeof value === "string"
          ? value.slice(0, 800)
          : JSON.stringify(value).slice(0, 800);
      } catch {
        return String(value).slice(0, 800);
      }
    };
    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);
    console.error = (...args) => {
      state.errors.push({
        at: performance.now(),
        message: args.map(text).join(" "),
      });
      originalError(...args);
    };
    console.warn = (...args) => {
      state.warnings.push({
        at: performance.now(),
        message: args.map(text).join(" "),
      });
      originalWarn(...args);
    };
    addEventListener("error", (event) => {
      state.errors.push({
        at: performance.now(),
        message: text(event.message),
        source: event.filename || undefined,
      });
    });
    addEventListener("unhandledrejection", (event) => {
      state.rejections.push({
        at: performance.now(),
        message: text(event.reason),
      });
    });
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
    try {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(Target, args) {
          const socket = new Target(...args);
          const send = socket.send.bind(socket);
          socket.send = (value) => {
            state.websocket.sentFrames += 1;
            state.websocket.sentBytes += byteLength(value);
            return send(value);
          };
          socket.addEventListener("message", (event) => {
            state.websocket.receivedFrames += 1;
            state.websocket.receivedBytes += byteLength(event.data);
          });
          return socket;
        },
      });
    } catch {}
    state.reset = () => {
      state.startedAt = performance.now();
      state.errors.length = 0;
      state.warnings.length = 0;
      state.rejections.length = 0;
      state.longTasks.length = 0;
      state.layoutShifts.length = 0;
      state.websocket = {
        sentFrames: 0,
        sentBytes: 0,
        receivedFrames: 0,
        receivedBytes: 0,
      };
      performance.clearResourceTimings();
    };
    window.__spectraP8 = state;
  };
  await page.addInitScript(install);
  await page.evaluate(install);
  return { installed: true, url: page.url(), networkObserver: true };
}
