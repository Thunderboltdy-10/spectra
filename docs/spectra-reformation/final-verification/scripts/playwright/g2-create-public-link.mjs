async (page) => {
  const artifactId = "wx76fh3p6w3x5qd06gxewprs0h8djr5d";
  const expiresAt = Date.now() + 90_000;
  const response = await page.evaluate(
    async ({ artifactId, expiresAt }) => {
      const result = await fetch("/api/spectra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createPublicLink",
          resourceType: "artifact",
          resourceId: artifactId,
          expiresAt,
        }),
      });
      const payload = await result.json().catch(() => null);
      return { ok: result.ok, status: result.status, payload };
    },
    { artifactId, expiresAt },
  );
  return { ...response, expiresAt };
}
