import { describe, expect, it } from "vitest";
import {
  JOIN_TOKEN_COOKIE,
  clearJoinTokenCookie,
  joinHrefForToken,
  joinTokenFromSearch,
  persistJoinTokenCookie,
  readJoinTokenCookie,
  resolveJoinToken,
} from "../invitation-session";

describe("invitation cookie recovery", () => {
  it("keeps the join token across a dropped query string", () => {
    const store = { cookie: "" };
    persistJoinTokenCookie("invite-token", store);
    expect(store.cookie).toContain(`${JOIN_TOKEN_COOKIE}=invite-token`);
    expect(readJoinTokenCookie(store.cookie)).toBe("invite-token");
    expect(resolveJoinToken("", store.cookie)).toBe("invite-token");
    expect(joinHrefForToken("invite-token")).toBe("/join?token=invite-token");
  });

  it("prefers the URL token and can forget a spent cookie", () => {
    const store = { cookie: "" };
    persistJoinTokenCookie("stale", store);
    expect(joinTokenFromSearch("?token=fresh")).toBe("fresh");
    expect(resolveJoinToken("?token=fresh", store.cookie)).toBe("fresh");
    clearJoinTokenCookie(store);
    expect(readJoinTokenCookie(store.cookie)).toBe("");
  });
});
