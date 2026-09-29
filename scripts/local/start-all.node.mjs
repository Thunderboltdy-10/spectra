import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPorts, parseArguments } from "./start-all.mjs";

test("start-all uses the instance port block and development defaults", () => {
  assert.deepEqual(defaultPorts(1), {
    web: 3000,
    collaboration: 3001,
    convexCloud: 3002,
    convexSite: 3003,
  });
  assert.deepEqual(parseArguments([]), {
    instance: 1,
    mode: "development",
    timeoutSeconds: 900,
    bridge: true,
    buildBridge: false,
    bridgeDataDir: null,
    help: false,
  });
});

test("start-all accepts explicit bridge and production options", () => {
  const options = parseArguments([
    "--instance",
    "2",
    "--mode=production",
    "--timeout-seconds",
    "60",
    "--bridge-data-dir",
    ".spectra-local/bridge",
    "--build-bridge",
    "--no-bridge",
  ]);
  assert.equal(options.instance, 2);
  assert.equal(options.mode, "production");
  assert.equal(options.timeoutSeconds, 60);
  assert.equal(options.bridgeDataDir, ".spectra-local/bridge");
  assert.equal(options.buildBridge, true);
  assert.equal(options.bridge, false);
});

test("start-all rejects unsafe readiness arguments", () => {
  assert.throws(() => parseArguments(["--instance", "0"]), /positive integer/);
  assert.throws(() => parseArguments(["--mode", "staging"]), /mode/);
  assert.throws(() => parseArguments(["--timeout-seconds", "2"]), /at least 5/);
});

test("fresh startup forwards project-selection input and waits for configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "spectra-launch-selection-"));
  const script = join(directory, "configure.mjs");
  const convexConfig = join(directory, "config.json");
  try {
    writeFileSync(script, `
      import { writeFileSync } from "node:fs";
      import { createInterface } from "node:readline";
      if (process.argv[2] !== "configure" || process.argv[3] !== "--instance" || process.argv[4] !== "3") process.exit(3);
      const line = createInterface({ input: process.stdin });
      line.once("line", (selection) => {
        if (selection !== "test-project") process.exit(2);
        writeFileSync(${JSON.stringify(convexConfig)}, "{}");
        process.stdout.write("configured");
        line.close();
      });
      line.once("close", () => process.exit());
    `);
    const moduleUrl = new URL("./start-all.mjs", import.meta.url).href;
    const driver = `
      import { configureFreshInstance } from ${JSON.stringify(moduleUrl)};
      await configureFreshInstance(process.execPath, ${JSON.stringify(script)}, 3,
        { convexConfig: ${JSON.stringify(convexConfig)} });
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", driver], {
      input: "test-project\n", encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(convexConfig), true);
    assert.match(result.stdout, /configured/);

    // A saved instance must never invoke project selection again.
    writeFileSync(script, "process.exit(9);");
    const restart = spawnSync(process.execPath, ["--input-type=module", "-e", driver], {
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(restart.status, 0, restart.stderr);

    rmSync(convexConfig);
    const failed = spawnSync(process.execPath, ["--input-type=module", "-e", driver], {
      encoding: "utf8", timeout: 10_000,
    });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /configuration.*code 9/);

    writeFileSync(script, "process.exit(0);");
    const unsaved = spawnSync(process.execPath, ["--input-type=module", "-e", driver], {
      encoding: "utf8", timeout: 10_000,
    });
    assert.notEqual(unsaved.status, 0);
    assert.match(unsaved.stderr, /without saving a deployment/);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "spectra-launch-selection-")));
    rmSync(directory, { recursive: true, force: true });
  }
});
