import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..", "..", "..", "..");
const numericUsageFields = Object.freeze([
  "databaseIoReadBytes",
  "databaseIoWriteBytes",
  "databaseReadDocuments",
  "databaseWriteDocuments",
  "storageReadBytes",
  "storageWriteBytes",
  "vectorIndexReadBytes",
  "vectorIndexWriteBytes",
  "textIndexQueryBytes",
  "textIndexWriteQueryBytes",
  "vectorIndexReadQueryBytes",
  "vectorIndexWriteQueryBytes",
  "networkEgressBytes",
]);
const usageAliases = Object.freeze({
  databaseIoReadBytes: "databaseReadBytes",
  databaseIoWriteBytes: "databaseWriteBytes",
});

export const profileBudgets = Object.freeze({
  idle: {
    perMinuteNonCronExecutions: 5,
    perMinuteNonCronDatabaseIoBytes: 250_000,
    perMinuteNonCronEgressBytes: 250_000,
  },
  collaboration: {
    perMinuteNonCronExecutions: 8,
    perMinuteBridgeExchanges: 2,
    perMinuteNonCronDatabaseIoBytes: 500_000,
    perMinuteNonCronEgressBytes: 64_000,
  },
  action: { maxNonCronDatabaseIoBytes: 1_000_000 },
  scheduled: {
    maxCronReadDocumentsPerExecution: 100,
    maxCronDatabaseIoBytesPerExecution: 128_000,
  },
});

export function parseCompletionLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith("{")) return null;
  let value;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (value.kind !== "Completion" || typeof value.identifier !== "string")
    return null;
  const usageStats = value.usageStats ?? {};
  const usage = {};
  for (const field of numericUsageFields) {
    const alias = usageAliases[field];
    usage[field] =
      Number(usageStats[field] ?? (alias ? usageStats[alias] : 0) ?? 0) || 0;
  }
  return {
    identifier: value.identifier,
    caller: String(value.caller ?? "unknown"),
    udfType: String(value.udfType ?? "unknown"),
    timestamp: Number(value.timestamp ?? value.executionTimestamp ?? 0),
    cachedResult: Boolean(value.cachedResult),
    executionTime: Number(value.executionTime ?? 0) || 0,
    returnBytes: Number(value.returnBytes ?? 0) || 0,
    memoryUsedMb: Number(usageStats.memoryUsedMb ?? 0) || 0,
    usage,
  };
}

function blankAggregate(identifier, caller) {
  return {
    identifier,
    caller,
    executions: 0,
    cachedExecutions: 0,
    executionTime: 0,
    returnBytes: 0,
    peakMemoryUsedMb: 0,
    usage: Object.fromEntries(numericUsageFields.map((field) => [field, 0])),
    maxima: {
      databaseIoBytes: 0,
      databaseReadDocuments: 0,
      networkEgressBytes: 0,
      returnBytes: 0,
    },
  };
}

export function aggregateCompletions(events, { seconds, profile }) {
  const groups = new Map();
  for (const event of events) {
    const key = `${event.caller}\u0000${event.identifier}`;
    const aggregate =
      groups.get(key) ?? blankAggregate(event.identifier, event.caller);
    aggregate.executions += 1;
    aggregate.cachedExecutions += event.cachedResult ? 1 : 0;
    aggregate.executionTime += event.executionTime;
    aggregate.returnBytes += event.returnBytes;
    aggregate.peakMemoryUsedMb = Math.max(
      aggregate.peakMemoryUsedMb,
      event.memoryUsedMb,
    );
    for (const field of numericUsageFields)
      aggregate.usage[field] += event.usage[field];
    const ioBytes =
      event.usage.databaseIoReadBytes + event.usage.databaseIoWriteBytes;
    aggregate.maxima.databaseIoBytes = Math.max(
      aggregate.maxima.databaseIoBytes,
      ioBytes,
    );
    aggregate.maxima.databaseReadDocuments = Math.max(
      aggregate.maxima.databaseReadDocuments,
      event.usage.databaseReadDocuments,
    );
    aggregate.maxima.networkEgressBytes = Math.max(
      aggregate.maxima.networkEgressBytes,
      event.usage.networkEgressBytes,
    );
    aggregate.maxima.returnBytes = Math.max(
      aggregate.maxima.returnBytes,
      event.returnBytes,
    );
    groups.set(key, aggregate);
  }
  const byFunction = [...groups.values()].sort(
    (left, right) =>
      right.usage.databaseIoReadBytes +
      right.usage.databaseIoWriteBytes -
      left.usage.databaseIoReadBytes -
      left.usage.databaseIoWriteBytes,
  );
  const nonCron = events.filter(
    (event) => event.caller.toLowerCase() !== "cron",
  );
  const minutes = Math.max(seconds / 60, 1 / 60);
  const totals = {
    executions: events.length,
    nonCronExecutions: nonCron.length,
    nonCronDatabaseIoBytes: nonCron.reduce(
      (sum, event) =>
        sum +
        event.usage.databaseIoReadBytes +
        event.usage.databaseIoWriteBytes,
      0,
    ),
    nonCronEgressBytes: nonCron.reduce(
      (sum, event) => sum + event.usage.networkEgressBytes,
      0,
    ),
    bridgeExchanges: nonCron.filter(
      (event) => event.identifier === "collaborationGatewayBridge:exchange",
    ).length,
  };
  const rates = {
    nonCronExecutionsPerMinute: totals.nonCronExecutions / minutes,
    nonCronDatabaseIoBytesPerMinute: totals.nonCronDatabaseIoBytes / minutes,
    nonCronEgressBytesPerMinute: totals.nonCronEgressBytes / minutes,
    bridgeExchangesPerMinute: totals.bridgeExchanges / minutes,
  };
  return { profile, seconds, totals, rates, byFunction };
}

