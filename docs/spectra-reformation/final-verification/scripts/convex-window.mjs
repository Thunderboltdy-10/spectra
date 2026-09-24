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

// Absent telemetry is not evidence of zero cost. In particular, local backend
// versions differ in the usage fields included in successful function logs.
function observedNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function sumObserved(values) {
  return values.some((value) => value === null)
    ? null
    : values.reduce((sum, value) => sum + value, 0);
}

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
    usage[field] = observedNumber(usageStats[field] ?? (alias ? usageStats[alias] : undefined));
  }
  return {
    identifier: value.identifier,
    caller: String(value.caller ?? "unknown"),
    udfType: String(value.udfType ?? "unknown"),
    timestamp: Number(value.timestamp ?? value.executionTimestamp ?? 0),
    cachedResult: Boolean(value.cachedResult),
    executionTime: observedNumber(value.executionTime),
    returnBytes: observedNumber(value.returnBytes),
    memoryUsedMb: observedNumber(usageStats.memoryUsedMb),
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

export function aggregateCompletions(events, { seconds, profile, capture = null }) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("A positive observation duration is required.");
  const groups = new Map();
  for (const event of events) {
    const key = `${event.caller}\u0000${event.identifier}`;
    const aggregate =
      groups.get(key) ?? blankAggregate(event.identifier, event.caller);
    aggregate.executions += 1;
    aggregate.cachedExecutions += event.cachedResult ? 1 : 0;
    aggregate.executionTime = sumObserved([aggregate.executionTime, event.executionTime]);
    aggregate.returnBytes = sumObserved([aggregate.returnBytes, event.returnBytes]);
    aggregate.peakMemoryUsedMb = aggregate.peakMemoryUsedMb === null || event.memoryUsedMb === null
      ? null : Math.max(aggregate.peakMemoryUsedMb, event.memoryUsedMb);
    for (const field of numericUsageFields)
      aggregate.usage[field] = sumObserved([aggregate.usage[field], event.usage[field]]);
    const maxima = {
      databaseIoBytes: sumObserved([event.usage.databaseIoReadBytes, event.usage.databaseIoWriteBytes]),
      databaseReadDocuments: event.usage.databaseReadDocuments,
      networkEgressBytes: event.usage.networkEgressBytes,
      returnBytes: event.returnBytes,
    };
    for (const [field, value] of Object.entries(maxima))
      aggregate.maxima[field] = aggregate.maxima[field] === null || value === null
        ? null : Math.max(aggregate.maxima[field], value);
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
    nonCronDatabaseIoBytes: sumObserved(nonCron.flatMap((event) => [event.usage.databaseIoReadBytes, event.usage.databaseIoWriteBytes])),
    nonCronEgressBytes: sumObserved(nonCron.map((event) => event.usage.networkEgressBytes)),
    bridgeExchanges: nonCron.filter(
      (event) => event.identifier === "collaborationGatewayBridge:exchange",
    ).length,
  };
  const rates = {
    nonCronExecutionsPerMinute: totals.nonCronExecutions / minutes,
    nonCronDatabaseIoBytesPerMinute: totals.nonCronDatabaseIoBytes === null ? null : totals.nonCronDatabaseIoBytes / minutes,
    nonCronEgressBytesPerMinute: totals.nonCronEgressBytes === null ? null : totals.nonCronEgressBytes / minutes,
    bridgeExchangesPerMinute: totals.bridgeExchanges / minutes,
  };
  return { profile, seconds, totals, rates, byFunction, capture,
    coverage: Object.fromEntries(numericUsageFields.map((field) => [field, {
      observedEvents: events.filter((event) => event.usage[field] !== null).length,
      totalEvents: events.length,
    }])) };
}

export function evaluateBudget(report) {
  const budget = profileBudgets[report.profile];
  if (!budget) throw new Error(`Unknown profile ${report.profile}.`);
  const failures = [];
  const unobserved = [];
  const check = (actual, limit, label) => {
    if (limit !== undefined && (actual === null || !Number.isFinite(actual))) {
      unobserved.push(label);
      return;
    }
    if (limit !== undefined && actual > limit)
      failures.push({ label, actual, limit });
  };
  if (!report.totals.executions) unobserved.push("no completion events observed");
  if (report.capture && !report.capture.complete) unobserved.push("capture ended before requested duration");
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
    if (!report.byFunction.some((item) => item.caller.toLowerCase() === "cron"))
      unobserved.push("no scheduled executions observed");
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
  return { passed: failures.length === 0 && unobserved.length === 0,
    status: failures.length ? "failed" : unobserved.length ? "unobserved" : "passed", failures, unobserved };
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
  let durationReached = false;
  let exitCode = null;
  await new Promise((resolveWait, rejectWait) => {
    const timer = setTimeout(() => {
      durationReached = true;
      child.kill("SIGINT");
    }, seconds * 1000);
    const killTimer = setTimeout(() => child.kill("SIGKILL"), seconds * 1000 + 5000);
    child.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      rejectWait(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      exitCode = code;
      resolveWait();
    });
  });
  if (buffer) consume("\n");
  const endedAtSeconds = Date.now() / 1000;
  const observedSeconds = Math.min(seconds, endedAtSeconds - startedAtSeconds);
  const report = aggregateCompletions(events.filter((event) => event.timestamp <= startedAtSeconds + observedSeconds), {
    seconds: Math.max(observedSeconds, 0.001), profile,
    capture: { complete: durationReached, requestedSeconds: seconds, observedSeconds, exitCode,
      startedAt: new Date(startedAtSeconds * 1000).toISOString(), endedAt: new Date(endedAtSeconds * 1000).toISOString() },
  });
  const budget = evaluateBudget(report);
  const output = {
    schemaVersion: 2,
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
