import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCollaborationEnv,
  stripEnvValue,
  secretFingerprint,
} from "./load-collaboration-env.mjs";

describe("loadCollaborationEnv", () => {
  it("strips CRLF and BOM from secret values", () => {
    expect(stripEnvValue("abc\r\n")).toBe("abc");
    expect(stripEnvValue("\uFEFFsecret\r")).toBe("secret");
  });

  it("fingerprints secrets without exposing them", () => {
    const fp = secretFingerprint("token-secret-with-thirty-two-chars!!");
    expect(fp).toMatch(/^[a-f0-9]{12}$/);
    expect(fp).not.toContain("token-secret");
  });

  it("loads matched secrets and refuses example.convex.cloud", () => {
    const dir = mkdtempSync(join(tmpdir(), "collab-env-"));
    const path = join(dir, ".env.local");
    writeFileSync(
      path,
      [
        "SPECTRA_COLLAB_TOKEN_SECRET=token-secret-with-thirty-two-chars!!\r",
        "SPECTRA_COLLAB_BRIDGE_KEY=bridge-key-with-thirty-two-chars-ok!\r",
        "NEXT_PUBLIC_CONVEX_URL=https://happy-animal-123.convex.cloud",
        "SPECTRA_COLLAB_PORT=3001",
        "",
      ].join("\n"),
      "utf8",
    );
    const target = {};
    const loaded = loadCollaborationEnv(path, target);
    expect(target.SPECTRA_COLLAB_TOKEN_SECRET.endsWith("\r")).toBe(false);
    expect(target.SPECTRA_COLLAB_TOKEN_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(loaded.convexUrl).toContain("convex.cloud");
    expect(loaded.tokenFingerprint).toMatch(/^[a-f0-9]{12}$/);
    // Serve path ignores file ports so Live :1234 is not hijacked by 3001.
    expect(target.SPECTRA_COLLAB_PORT).toBeUndefined();
    expect(loaded.bindPort).toBe("1234");
    rmSync(dir, { recursive: true, force: true });

    const badDir = mkdtempSync(join(tmpdir(), "collab-env-bad-"));
    const badPath = join(badDir, ".env.local");
    writeFileSync(
      badPath,
      [
        "SPECTRA_COLLAB_TOKEN_SECRET=token-secret-with-thirty-two-chars!!",
        "SPECTRA_COLLAB_BRIDGE_KEY=bridge-key-with-thirty-two-chars-ok!",
        "NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(() => loadCollaborationEnv(badPath, {})).toThrow(
      /COLLABORATION_CONVEX_URL_EXAMPLE/,
    );
    rmSync(badDir, { recursive: true, force: true });
  });

  it("prefers already-exported SPECTRA_COLLAB_PORT over the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "collab-env-port-"));
    const path = join(dir, ".env.local");
    writeFileSync(
      path,
      [
        "SPECTRA_COLLAB_TOKEN_SECRET=token-secret-with-thirty-two-chars!!",
        "SPECTRA_COLLAB_BRIDGE_KEY=bridge-key-with-thirty-two-chars-ok!",
        "NEXT_PUBLIC_CONVEX_URL=https://happy-animal-123.convex.cloud",
        "SPECTRA_COLLAB_PORT=3001",
        "",
      ].join("\n"),
      "utf8",
    );
    const target = { SPECTRA_COLLAB_PORT: "1234" };
    const loaded = loadCollaborationEnv(path, target, { applyFilePorts: true });
    expect(target.SPECTRA_COLLAB_PORT).toBe("1234");
    expect(loaded.bindPort).toBe("1234");
    rmSync(dir, { recursive: true, force: true });
  });
});
