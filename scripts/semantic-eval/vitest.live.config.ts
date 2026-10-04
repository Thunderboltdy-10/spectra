/** `npm run eval:semantic`: the labelled fixtures against the real embeddings endpoint. */
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vitest.config";

export default mergeConfig(base, defineConfig({
  test: {
    include: ["scripts/semantic-eval/semantic-live.eval.ts"],
    setupFiles: ["scripts/semantic-eval/live-env.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
}));
