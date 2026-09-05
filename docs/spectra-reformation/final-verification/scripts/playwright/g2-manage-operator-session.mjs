async (page) => {
  const started = await page.evaluate(async () => {
    const list = await fetch(
      "/api/spectra/administration?action=schoolDirectory&includeInactive=true",
    ).then((response) => response.json());
    const schoolId = list?.schools?.[0]?.schoolId;
    if (!schoolId) return { ok: false, list };
    const response = await fetch("/api/spectra/administration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "startOperatorSession",
        schoolId,
        label: "P8.V1 G2 manage",
        reason: "P8.V1 G2 manage session for launch verification write check.",
        mode: "manage",
        durationMinutes: 15,
      }),
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, schoolId, payload };
  });
  const sessionId =
    started?.payload?.sessionId || started?.payload?.result?.sessionId;
  if (sessionId) {
    await page.goto(
      `http://localhost:3000/admin?operatorSessionId=${encodeURIComponent(sessionId)}`,
    );
    await page.waitForTimeout(1800);
  }
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/g2-operator-manage.png",
    fullPage: false,
  });
  const write = sessionId
    ? await page.evaluate(async (operatorSessionId) => {
        const response = await fetch("/api/spectra/administration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "invite",
            email: "p8v1-g2-manage@example.test",
            role: "student",
            operatorSessionId,
          }),
        });
        const payload = await response.json().catch(() => null);
        return { ok: response.ok, status: response.status, payload };
      }, sessionId)
    : null;
  await page.screenshot({
    path: ".shots/reformation/P8.V1/browser/g2-operator-manage-write.png",
    fullPage: false,
  });
  if (sessionId) {
    await page.evaluate(async (operatorSessionId) => {
      await fetch("/api/spectra/administration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "endOperatorSession",
          operatorSessionId,
        }),
      });
    }, sessionId);
    await page.waitForTimeout(800);
  }
  return { started, write, url: page.url() };
}
