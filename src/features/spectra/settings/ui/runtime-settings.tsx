"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { PROVIDER_LABEL, providerProblem, useAgentRuntime } from "../../ai/use-agent-runtime";
import { bridgeUnavailableReason, useBridgeAvailability } from "../../bridge/availability";
import { DEVICES_HREF } from "../../bridge/client";
import { useSpectraPreferences } from "../preference-store";
import type { SpectraPreferences } from "../schema";

type Ai = SpectraPreferences["ai"];

const SPEED_OPTIONS = [
  { value: "fast", label: "Fast" },
  { value: "medium", label: "Medium" },
  { value: "slow", label: "Slow" },
];

/** BridgeConnection tells this computer's Bridge about the choice, now or when it next opens. */
export function applyRuntimeChoice(runtime: Ai["runtime"], update: (patch: Partial<Ai>) => void) {
  update({ runtime, runtimeChosen: true });
}

function Row({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div className="flex min-h-[68px] items-center gap-4 rounded-card px-3.5 py-3 transition-colors hover:bg-[var(--bg-secondary)] sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-[var(--text-primary)]">{label}</div>
        {description ? <div className="mt-0.5 max-w-2xl text-micro leading-[18px] text-[var(--text-secondary)]">{description}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Group({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-5 @min-[860px]/settings:grid-cols-[220px_minmax(0,1fr)] @min-[860px]/settings:gap-10">
      <header className="pt-2">
        <h2 className="font-display text-heading font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-1 max-w-2xl text-caption leading-5 text-[var(--text-secondary)]">{description}</p>
      </header>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function ProviderRow({ provider, model, onModel }: {
  provider: "codex" | "claude";
  model: string;
  onModel: (model: string) => void;
}) {
  const { status } = useAgentRuntime();
  const unavailable = bridgeUnavailableReason(useBridgeAvailability());
  const entry = status?.[provider];
  const name = PROVIDER_LABEL[provider];
  if (unavailable) {
    return (
      <Row
        label={name}
        description={unavailable}
        control={<Button size="sm" variant="secondary" asChild><Link href={DEVICES_HREF}>Go to Devices</Link></Button>}
      />
    );
  }
  if (!entry) return <Row label={name} description="Checking this computer…" control={null} />;
  if (entry.state !== "ready") {
    return <Row label={name} description={providerProblem(provider, entry.state) ?? undefined} control={null} />;
  }
  const who = [entry.account, entry.plan].filter(Boolean).join(", ");
  return (
    <Row
      label={name}
      description={who ? `Logged in as ${who}` : "Logged in"}
      control={
        <SelectField
          ariaLabel={`${name} model`}
          value={model}
          onChange={onModel}
          options={[{ value: "", label: `${provider === "claude" ? "Claude" : "Codex"} default` }, ...entry.models.map((item) => ({ value: item.id, label: item.label }))]}
        />
      }
    />
  );
}

export function RuntimeSettings() {
  const { preferences, update } = useSpectraPreferences();
  const { recheck } = useAgentRuntime();
  const ownAgentOff = Boolean(bridgeUnavailableReason(useBridgeAvailability()));
  const ai = preferences.ai;
  const patch = (next: Partial<Ai>) => update("ai", next);
  return (
    <div className="space-y-10">
      <Group
        title="Who runs your work"
        description="Use your own Codex or Claude Code subscription through Spectra Bridge. Spectra's tools and instructions stay the same. If your subscription can't answer, Spectra's model takes over, and work that runs on a schedule always uses Spectra's."
      >
        <Row
          label="Default"
          control={
            <SelectField
              ariaLabel="Default AI"
              value={ai.runtime}
              onChange={(runtime) => applyRuntimeChoice(runtime as Ai["runtime"], patch)}
              options={[
                { value: "codex", label: "Codex", disabled: ownAgentOff },
                { value: "claude", label: "Claude Code", disabled: ownAgentOff },
                { value: "spectra", label: "Spectra default" },
              ]}
            />
          }
        />
        <ProviderRow provider="codex" model={ai.codexModel} onModel={(codexModel) => patch({ codexModel })} />
        <ProviderRow provider="claude" model={ai.claudeModel} onModel={(claudeModel) => patch({ claudeModel })} />
        <Row label="Logged in just now?" description="Spectra checks again whenever you come back to this window." control={<Button size="sm" variant="secondary" onClick={() => void recheck()}>Check again</Button>} />
      </Group>
      <Group title="Thinking and speed" description="How hard the model thinks, and how quickly its work plays on your screen. Edits are saved at the same moment at any speed.">
        <Row label="Thinking" control={<SelectField ariaLabel="Thinking" value={ai.thinking} onChange={(thinking) => patch({ thinking: thinking as Ai["thinking"] })} options={[{ value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />} />
        <Row label="Work speed" description="Fast shows the work as it arrives." control={<SelectField ariaLabel="Work speed" value={ai.workSpeed} onChange={(workSpeed) => patch({ workSpeed: workSpeed as Ai["workSpeed"] })} options={SPEED_OPTIONS} />} />
        <Row label="Speed while following" description="Used while Follow AI moves you to what it's working on." control={<SelectField ariaLabel="Speed while following" value={ai.followSpeed} onChange={(followSpeed) => patch({ followSpeed: followSpeed as Ai["followSpeed"] })} options={SPEED_OPTIONS} />} />
      </Group>
    </div>
  );
}
