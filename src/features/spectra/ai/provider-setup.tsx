"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { WorkingMark } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { bridgePlatform, type BridgePlatform } from "../bridge/client";
import { bridgeUnavailableReason, useBridgeAvailability } from "../bridge/availability";
import { PROVIDER_LABEL, agentRuntimeNow, recheckAgentRuntime, useAgentRuntime, type AgentProviderStatus } from "./use-agent-runtime";

/*
 * Getting Codex or Claude Code onto this computer, for someone who pays for
 * ChatGPT or Claude. Bridge opens a terminal that runs the official installer
 * and then the CLI's own log-in; where it can't, the person gets the commands.
 */

type Provider = keyof typeof PROVIDER_LABEL;
type SetupAction = "install" | "login";
type RequestAction = SetupAction | "install-quiet";
type SetupResult = { opened: true } | { opened: false; reason: "unsupported" | "update-bridge" | "no-bridge" | "failed" };

/** The same official commands Bridge runs, for doing it by hand. */
const COMMANDS: Record<Provider, Record<"windows" | "macos", { install: string; login: string }>> = {
  claude: {
    windows: { install: "irm https://claude.ai/install.ps1 | iex", login: "claude auth login" },
    macos: { install: "curl -fsSL https://claude.ai/install.sh | bash", login: "claude auth login" },
  },
  codex: {
    windows: { install: "irm https://chatgpt.com/codex/install.ps1 | iex", login: "codex login" },
    macos: { install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", login: "codex login" },
  },
};

export function setupCommands(provider: Provider, action: SetupAction, platform: BridgePlatform) {
  const commands = COMMANDS[provider][platform === "windows" ? "windows" : "macos"];
  return action === "login" ? [commands.login] : [commands.install, commands.login];
}

const terminalName = (platform: BridgePlatform) => (platform === "windows" ? "PowerShell" : "Terminal");

/** What a state needs: an install, a log-in, or nothing Spectra can do from here. */
export function setupActionFor(state: AgentProviderStatus["state"] | undefined): SetupAction | null {
  return state === "not-installed" ? "install" : state === "signed-out" ? "login" : null;
}

const REASON: Record<Exclude<SetupResult, { opened: true }>["reason"], string> = {
  unsupported: "Spectra can't open a terminal on this computer.",
  "update-bridge": "Update Spectra Bridge to do this in one click.",
  "no-bridge": "Spectra Bridge isn't running on this computer.",
  failed: "The terminal didn't open.",
};

async function requestSetup(provider: Provider, action: RequestAction): Promise<SetupResult> {
  try {
    const response = await fetch("/api/spectra/agent-runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ setup: provider, action }),
    });
    const result = response.ok ? ((await response.json()) as Partial<SetupResult> | null) : null;
    if (result?.opened === true) return { opened: true };
    const reason = result && "reason" in result && result.reason && result.reason in REASON ? result.reason : "failed";
    return { opened: false, reason };
  } catch {
    return { opened: false, reason: "failed" };
  }
}

/**
 * Ask Bridge to open the terminal, and say what happened. From a menu, which closes on click, a
 * failure is told in a toast; a button shows it beside itself instead (`inline`).
 */
export async function startProviderSetup(
  provider: Provider,
  action: SetupAction,
  options: { inline?: boolean; quietStart?: boolean } = {},
): Promise<SetupResult> {
  const name = PROVIDER_LABEL[provider];
  const platform = bridgePlatform();
  const result = await requestSetup(provider, action);
  if (result.opened) {
    toast.success(options.quietStart ? `${name} is installed. Log in to finish` : `A ${terminalName(platform)} window opened`, {
      description: options.quietStart
        ? `${name}'s log-in opens in your browser (a small ${terminalName(platform)} window shows it too). Finish there and come back: Spectra checks again by itself.`
        : `${action === "install" ? `It installs ${name}, then` : "It"} opens ${name}'s log-in. Finish there and come back: Spectra checks again by itself.`,
      duration: 12_000,
    });
  } else if (!options.inline) {
    const commands = setupCommands(provider, action, platform).join("\n");
    toast.warning(REASON[result.reason], {
      description: (
        <span className="whitespace-pre-line">
          {`Open ${terminalName(platform)} and run:\n`}
          <span className="font-mono">{commands}</span>
        </span>
      ),
      duration: Infinity,
      closeButton: true,
      action: {
        label: "Copy",
        onClick: (event) => {
          event.preventDefault();
          void navigator.clipboard?.writeText(commands).then(() => toast.success("Copied"));
        },
      },
    });
  }
  return result;
}

/*
 * Installing with no terminal: Bridge runs the official installer out of
 * sight, Spectra looks every few seconds until the CLI is there, then starts
 * its log-in, which opens the browser. Shared by every place with the button.
 */
const INSTALL_LOOK_MS = 4_000;
const INSTALL_GIVE_UP_MS = 5 * 60_000;
const installing = new Set<Provider>();
const installListeners = new Set<() => void>();
const notifyInstalls = () => installListeners.forEach((listener) => listener());
const subscribeInstalls = (listener: () => void) => {
  installListeners.add(listener);
  return () => void installListeners.delete(listener);
};

export function useInstalling(provider: Provider) {
  return useSyncExternalStore(subscribeInstalls, () => installing.has(provider), () => false);
}

