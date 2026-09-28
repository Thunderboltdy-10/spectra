async (page) => {
  return page.evaluate(async () => {
    const token = localStorage.getItem("spectra.bridge.session");
    if (!token) return { ok: false, reason: "no session" };
    const statusRes = await fetch("http://127.0.0.1:47615/v1/status", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const status = await statusRes.json();
    const grants = (status.mounts || []).map((mount) => mount.id || mount.grantId);
    const retries = [];
    for (const grantId of grants) {
      if (!grantId) continue;
      const retry = await fetch("http://127.0.0.1:47615/v1/mount/retry", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ grantId }),
      });
      retries.push({ grantId, ok: retry.ok, status: retry.status });
    }
    return {
      ok: true,
      paired: status.paired,
      mounts: (status.mounts || []).map((mount) => ({
        id: mount.id,
        grantId: mount.grantId,
        label: mount.label,
        state: mount.state,
        synced: mount.synced,
        total: mount.total,
      })),
      retries,
    };
  });
}
