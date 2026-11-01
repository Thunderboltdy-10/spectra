import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { missingOfficeCorpus, officeCorpusSuites } from "./scripts/office-corpus.mjs";

const missingCorpus = missingOfficeCorpus();
if (missingCorpus.length) {
  console.warn(`Office corpus unavailable: ${officeCorpusSuites.length} external-corpus suites are excluded. See docs/TESTING.md; npm run test:office requires the complete corpus.`);
}

export default defineConfig({
  // Worktrees can share dependencies, but their mutable caches must be local.
  cacheDir: path.resolve(__dirname, ".spectra-local/vitest-cache"),
  test: {
    environment: "node",
    globals: true,
    testTimeout: 15_000,
    setupFiles: ["src/test/setup.ts"],
    exclude: [...configDefaults.exclude, "**/.spectra-local/**", "**/.shots/**", "**/film/**", ...(missingCorpus.length ? officeCorpusSuites : [])],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Vitest runs in Node without Next's react-server condition mapping.
      "server-only": path.resolve(__dirname, "src/test/server-only-shim.ts"),
    },
  },
});
