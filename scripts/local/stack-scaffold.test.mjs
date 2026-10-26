import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const runtimeRoot = resolve(tmpdir(), `spectra-local-scaffold-${process.pid}`);

afterAll(async () => {
  await rm(runtimeRoot, { recursive: true, force: true });
});

function scaffold(instanceId) {
  return spawnSync(
    process.execPath,
    [
      resolve(scriptDirectory, "stack.mjs"),
      "add-instance",
      "--instance",
      String(instanceId),
      "--source-env",
      ".env.example",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, SPECTRA_LOCAL_ROOT: runtimeRoot },
    },
  );
}

describe("local Convex project scaffolding", () => {
  it("gives every fresh instance the package contract required by the Convex CLI", async () => {
    const repositoryPackage = JSON.parse(
      await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    );

    for (const instanceId of [1, 2]) {
      const result = scaffold(instanceId);
      expect(result.status, result.stderr).toBe(0);

      const instancePackage = JSON.parse(
        await readFile(
          resolve(
            runtimeRoot,
            "instances",
            String(instanceId),
            "project",
            "package.json",
          ),
          "utf8",
        ),
      );
      expect(instancePackage).toEqual({
        name: `spectra-local-instance-${instanceId}`,
        private: true,
        dependencies: {
          convex: repositoryPackage.dependencies.convex,
        },
      });
    }
  });
});
