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

export function authHrefForRedirect(path: "/sign-in" | "/sign-up", redirectUrl?: string) {
  const target = redirectUrl?.trim();
  return target
    ? `${path}?redirect_url=${encodeURIComponent(target)}`
    : path;
}

export const INVITATION_PREVIEW_MAX_RETRIES = 2;

/** Invitation and membership decisions are final; only transport failures retry. */
const FINAL_INVITATION_FAILURE = /\b(?:INVITATION|MEMBERSHIP)_[A-Z_]+/;

export function invitationPreviewCanRetry(
  message: string,
  attempt = 0,
) {
  return (
    attempt < INVITATION_PREVIEW_MAX_RETRIES &&
    !FINAL_INVITATION_FAILURE.test(message)
  );
}

/**
 * The administration client carries the route's machine code beside the
 * sentence. Rejoin them so invitation decisions can be recognised; the code is
 * never rendered.
 */
export function invitationFailureText(error: unknown) {
  if (!(error instanceof Error)) return "";
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code && !error.message.startsWith(code)
    ? `${code}: ${error.message}`
    : error.message;
}