/** Install, then log in, without a terminal; falls back to the terminal where Bridge can't. */
export async function installProvider(provider: Provider, options: { inline?: boolean } = {}): Promise<SetupResult> {
  if (installing.has(provider)) return { opened: true };
  const name = PROVIDER_LABEL[provider];
  const quiet = await requestSetup(provider, "install-quiet");
  // An older Bridge doesn't know the quiet install: the terminal does it instead.
  if (!quiet.opened) return startProviderSetup(provider, "install", options);
  installing.add(provider);
  notifyInstalls();
  const started = Date.now();
  try {
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, INSTALL_LOOK_MS));
      await recheckAgentRuntime();
      const state = agentRuntimeNow()?.[provider]?.state ?? "error";
      if (state === "ready") {
        toast.success(`${name} is ready`, { description: "Spectra can run on your subscription now." });
        return { opened: true };
      }
      if (state === "signed-out") {
        await startProviderSetup(provider, "login", { ...options, quietStart: true });
        return { opened: true };
      }
      if (Date.now() - started > INSTALL_GIVE_UP_MS) {
        toast.warning(`${name} didn't finish installing`, { description: "Try again, or install it from a terminal." });
        return startProviderSetup(provider, "install", options);
      }
    }
  } finally {
    installing.delete(provider);
    notifyInstalls();
  }
}

/** The button for one provider: Install or Log in, with what to do by hand when Bridge can't. */
export function ProviderSetupButton({ provider, state, size = "sm" }: { provider: Provider; state: AgentProviderStatus["state"] | undefined; size?: "sm" | "md" }) {
  const action = setupActionFor(state);
  const installingNow = useInstalling(provider);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<{ reason: string; commands: string } | null>(null);
  const [platform, setPlatform] = useState<BridgePlatform>("other");
  // Read after mount: the server cannot tell which computer this is.
  useEffect(() => setPlatform(bridgePlatform()), []);
  if (!action) return null;
  const run = async () => {
    setBusy(true);
    const result = action === "install" ? await installProvider(provider, { inline: true }) : await startProviderSetup(provider, action, { inline: true });
    setBusy(false);
    setManual(result.opened ? null : { reason: REASON[result.reason], commands: setupCommands(provider, action, platform).join("\n") });
  };
  return (
    <div className="grid max-w-[22rem] justify-items-start gap-2">
      <Button size={size} variant="secondary" disabled={busy || installingNow} onClick={() => void run()}>
        {installingNow ? (
          <>
            <WorkingMark />
            Installing…
          </>
        ) : busy ? (
          "Opening…"
        ) : action === "install" ? (
          `Install ${PROVIDER_LABEL[provider]}`
        ) : (
          "Log in"
        )}
      </Button>
      {manual ? (
        <div className="grid gap-1 text-micro text-[var(--text-secondary)]">
          <span>
            {manual.reason} Run this in {terminalName(platform)} instead, then come back:
          </span>
          <pre className="select-all whitespace-pre-wrap break-all rounded-control bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-[var(--text-primary)]">{manual.commands}</pre>
          <button
            type="button"
            className="justify-self-start underline-offset-2 hover:underline"
            onClick={() => void navigator.clipboard?.writeText(manual.commands).then(() => toast.success("Copied"))}
          >
            Copy
          </button>
        </div>
      ) : null}
    </div>
  );
}

function providerLine(entry: AgentProviderStatus | undefined, checking = false) {
  if (!entry || (checking && entry.state !== "ready")) return "Checking this computer…";
  if (entry.state === "ready") {
    const plan = entry.plan ? ` (${entry.plan.charAt(0).toUpperCase()}${entry.plan.slice(1)})` : "";
    return entry.account ? `Logged in as ${entry.account}${plan}` : "Ready";
  }
  if (entry.state === "not-installed") return "Not installed";
  if (entry.state === "signed-out") return "Installed, not logged in";
  if (entry.state === "no-bridge") return "Needs Spectra Bridge";
  return "Didn't answer. Try again in a moment.";
}

/**
 * Codex and Claude Code on this computer, each with the step it still needs.
 * Devices shows it, and the tour asks it right after Bridge.
 */
export function SubscriptionSetup({ compact = false }: { compact?: boolean }) {
  const { status, checking, recheck } = useAgentRuntime();
  const unavailable = bridgeUnavailableReason(useBridgeAvailability());
  const body = unavailable ? (
    <p className="text-caption leading-5 text-[var(--text-secondary)]">Set up Spectra Bridge first: Codex and Claude Code run through it.</p>
  ) : (
    <ul className="grid gap-3">
      {(["codex", "claude"] as const).map((provider) => {
        const entry = status?.[provider];
        return (
          <li key={provider} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="text-ui font-medium text-[var(--text-primary)]">
                {PROVIDER_LABEL[provider]}
              </div>
              <div className="text-micro text-[var(--text-secondary)]">{providerLine(entry, checking)}</div>
            </div>
            <ProviderSetupButton provider={provider} state={entry?.state} />
          </li>
        );
      })}
    </ul>
  );
  if (compact) return body;
  return (
    <section aria-labelledby="ai-subscriptions" className="device-slip" data-ai-subscriptions>
      <h2 id="ai-subscriptions" className="device-slip-heading">
        Your AI subscription
      </h2>
      <p className="device-slip-about">
        Pay for ChatGPT or Claude? Spectra can run on it through Codex or Claude Code, with the same tools, instead of its own model.
      </p>
      <div className="mt-4">{body}</div>
      {unavailable ? null : (
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1.5 text-micro text-[var(--text-tertiary)] underline-offset-2 enabled:hover:underline disabled:cursor-default"
          disabled={checking}
          aria-busy={checking}
          onClick={() => void recheck()}
        >
          {checking ? <WorkingMark /> : null}
          {checking ? "Checking…" : "Check again"}
        </button>
      )}
    </section>
  );
}
