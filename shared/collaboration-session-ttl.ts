/** Live collaboration JWTs must outlast a classroom period. 10 minutes
 * forced every socket to re-handshake, which a 65-minute soak (and any real
 * lesson) cannot survive without a working Clerk refresh on every tab. */
export const COLLABORATION_SESSION_TTL = "2h";
export const COLLABORATION_SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
