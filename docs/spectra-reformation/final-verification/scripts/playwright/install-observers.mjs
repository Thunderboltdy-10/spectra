async (page) => {
  if (page.__spectraP8Network && page.__spectraP8Network.schemaVersion !== 3)
    throw new Error("An older observer is installed. Use a fresh page before this measurement.");
  if (!page.__spectraP8Network) {
    const sanitize = (value) => String(value || "").replace(/[?#].*$/, "");
    const network = { schemaVersion: 3, generation: 0, responses: [], transfers: [], pendingSizes: 0, failures: [], pageErrors: [] };
    page.on("response", async (response) => {
      const generation = network.generation;
      const headers = await response.allHeaders().catch(() => ({}));
      if (generation !== network.generation) return;
      network.responses.push({
        at: Date.now(),
        url: sanitize(response.url()),
        status: response.status(),
        resourceType: response.request().resourceType(),
        contentLength: headers["content-length"] === undefined ? null : Number(headers["content-length"]),
      });
    });
    page.on("requestfinished", async (request) => {
      network.pendingSizes += 1;
      const generation = network.generation;
      const at = Date.now();
      try {
        const sizes = await request.sizes().catch(() => null);
        if (generation !== network.generation) return;
        network.transfers.push({ at, url: sanitize(request.url()), method: request.method(),
          requestBodyBytes: sizes?.requestBodySize ?? null,
          responseBodyBytes: sizes?.responseBodySize ?? null,
          responseHeadersBytes: sizes?.responseHeadersSize ?? null });
      } finally { network.pendingSizes -= 1; }
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
  const install = (beforeApp = false) => {
    if (window.__spectraP8 && window.__spectraP8.schemaVersion !== 3)
      throw new Error("An older browser observer is installed; reload after installing the current init script.");
    if (window.__spectraP8) return;
    const state = {
      schemaVersion: 3,
      startedAt: performance.now(),
      installedBeforeApp: beforeApp === true,
      editorReadiness: [],
      socketLifecycle: { created: 0, opened: 0, closed: 0, active: 0, peak: 0 },
      convexQueries: { added: 0, removed: 0, active: 0, peak: 0, mutationFrames: 0, byFunction: Object.create(null) },
      supported: { longTask: false, layoutShift: false, webSocket: false },
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
      state.supported.longTask = true;
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
      state.supported.layoutShift = true;
    } catch {}
    try {
      const queryStats = (name) => state.convexQueries.byFunction[name] ??=
        { added: 0, removed: 0, active: 0, peak: 0 };
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(Target, args) {
          const socket = new Target(...args);
          const queryIds = new Map();
          state.socketLifecycle.created += 1;
          socket.addEventListener("open", () => {
            state.socketLifecycle.opened += 1;
            state.socketLifecycle.active += 1;
            state.socketLifecycle.peak = Math.max(state.socketLifecycle.peak, state.socketLifecycle.active);
          });
          let opened = false;
          socket.addEventListener("open", () => { opened = true; });
          socket.addEventListener("close", () => {
            state.socketLifecycle.closed += 1;
            if (opened) state.socketLifecycle.active -= 1;
            state.convexQueries.active -= queryIds.size;
            for (const name of queryIds.values()) queryStats(name).active -= 1;
            queryIds.clear();
          });
          const send = socket.send.bind(socket);
          socket.send = (value) => {
            const sent = send(value);
            state.websocket.sentFrames += 1;
            state.websocket.sentBytes += byteLength(value);
            // Only protocol metadata survives: never arguments or update bodies.
            if (typeof value === "string") {
              try {
                const message = JSON.parse(value);
                if (message.type === "ModifyQuerySet" && Array.isArray(message.modifications)) {
                  for (const change of message.modifications) {
                    if (change.type === "Add" && !queryIds.has(change.queryId)) {
                      const name = typeof change.udfPath === "string" ? change.udfPath.slice(0, 200) : "unknown";
                      queryIds.set(change.queryId, name);
                      const stats = queryStats(name);
                      stats.added += 1;
                      stats.active += 1;
                      stats.peak = Math.max(stats.peak, stats.active);
                      state.convexQueries.added += 1;
                      state.convexQueries.active += 1;
                    } else if (change.type === "Remove" && queryIds.has(change.queryId)) {
                      const stats = queryStats(queryIds.get(change.queryId));
                      stats.removed += 1;
                      stats.active -= 1;
                      queryIds.delete(change.queryId);
                      state.convexQueries.removed += 1;
                      state.convexQueries.active -= 1;
                    }
                  }
                  state.convexQueries.peak = Math.max(state.convexQueries.peak, state.convexQueries.active);
                } else if (message.type === "Mutation") state.convexQueries.mutationFrames += 1;
              } catch { /* Binary/other protocols are byte-counted only. */ }
            }
            return sent;
          };
          socket.addEventListener("message", (event) => {
            state.websocket.receivedFrames += 1;
            state.websocket.receivedBytes += byteLength(event.data);
          });
          return socket;
        },
      });
      state.supported.webSocket = true;
    } catch {}
    const ready = new WeakMap();
    const inspectReady = () => {
      for (const node of document.querySelectorAll('[data-spectra-studio]')) {
        if (node.getAttribute("data-spectra-editor-ready") !== "true") { ready.delete(node); continue; }
        const artifactId = node.getAttribute("data-spectra-studio");
        if (ready.get(node) === artifactId) continue;
        ready.set(node, artifactId);
        state.editorReadiness.push({ at: performance.now(), artifactId });
      }
    };
    new MutationObserver(inspectReady).observe(document, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["data-spectra-editor-ready", "data-spectra-studio"] });
    inspectReady();
    state.reset = () => {
      state.startedAt = performance.now();
      state.errors.length = 0;
      state.warnings.length = 0;
      state.rejections.length = 0;
      state.longTasks.length = 0;
      state.layoutShifts.length = 0;
      state.editorReadiness.length = 0;
      state.socketLifecycle = { created: 0, opened: 0, closed: 0, active: state.socketLifecycle.active, peak: state.socketLifecycle.active };
      const byFunction = Object.create(null);
      for (const [name, stats] of Object.entries(state.convexQueries.byFunction))
        byFunction[name] = { added: 0, removed: 0, active: stats.active, peak: stats.active };
      state.convexQueries = { added: 0, removed: 0, active: state.convexQueries.active, peak: state.convexQueries.active, mutationFrames: 0, byFunction };
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
  await page.addInitScript(install, true);
  await page.evaluate(install, false);
  return { installed: true, url: page.url(), networkObserver: true };
}
