import { defineConfig } from "vitest/config";
import path from "node:path";

/*
 * `npm run smoke:ai`: the real harness against the real model, with an
 * in-memory Spectra. It needs OpenRouter credentials (see
 * src/features/spectra/ai/harness/smoke/env.ts) and is never part of the
 * normal test run.
 */
export default defineConfig({
  cacheDir: path.resolve(__dirname, ".spectra-local/vitest-cache"),
  test: {
    environment: "node",
    include: ["src/**/*.smoke.ts"],
    testTimeout: 10 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/server-only-shim.ts"),
    },
  },
});
