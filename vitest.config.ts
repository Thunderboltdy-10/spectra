import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Vitest runs in Node without Next's react-server condition mapping.
      "server-only": path.resolve(__dirname, "src/test/server-only-shim.ts"),
    },
  },
});
