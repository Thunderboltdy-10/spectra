import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveCollaborationGateway } from "./serve-collaboration-gateway.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "collab-serve-"));
  directories.push(root);
  const rootEnv = {
    SPECTRA_COLLAB_TOKEN_SECRET: "root-fixture-token-".repeat(3),
    SPECTRA_COLLAB_BRIDGE_KEY: "root-fixture-bridge-".repeat(3),
    NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:43002",
    SPECTRA_COLLAB_PORT: "43001",
    SPECTRA_COLLAB_HOST: "127.0.0.1",
  };
  const selected = {
    ...rootEnv,
    SPECTRA_COLLAB_TOKEN_SECRET: "selected-fixture-token-".repeat(3),
    SPECTRA_COLLAB_BRIDGE_KEY: "selected-fixture-bridge-".repeat(3),
    NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:44002",
    SPECTRA_COLLAB_PORT: "44001",
  };
  for (const [name, env] of [[".env.local", rootEnv], ["selected.env", selected]]) {
    writeFileSync(join(root, name), Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\r\n"));
  }
  return { root, rootEnv, selected };
}

describe("supported gateway launcher", () => {
  it("passes the selected stack env file and matched key pair to its only child", async () => {
    const { root, selected } = fixture();
    const runGateway = vi.fn(async () => 0);
    const runtime = { stdout: { write: vi.fn() } };
    expect(await serveCollaborationGateway({
      args: ["--supervise", "--env-file", "selected.env"], root,
      environment: {}, runtime, runGateway,
    })).toBe(0);
    expect(runGateway).toHaveBeenCalledOnce();
    expect(runGateway.mock.calls[0][0]).toMatchObject({
      supervise: true, cwd: root,
      environment: { ...selected, SPECTRA_COLLAB_SERVED_BY: "serve-collaboration-gateway.mjs" },
    });
    const log = runtime.stdout.write.mock.calls[0][0];
    expect(log).toContain("bind=127.0.0.1:44001");
    expect(log).not.toContain(selected.SPECTRA_COLLAB_TOKEN_SECRET);
    expect(log).not.toContain(selected.SPECTRA_COLLAB_BRIDGE_KEY);
  });

  it("keeps the complete supplied finalEnv even when a different root env file exists", async () => {
    const { root, selected } = fixture();
    const runGateway = vi.fn(async () => 0);
    await serveCollaborationGateway({
      args: ["--supervise"], root, environment: { ...selected },
      runtime: { stdout: { write() {} } }, runGateway,
    });
    expect(runGateway.mock.calls[0][0].environment).toMatchObject(selected);
  });

  it.each([["--force"], ["--env-file"], ["--env-file", "missing.env"]])("rejects invalid options %j before spawning", async (...args) => {
    const { root } = fixture();
    const runGateway = vi.fn();
    await expect(serveCollaborationGateway({ args, root, environment: {}, runGateway })).rejects.toThrow();
    expect(runGateway).not.toHaveBeenCalled();
  });

  it("exits truthfully on an occupied disposable port on the native platform without Bash", async () => {
    const { root, selected } = fixture();
    const listener = createServer();
    await new Promise((resolve, reject) => {
      listener.once("error", reject);
      listener.listen({ host: "127.0.0.1", port: 0 }, resolve);
    });
    try {
      const environment = { ...process.env, ...selected, SPECTRA_COLLAB_PORT: String(listener.address().port), PATH: "" };
      const result = await new Promise((resolveRun, reject) => {
        const subprocess = spawn(process.execPath, [
          resolve(scriptRoot, "serve-collaboration-gateway.mjs"), "--supervise", "--env-file", join(root, "selected.env"),
        ], { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let stderr = "";
        subprocess.stderr.on("data", (chunk) => { stderr += chunk; });
        subprocess.once("error", reject);
        subprocess.once("exit", (code) => resolveRun({ code, stderr }));
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("already in use");
      expect(result.stderr).not.toMatch(/bash|ENOENT|Unhandled/i);
      expect(listener.listening).toBe(true);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  });
});
