import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
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
    // Both npm dev peers use the file port unless explicitly exported.
    expect(target.SPECTRA_COLLAB_PORT).toBe("3001");
    expect(loaded.bindPort).toBe("3001");
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

describe("selected collaboration environment", () => {
  const directories = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });
  const fileEnv = {
    SPECTRA_COLLAB_TOKEN_SECRET: "fixture-root-token-".repeat(3),
    SPECTRA_COLLAB_BRIDGE_KEY: "fixture-root-bridge-".repeat(3),
    NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:41002",
    SPECTRA_COLLAB_HOST: "127.0.0.2",
    SPECTRA_COLLAB_PORT: "41001",
  };
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "collab-selected-env-"));
    directories.push(directory);
    const path = join(directory, ".env.local");
    writeFileSync(path, Object.entries(fileEnv).map(([key, value]) => `${key}=${value}`).join("\r\n"));
    return path;
  }

  it("preserves the stack-selected token, bridge key, deployment and bind pair", () => {
    const selected = {
      SPECTRA_COLLAB_TOKEN_SECRET: "fixture-instance-token-".repeat(3),
      SPECTRA_COLLAB_BRIDGE_KEY: "fixture-instance-bridge-".repeat(3),
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:42002",
      SPECTRA_COLLAB_PORT: "42001",
      SPECTRA_COLLAB_HOST: "127.0.0.1",
    };
    const target = { ...selected };
    loadCollaborationEnv(fixture(), target);
    expect(target).toMatchObject(selected);
    expect(target.CONVEX_URL).toBe(selected.NEXT_PUBLIC_CONVEX_URL);
  });

  it("uses complete supplied env without requiring a root .env.local", () => {
    const path = fixture();
    const target = { ...fileEnv };
    const loaded = loadCollaborationEnv(join(path, "missing"), target);
    expect(loaded.bindPort).toBe(fileEnv.SPECTRA_COLLAB_PORT);
    expect(target.SPECTRA_COLLAB_TOKEN_SECRET).toBe(fileEnv.SPECTRA_COLLAB_TOKEN_SECRET);
  });

  it("does not allow a root NEXT_PUBLIC alias to replace a supplied CONVEX_URL", () => {
    const target = { CONVEX_URL: "http://127.0.0.1:42002\r\n" };
    loadCollaborationEnv(fixture(), target);
    expect(target.CONVEX_URL).toBe("http://127.0.0.1:42002");
    expect(target.NEXT_PUBLIC_CONVEX_URL).toBe(target.CONVEX_URL);
  });

  it("fails invalid supplied secrets instead of silently replacing them with another instance", () => {
    for (const token of ["short", "", " ".repeat(40)]) {
      expect(() => loadCollaborationEnv(fixture(), { SPECTRA_COLLAB_TOKEN_SECRET: token }))
        .toThrow(/COLLABORATION_TOKEN_CONFIG_MISSING/);
    }
  });

  it("matches Node's web env-file precedence for file defaults and explicit exports", () => {
    const path = fixture();
    // Use Node's quoted-value/comment rules as well as ordinary CRLF delimiters.
    writeFileSync(path, Object.entries(fileEnv).map(([key, value]) => `${key}="${value}" # fixture comment`).join("\r\n"));
    for (const exports of [{}, {
      SPECTRA_COLLAB_TOKEN_SECRET: ` ${"fixture-export-token-".repeat(3)}\r\n`,
      SPECTRA_COLLAB_BRIDGE_KEY: ` ${"fixture-export-bridge-".repeat(3)} `,
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:42002",
      SPECTRA_COLLAB_PORT: "42001",
      SPECTRA_COLLAB_HOST: "127.0.0.1",
    }]) {
      const target = { ...exports };
      loadCollaborationEnv(path, target);
      const inherited = { ...process.env };
      for (const key of [...Object.keys(fileEnv), "CONVEX_URL"]) delete inherited[key];
      const probe = spawnSync(process.execPath, [
        `--env-file=${path}`, "--input-type=module", "-e",
        `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(fileEnv))}.map(key => [key, process.env[key]]))))`,
      ], { env: { ...inherited, ...exports }, encoding: "utf8" });
      expect(probe.status, probe.stderr).toBe(0);
      expect(target).toMatchObject(JSON.parse(probe.stdout));
    }
  });
});
