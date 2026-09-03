async (page) => {
  const config = await page.evaluate(() => ({
    pattern: sessionStorage.getItem("spectra.p8.faultPattern") || "",
    mode: sessionStorage.getItem("spectra.p8.faultMode") || "abort",
    delayMs: Number(
      sessionStorage.getItem("spectra.p8.faultDelayMs") || "3000",
    ),
    status: Number(sessionStorage.getItem("spectra.p8.faultStatus") || "503"),
  }));
  if (!config.pattern || config.pattern === "**/*") {
    return {
      installed: false,
      reason:
        "Set a specific spectra.p8.faultPattern; blanket routing is refused.",
    };
  }
  if (!/^\*\*\/|^https?:\/\//.test(config.pattern)) {
    return {
      installed: false,
      reason: "Fault pattern must be an explicit URL or start with **/.",
    };
  }
  if (!new Set(["abort", "delay", "status"]).has(config.mode)) {
    return {
      installed: false,
      reason: "Fault mode must be abort, delay, or status.",
    };
  }
  const handler = async (route) => {
    if (config.mode === "abort") return route.abort("internetdisconnected");
    if (config.mode === "status")
      return route.fulfill({
        status: config.status,
        contentType: "application/json",
        body: JSON.stringify({ error: "Controlled P8 fault" }),
      });
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(30000, Math.max(0, config.delayMs))),
    );
    return route.continue();
  };
  await page.route(config.pattern, handler);
  return {
    installed: true,
    pattern: config.pattern,
    mode: config.mode,
    delayMs: config.delayMs,
    status: config.status,
  };
}
