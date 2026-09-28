async (page) => {
  return await page.evaluate(async () => {
    const response = await fetch("/api/spectra/administration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "revokeInvitation",
        invitationId: "r175d6q53hft9se369b8d2xdts8dvwyb",
      }),
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  });
}
