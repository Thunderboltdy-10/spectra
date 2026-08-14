import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const ignored = /(?:^|\/)(?:node_modules|\.next|\.shots|coverage)(?:\/|$)|(?:package-lock|pnpm-lock|yarn\.lock)$/i;
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["OpenAI-style token", /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g],
  ["workspace token", /\bwk-[A-Za-z0-9_.-]{20,}\b/g],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{20,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
];

const findings = [];
for (const file of tracked) {
  if (ignored.test(file)) continue;
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0") || source.length > 2_000_000) continue;
  for (const [label, expression] of patterns) {
    expression.lastIndex = 0;
    for (const match of source.matchAll(expression)) {
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line} (${label})`);
    }
  }
}

if (findings.length) {
  console.error(`Secret scan failed with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed across ${tracked.length} tracked files.`);
