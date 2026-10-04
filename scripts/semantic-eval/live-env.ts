/**
 * Setup for `npm run eval:semantic`: loads the OpenRouter key and the embedding model from
 * `.env.local` before any Convex module reads them. Values are never printed.
 *
 * The file is `SEMANTIC_EVAL_ENV_FILE`, else `.env.local` here, else the primary checkout's
 * `.env.local` (worktrees share it). The model is `SEMANTIC_EVAL_MODEL`, else the file's
 * `SPECTRA_EMBEDDING_MODEL`, else the test default from src/test/setup.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

function envFile() {
  if (process.env.SEMANTIC_EVAL_ENV_FILE) return process.env.SEMANTIC_EVAL_ENV_FILE;
  const local = path.resolve(".env.local");
  if (existsSync(local)) return local;
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
    const primary = path.join(path.dirname(common), ".env.local");
    if (existsSync(primary)) return primary;
  } catch { /* not a git checkout */ }
  return null;
}

const file = envFile();
const values = file ? parseEnv(readFileSync(file, "utf8")) : {};
for (const name of ["OPENROUTER_API_KEY", "OPENROUTER_APP_NAME", "OPENROUTER_SITE_URL", "SPECTRA_EMBEDDING_MODEL", "SPECTRA_EMBEDDING_PROVIDER"]) {
  const value = values[name];
  if (value) process.env[name] = value;
}
if (process.env.SEMANTIC_EVAL_MODEL) {
  process.env.SPECTRA_EMBEDDING_MODEL = process.env.SEMANTIC_EVAL_MODEL;
  process.env.SPECTRA_EMBEDDING_PROVIDER = process.env.SEMANTIC_EVAL_PROVIDER ?? "";
}
process.env.SEMANTIC_EVAL_ENV_SOURCE = file ? path.basename(path.dirname(file)) + "/" + path.basename(file) : "none";
