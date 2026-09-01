/**
 * School invitation tokens have to survive Clerk's sign-in round trip.
 * The join URL is the source of truth; this cookie is the recovery path
 * when the redirect drops the query string.
 */
export const JOIN_TOKEN_COOKIE = "spectra_join_token";
const JOIN_TOKEN_MAX_AGE_SECONDS = 30 * 60;

export function joinTokenFromSearch(search: string) {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get("token")?.trim() || "";
}

export function persistJoinTokenCookie(
  token: string,
  cookieStore: { cookie: string },
) {
  const value = token.trim();
  if (!value) return "";
  cookieStore.cookie = `${JOIN_TOKEN_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${JOIN_TOKEN_MAX_AGE_SECONDS}; SameSite=Lax`;
  return value;
}

export function readJoinTokenCookie(cookieHeader: string) {
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${JOIN_TOKEN_COOKIE}=`));
  if (!match) return "";
  try {
    return decodeURIComponent(match.slice(`${JOIN_TOKEN_COOKIE}=`.length));
  } catch {
    return "";
  }
}

export function clearJoinTokenCookie(cookieStore: { cookie: string }) {
  cookieStore.cookie = `${JOIN_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function resolveJoinToken(search: string, cookieHeader: string) {
  return joinTokenFromSearch(search) || readJoinTokenCookie(cookieHeader);
}

export function joinHrefForToken(token: string) {
  return `/join?token=${encodeURIComponent(token)}`;
}