export function evaluateBudget(report) {
  const budget = profileBudgets[report.profile];
  if (!budget) throw new Error(`Unknown profile ${report.profile}.`);
  const failures = [];
  const check = (actual, limit, label) => {
    if (limit !== undefined && actual > limit)
      failures.push({ label, actual, limit });
  };
  check(
    report.rates.nonCronExecutionsPerMinute,
    budget.perMinuteNonCronExecutions,
    "non-cron executions/min",
  );
  check(
    report.rates.bridgeExchangesPerMinute,
    budget.perMinuteBridgeExchanges,
    "Bridge exchanges/min",
  );
  check(
    report.rates.nonCronDatabaseIoBytesPerMinute,
    budget.perMinuteNonCronDatabaseIoBytes,
    "non-cron database I/O bytes/min",
  );
  check(
    report.rates.nonCronEgressBytesPerMinute,
    budget.perMinuteNonCronEgressBytes,
    "non-cron egress bytes/min",
  );
  check(
    report.totals.nonCronDatabaseIoBytes,
    budget.maxNonCronDatabaseIoBytes,
    "action non-cron database I/O bytes",
  );
  if (report.profile === "scheduled") {
    for (const row of report.byFunction.filter(
      (item) => item.caller.toLowerCase() === "cron",
    )) {
      check(
        row.maxima.databaseReadDocuments,
        budget.maxCronReadDocumentsPerExecution,
        `${row.identifier} documents/execution`,
      );
      check(
        row.maxima.databaseIoBytes,
        budget.maxCronDatabaseIoBytesPerExecution,
        `${row.identifier} database I/O bytes/execution`,
      );
    }
  }
  return { passed: failures.length === 0, failures };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--"))
      throw new Error(`Unexpected argument ${token}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${token}.`);
    values[token.slice(2)] = value;
    index += 1;
  }
  return values;
}

async function capture({ instance, profile, seconds, label }) {
  const instanceRoot = resolve(
    repositoryRoot,
    ".spectra-local",
    "instances",
    String(instance),
  );
  const projectRoot = resolve(instanceRoot, "project");
  const projectEnv = resolve(projectRoot, ".env.local");
  if (!existsSync(projectEnv))
    throw new Error(`Instance ${instance} has no local Convex selector.`);
  const convexCli = resolve(
    repositoryRoot,
    "node_modules",
    "convex",
    "bin",
    "main.js",
  );
  const startedAtSeconds = Date.now() / 1000;
  const events = [];
  const child = spawn(
    process.execPath,
    [
      convexCli,
      "logs",
      "--deployment",
      "local",
      "--history",
      "1",
      "--success",
      "--jsonl",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: "900" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let buffer = "";
  const consume = (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseCompletionLine(line);
      if (event && event.timestamp >= startedAtSeconds) events.push(event);
    }
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", () => {});
  await new Promise((resolveWait, rejectWait) => {
    const timer = setTimeout(() => {
      child.kill("SIGINT");
      resolveWait();
    }, seconds * 1000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectWait(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
  if (buffer) consume("\n");
  const report = aggregateCompletions(events, { seconds, profile });
  const budget = evaluateBudget(report);
  const output = {
    schemaVersion: 1,
    unit: "P8.V1",
    instance,
    label,
    capturedAt: new Date().toISOString(),
    privacy: "Usage metadata only; arguments and log lines discarded.",
    ...report,
    budget,
  };
  const outputRoot = resolve(
    repositoryRoot,
    ".shots",
    "reformation",
    "P8.V1",
    "cost",
  );
  await mkdir(outputRoot, { recursive: true });
  const outputPath = resolve(outputRoot, `${label}.json`);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({ outputPath, events: events.length, budget }, null, 2)}\n`,
  );
  if (!budget.passed) process.exitCode = 1;
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const instance = Number(values.instance ?? 1);
  const seconds = Number(values.seconds ?? 300);
  const profile = values.profile ?? "idle";
  const label = String(values.label ?? profile).trim();
  if (!Number.isInteger(instance) || instance < 1)
    throw new Error("--instance must be a positive integer.");
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 21_600)
    throw new Error("--seconds must be between 1 and 21600.");
  if (!profileBudgets[profile])
    throw new Error(
      `--profile must be one of ${Object.keys(profileBudgets).join(", ")}.`,
    );
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(label))
    throw new Error("--label must be a safe filename segment.");
  await capture({ instance, profile, seconds, label });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
