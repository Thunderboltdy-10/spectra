function normalizeUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

export function getAppUrl(fallbackOrigin?: string) {
  return (
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL)
    ?? normalizeUrl(fallbackOrigin)
    ?? "http://localhost:3000"
  );
}

export function buildJoinUrl(token: string, fallbackOrigin?: string) {
  return `${getAppUrl(fallbackOrigin)}/join?token=${encodeURIComponent(token)}`;
}
