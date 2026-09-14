import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCollaborationEnv,
  stripEnvValue,
} from "./load-collaboration-env.mjs";

describe("loadCollaborationEnv", () => {
  it("strips CRLF and BOM from secret values", () => {
    expect(stripEnvValue("abc\r\n")).toBe("abc");
    expect(stripEnvValue("\uFEFFsecret\r")).toBe("secret");
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
        "",
      ].join("\n"),
      "utf8",
    );
    const target = {};
    const loaded = loadCollaborationEnv(path, target);
    expect(target.SPECTRA_COLLAB_TOKEN_SECRET.endsWith("\r")).toBe(false);
    expect(target.SPECTRA_COLLAB_TOKEN_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(loaded.convexUrl).toContain("convex.cloud");
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
});
