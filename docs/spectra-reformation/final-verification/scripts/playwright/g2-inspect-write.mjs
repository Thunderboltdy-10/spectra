async (page) => {
  const href = page.url();
  const match = href.match(/operatorSessionId=([^&]+)/);
  const operatorSessionId = match ? decodeURIComponent(match[1]) : null;
  const result = await page.evaluate(async (sessionId) => {
    const response = await fetch("/api/spectra/administration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "invite",
        email: "p8v1-g2-inspect@example.test",
        role: "student",
        operatorSessionId: sessionId,
      }),
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  }, operatorSessionId);
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/g2-operator-inspect-write.png",
    fullPage: false,
  });
  return { href, operatorSessionPresent: Boolean(operatorSessionId), ...result };
}
