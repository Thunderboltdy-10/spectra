import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/*
 * Loads the model credentials for the smoke run without printing them.
 * Order: SPECTRA_SMOKE_ENV_FILE, ./.env.local, then the main checkout's
 * .env.local (a worktree has no env file of its own). Only key names are
 * ever reported.
 */

const REQUIRED = ["OPENROUTER_API_KEY", "SPECTRA_MODEL_ID", "SPECTRA_REASONING_PROFILE", "SPECTRA_MODEL_PROVIDER"] as const;

function mainCheckoutEnvFile() {
  try {
    const listing = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
    const first = /^worktree (.+)$/m.exec(listing)?.[1];
    return first ? path.join(first.trim(), ".env.local") : null;
  } catch {
    return null;
  }
}

export function loadSmokeEnv(): { source: string; missing: string[] } {
  const candidates = [process.env.SPECTRA_SMOKE_ENV_FILE, path.resolve(".env.local"), mainCheckoutEnvFile()].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  const file = candidates.find((candidate) => existsSync(candidate));
  if (file) process.loadEnvFile(file);
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  return { source: file ? path.basename(path.dirname(file)) + "/" + path.basename(file) : "process environment", missing };
}
