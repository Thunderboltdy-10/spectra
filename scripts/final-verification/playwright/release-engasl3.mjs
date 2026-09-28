async (page) => {
  const loaded = await page.evaluate(async () => {
    const response = await fetch("/api/spectra/managebac?action=myClasses");
    const payload = await response.json();
    const classes = payload.data?.classes ?? payload.classes ?? [];
    const target = classes.find(
      (row) =>
        String(row.title ?? "").includes("EngASL3") && row.workspaceId,
    );
    return {
      ok: response.ok,
      target: target
        ? { recordId: target.recordId, title: target.title }
        : null,
      linked: classes
        .filter((row) => row.workspaceId)
        .map((row) => row.title),
    };
  });
  if (!loaded.target) return { ...loaded, released: false, reason: "not-linked" };
  const rounds = [];
  for (let index = 0; index < 400; index += 1) {
    const result = await page.evaluate(async (recordId) => {
      const response = await fetch("/api/spectra/managebac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "releaseClasses",
          recordIds: [recordId],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      return { status: response.status, payload };
    }, loaded.target.recordId);
    const data = result.payload?.data ?? result.payload ?? {};
    const error =
      result.payload?.error?.message ??
      (typeof result.payload?.error === "string" ? result.payload.error : null);
    rounds.push({
      index,
      status: result.status,
      done: data.done,
      remaining: data.remaining,
      removed: data.removed,
      error: error ? String(error).slice(0, 240) : null,
    });
    if (result.status >= 500) return { loaded, rounds, released: false };
    if (data.done === true) return { loaded, rounds, released: true };
    if (data.done === undefined && result.status === 200 && !error)
      return { loaded, rounds, released: "legacy-one-shot" };
  }
  return { loaded, rounds, released: false, reason: "max-rounds" };
}
