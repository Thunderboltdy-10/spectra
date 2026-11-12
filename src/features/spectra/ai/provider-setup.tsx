"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { bridgePlatform, type BridgePlatform } from "../bridge/client";
import { bridgeUnavailableReason, useBridgeAvailability } from "../bridge/availability";
import { PROVIDER_LABEL, useAgentRuntime, type AgentProviderStatus } from "./use-agent-runtime";

/*
 * Getting Codex or Claude Code onto this computer, for someone who pays for
 * ChatGPT or Claude. Bridge opens a terminal that runs the official installer
 * and then the CLI's own log-in; where it can't, the person gets the commands.
 */

type Provider = keyof typeof PROVIDER_LABEL;
type SetupAction = "install" | "login";
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

async function requestSetup(provider: Provider, action: SetupAction): Promise<SetupResult> {
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
export async function startProviderSetup(provider: Provider, action: SetupAction, options: { inline?: boolean } = {}): Promise<SetupResult> {
  const name = PROVIDER_LABEL[provider];
  const platform = bridgePlatform();
  const result = await requestSetup(provider, action);
  if (result.opened) {
    toast.success(`A ${terminalName(platform)} window opened`, {
      description: `${action === "install" ? `It installs ${name}, then` : "It"} opens ${name}'s log-in. Finish there and come back: Spectra checks again by itself.`,
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

/** The button for one provider: Install or Log in, with what to do by hand when Bridge can't. */
export function ProviderSetupButton({ provider, state, size = "sm" }: { provider: Provider; state: AgentProviderStatus["state"] | undefined; size?: "sm" | "md" }) {
  const action = setupActionFor(state);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<{ reason: string; commands: string } | null>(null);
  const [platform, setPlatform] = useState<BridgePlatform>("other");
  // Read after mount: the server cannot tell which computer this is.
  useEffect(() => setPlatform(bridgePlatform()), []);
  if (!action) return null;
  const run = async () => {
    setBusy(true);
    const result = await startProviderSetup(provider, action, { inline: true });
    setBusy(false);
    setManual(result.opened ? null : { reason: REASON[result.reason], commands: setupCommands(provider, action, platform).join("\n") });
  };
  return (
    <div className="grid max-w-[22rem] justify-items-start gap-2">
      <Button size={size} variant="secondary" disabled={busy} onClick={() => void run()}>
        {busy ? "Opening…" : action === "install" ? `Install ${PROVIDER_LABEL[provider]}` : "Log in"}
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

function providerLine(entry: AgentProviderStatus | undefined) {
  if (!entry) return "Checking this computer…";
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
  const { status, recheck } = useAgentRuntime();
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
              <div className="text-micro text-[var(--text-secondary)]">{providerLine(entry)}</div>
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
        <button type="button" className="mt-3 text-micro text-[var(--text-tertiary)] underline-offset-2 hover:underline" onClick={() => void recheck()}>
          Check again
        </button>
      )}
    </section>
  );
}
