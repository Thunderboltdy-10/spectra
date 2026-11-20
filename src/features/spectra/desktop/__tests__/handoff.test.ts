import { describe, expect, it } from "vitest";
import { handoffCode, handoffId, handoffUrl, newHandoffSecret, openTicket, sealTicket, validHandoffSecret } from "../handoff";

describe("desktop sign-in handoff", () => {
  it("derives the same id and code on both screens, and only the secret opens the seal", async () => {
    const secret = newHandoffSecret();
    expect(validHandoffSecret(secret)).toBe(true);
    expect(await handoffId(secret)).toMatch(/^[a-f0-9]{64}$/);
    expect(await handoffId(secret)).toBe(await handoffId(secret));
    expect(await handoffCode(secret)).toMatch(/^\d{3} \d{3}$/);

    const sealed = await sealTicket(secret, "sit_ticket_value");
    expect(sealed).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(sealed).not.toContain("sit_ticket_value");
    expect(await openTicket(secret, sealed)).toBe("sit_ticket_value");
    await expect(openTicket(newHandoffSecret(), sealed)).rejects.toThrow();
  });

  it("keeps the secret in the fragment, which never reaches a server", () => {
    const secret = newHandoffSecret();
    const url = new URL(handoffUrl("https://spectra.ink/", secret));
    expect(url.pathname).toBe("/desktop/sign-in");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("s")).toBe(secret);
    expect(validHandoffSecret("short")).toBe(false);
    expect(validHandoffSecret(null)).toBe(false);
  });
});
