import test from "node:test";
import assert from "node:assert/strict";
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
