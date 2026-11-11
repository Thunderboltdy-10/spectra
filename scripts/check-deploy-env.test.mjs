import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deployEnvProblems } from "./check-deploy-env.mjs";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "check-deploy-env.mjs");
const secret = (label) => `${label}-${"s".repeat(40)}`;
const production = {
  NEXT_PUBLIC_CONVEX_URL: "https://spectra.convex.cloud",
  SPECTRA_APP_URL: "https://spectra.example.org",
  NEXT_PUBLIC_SPECTRA_COLLAB_URL: "wss://realtime.spectra.example.org",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abc",
  CLERK_SECRET_KEY: "sk_live_abc",
  CLERK_WEBHOOK_SECRET: "whsec_abc",
  OPENROUTER_API_KEY: "or-key",
  SPECTRA_AGENT_HUB_URL: "wss://collab.example.com/_spectra/agent-hub",
  SPECTRA_MODEL_ID: "openai/gpt-5.6",
  SPECTRA_REASONING_PROFILE: "xhigh",
  SPECTRA_MODEL_PROVIDER: "OpenAI",
  SPECTRA_MASTER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SPECTRA_SECRET_BRIDGE_KEY: secret("secret"),
  SPECTRA_COLLAB_BRIDGE_KEY: secret("collab"),
  SPECTRA_COLLAB_TOKEN_SECRET: secret("token"),
  SPECTRA_CONNECTOR_BRIDGE_KEY: secret("connector"),
};

// Only what a child node process needs; the developer's own env stays out.
const base = { PATH: process.env.PATH ?? "", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };

function run(env) {
  const result = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("deploy env check", () => {
  it("accepts a complete production environment", () => {
    expect(deployEnvProblems(production)).toEqual([]);
  });

  it("requires the model, reasoning level and provider to be configured", () => {
    const { SPECTRA_MODEL_ID, SPECTRA_MODEL_PROVIDER, ...unconfigured } = production;
    void SPECTRA_MODEL_ID; void SPECTRA_MODEL_PROVIDER;
    expect(deployEnvProblems({ ...unconfigured, SPECTRA_REASONING_PROFILE: "extreme" })).toEqual([
      expect.stringContaining("SPECTRA_MODEL_ID is missing"),
      expect.stringContaining("SPECTRA_REASONING_PROFILE must be one of"),
      expect.stringContaining("SPECTRA_MODEL_PROVIDER is missing"),
    ]);
    expect(deployEnvProblems({ ...production, SPECTRA_FALLBACK_MODEL_ID: "luna" })).toEqual([
      expect.stringContaining("SPECTRA_FALLBACK_MODEL_ID must be an OpenRouter model id"),
    ]);
  });

  it("names every development fallback that would silently apply in production", () => {
    const problems = deployEnvProblems({
      ...production,
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210",
      SPECTRA_APP_URL: "",
      NEXT_PUBLIC_SPECTRA_COLLAB_URL: "ws://localhost:1234",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abc",
      CLERK_SECRET_KEY: "sk_test_abc",
      SPECTRA_MASTER_ENCRYPTION_KEY: "c2hvcnQ=",
      SPECTRA_COLLAB_TOKEN_SECRET: "short",
      SPECTRA_CONNECTOR_BRIDGE_KEY: production.SPECTRA_SECRET_BRIDGE_KEY,
      SPECTRA_AGENT_EVAL_BRIDGE_KEY: "too-short",
      MANAGEBAC_API_KEY: "shared-school-key",
      SPECTRA_TEST_INLINE_RUNS: "1",
    });
    expect(problems).toEqual([
      "NEXT_PUBLIC_CONVEX_URL must use https (Convex deployment).",
      "SPECTRA_APP_URL is missing (Convex scheduled callbacks; without it every AI run executes inline in the request).",
      "NEXT_PUBLIC_SPECTRA_COLLAB_URL must use wss (realtime collaboration gateway).",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a production (pk_live_) key.",
      "CLERK_SECRET_KEY must be a production (sk_live_) key.",
      "SPECTRA_MASTER_ENCRYPTION_KEY must be 32 base64-encoded bytes.",
      "SPECTRA_COLLAB_TOKEN_SECRET must be at least 32 characters.",
      "SPECTRA_AGENT_EVAL_BRIDGE_KEY is set but shorter than 32 characters.",
      "SPECTRA_CONNECTOR_BRIDGE_KEY reuses the value of SPECTRA_SECRET_BRIDGE_KEY; each trust boundary needs its own key.",
      "MANAGEBAC_API_KEY must not be set in production: it lets a blank admin token fall back to one shared ManageBac key.",
      "SPECTRA_TEST_INLINE_RUNS must not be set in production: it runs every AI run inside the request instead of the durable scheduler.",
    ]);
  });

  it("rejects a remote-looking URL that still points at a local host", () => {
    expect(deployEnvProblems({ ...production, SPECTRA_APP_URL: "https://localhost:3000" }))
      .toEqual(["SPECTRA_APP_URL points at localhost (Convex scheduled callbacks; without it every AI run executes inline in the request)."]);
  });

  it("fails production builds, warns on previews and skips other builds", () => {
    const broken = { ...base, ...production, CLERK_SECRET_KEY: "sk_test_abc" };
    expect(run({ ...broken, VERCEL_ENV: "production" })).toMatchObject({ status: 1 });
    expect(run({ ...broken, VERCEL_ENV: "production" }).output).toContain("CLERK_SECRET_KEY must be a production (sk_live_) key.");
    expect(run({ ...broken, VERCEL_ENV: "preview" })).toMatchObject({ status: 0 });
    expect(run({ ...broken, VERCEL_ENV: "preview" }).output).toContain("found 1 problem(s) for preview");
    expect(run(base).output).toContain("skipped");
    expect(run({ ...base, ...production, VERCEL_ENV: "production" }))
      .toMatchObject({ status: 0 });
  });
});
