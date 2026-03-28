import { afterEach, describe, expect, it } from "vitest";
import { decryptManagebacToken, encryptManagebacToken } from "../../../shared/managebac-crypto";

const originalSecret = process.env.MANAGEBAC_CONFIG_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.MANAGEBAC_CONFIG_SECRET;
  } else {
    process.env.MANAGEBAC_CONFIG_SECRET = originalSecret;
  }
});

describe("managebac crypto", () => {
  it("requires an explicit shared secret", async () => {
    delete process.env.MANAGEBAC_CONFIG_SECRET;

    await expect(encryptManagebacToken("token-value")).rejects.toThrow(
      "MANAGEBAC_CONFIG_SECRET is required for ManageBac token encryption and sync.",
    );
  });

  it("round-trips tokens with the configured secret", async () => {
    process.env.MANAGEBAC_CONFIG_SECRET = "0123456789abcdef0123456789abcdef";

    const encrypted = await encryptManagebacToken("secret-token");
    await expect(decryptManagebacToken(encrypted)).resolves.toBe("secret-token");
  });
});
