import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gatewayHealthPayload } from "./readiness.mjs";

const exec = promisify(execFile);
const stack = fileURLToPath(new URL("./stack.mjs", import.meta.url));

describe("local status command", () => {
  it.each([
    ["valid dependencies", "valid", 200, "ready"],
    ["foreign web", "web", 200, "not_ready"],
    ["foreign gateway", "gateway", 200, "not_ready"],
    ["contradictory HTTP failure", "valid", 503, "not_ready"],
  ])("reports %s accurately without starting a stack", async (_label, foreign, httpStatus, expected) => {
    const root = await mkdtemp(join(tmpdir(), "spectra-status-test-"));
    const instance = join(root, "instances", "1");
    const server = createServer((request, response) => {
      if (request.url === "/instance_name") {
        response.end("fixture-deployment");
        return;
      }
      const kind = request.url === "/api/health" ? "web" : "gateway";
      const body = foreign === kind ? { status: "ready", service: "foreign-service" }
        : kind === "web" ? { service: "spectra-web", status: "ready", mode: "fixture" }
          : gatewayHealthPayload({ protocolVersion: 1 });
      response.writeHead(httpStatus, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    });
    try {
      await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, resolveListen);
      });
      const port = server.address().port;
      await mkdir(instance, { recursive: true });
      await writeFile(join(instance, "instance.json"), JSON.stringify({ schemaVersion: 1, ports: { web: port, collaboration: port, convexCloud: port } }));
      await writeFile(join(instance, "runtime.json"), JSON.stringify({ launcherPid: process.pid, deploymentName: "fixture-deployment" }));
      const { stdout } = await exec(process.execPath, [stack, "status", "--instance", "1"], {
        env: { ...process.env, SPECTRA_LOCAL_ROOT: root }, windowsHide: true, timeout: 10_000,
      });
      expect(stdout).toContain(`Local instance 1: ${expected}\n`);
    } finally {
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error("Unexpected fixture cleanup path");
      await rm(root, { recursive: true, force: true });
    }
  });
});
