"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { TimeField } from "@/components/ui/when-fields";
import { FeedbackButton } from "@/components/layout/feedback-button";
import { useTheme } from "@/components/theme-provider";
import { SCHOOL_SYNC_KIND_INFO, type SchoolSyncKind, type SchoolSyncMode } from "../../../../shared/school-sync";
import { ClassShelfChoice } from "../components/class-shelf-onboarding";
import { useSpectraPreferences } from "../settings/preference-store";
import { useSpectraRouter } from "../hooks/use-spectra-router";
import { HOME_PATH } from "../chat/home-routes";
import { spectraBus } from "../events";
import { useBridgeAvailability } from "../bridge/availability";
import { bridgePlatform, setBridgeRemovedHere, type BridgePlatform } from "../bridge/client";
import { NETWORK_PERMISSION_FIX, useNetworkPermission } from "../bridge/network-permission";
import { PairingPanel } from "../devices/pairing-panel";
import { devicePairing } from "../devices/pairing";
import { BridgeInstallSteps } from "../devices/bridge-install-steps";
import { WorkHomeChoice } from "../devices/work-home-choice";
import { SubscriptionSetup } from "../ai/provider-setup";
import { useAgentRuntime } from "../ai/use-agent-runtime";
import { MODE_LABEL } from "../school/school-model";
import { life } from "../life/life";
import { useIslandShowcase } from "../island/phone-rest";
import { setupDue } from "./setup-state";

/*
 * Setup: what a new account does once, before the app. A step at a time, in
 * the order the choices depend on each other: the year's classes, Spectra
 * Bridge on this computer, where artifacts are kept and an AI subscription
 * (both only once Bridge is here), the island and the few settings worth
 * choosing on day one, then what keeps coming in from ManageBac. Each step
 * says how far along it is; a step that needs nothing from this person is
 * not shown. It cannot be put away, only answered (some answers are "not
 * now"), and it carries on where it was, on any computer. The tour follows.
 */

type StepId = "classes" | "bridge" | "storage" | "subscriptions" | "island" | "syncs";

const STEP_NAME: Record<StepId, string> = {
  classes: "Classes",
  bridge: "Spectra Bridge",
  storage: "Your artifacts",
  subscriptions: "AI subscription",
  island: "The island",
  syncs: "ManageBac",
};

/** The spectrum the progress line fills with, a hue for each step done. */
const STEP_HUES = ["--hue-red", "--hue-orange", "--hue-yellow", "--hue-green", "--hue-blue", "--hue-violet"];

const noop = () => () => {};
/** The platform after mount: the server cannot tell which computer this is. */
function usePlatform(): BridgePlatform | null {
  return useSyncExternalStore(noop, () => bridgePlatform(), () => null);
}

export function SetupMount() {
  const { isAuthenticated } = useConvexAuth();
  const { preferences, accountReady } = useSpectraPreferences();
  if (!isAuthenticated || !accountReady || !setupDue(preferences.integrations)) return null;
  return <Setup />;
}

function Setup() {
  const router = useSpectraRouter();
  const { preferences, update } = useSpectraPreferences();
  const school = useQuery(api.managebac.onboardingStatus, {});
  const availability = useBridgeAvailability();
  const platform = usePlatform();
  const phase = school?.phase;
  const schoolConnected = phase !== undefined && phase !== "no_school" && phase !== "awaiting_connection";
  const bridgeHere = availability === "ready";
  const syncs = useQuery(api.school.preferences, schoolConnected ? {} : "skip") as { kinds: SyncKindRow[] } | null | undefined;
  // Only what this school's ManageBac shares is worth asking about; with nothing to choose, the step is left out.
  const syncChoices = syncs?.kinds.filter(choosable).length ?? 0;

  const steps = useMemo(() => {
    const list: StepId[] = [];
    if (schoolConnected) list.push("classes");
    if (platform !== null && platform !== "other") list.push("bridge");
    if (bridgeHere) list.push("storage", "subscriptions");
    list.push("island");
    if (schoolConnected && syncChoices > 0) list.push("syncs");
    return list;
  }, [bridgeHere, platform, schoolConnected, syncChoices]);

  const saved = preferences.integrations.setupStep as StepId;
  const index = Math.max(0, steps.indexOf(saved));
  const step = steps[index]!;

  const go = (to: StepId) => update("integrations", { setupStep: to });
  const next = () => {
    const after = steps[index + 1];
    if (after) return go(after);
    update("integrations", { setupStatus: "done", setupStep: "" });
    spectraBus.emit("workspace.refreshRequested", {});
    router.push(HOME_PATH);
  };
  const back = index > 0 ? () => go(steps[index - 1]!) : undefined;

  // Whatever was focused in the app behind stays behind.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  if (school === undefined || platform === null || (schoolConnected && syncs === undefined))
    return <section className="spectra-setup" aria-busy="true" aria-label="Setting up Spectra" />;

  return (
    <section className="spectra-setup" data-step={step} role="dialog" aria-modal={step !== "island" || undefined} aria-labelledby="setup-heading">
      <div className="spectra-setup-sheet">
        <header className="spectra-setup-progress">
          <p className="spectra-setup-count">
            <span>Setting up Spectra</span>
            <span>
              {index + 1} of {steps.length}
            </span>
          </p>
          <ol className="spectra-setup-line" aria-label="Steps">
            {steps.map((id, at) => (
              <li
                key={id}
                data-state={at < index ? "done" : at === index ? "now" : "ahead"}
                style={{ "--setup-hue": `var(${STEP_HUES[at % STEP_HUES.length]})` } as React.CSSProperties}
                aria-current={at === index ? "step" : undefined}
              >
                <span className="sr-only">
                  {STEP_NAME[id]}
                  {at < index ? ", done" : ""}
                </span>
              </li>
            ))}
          </ol>
        </header>
        <div className="spectra-setup-body" key={step}>
          {step === "classes" ? (
            <ClassesStep phase={phase} onDone={next} onBack={back} />
          ) : step === "bridge" ? (
            <BridgeStep platform={platform} ready={bridgeHere} onDone={next} onBack={back} />
          ) : step === "storage" ? (
            <StorageStep onDone={next} onBack={back} />
          ) : step === "subscriptions" ? (
            <SubscriptionsStep onDone={next} onBack={back} />
          ) : step === "island" ? (
            <IslandStep onDone={next} onBack={back} last={index === steps.length - 1} />
          ) : (
            <SyncsStep onDone={next} onBack={back} />
          )}
        </div>
        <footer className="spectra-setup-feedback">
          <FeedbackButton collapsed={false} />
          <span>Something not right? Tell us.</span>
        </footer>
      </div>
    </section>
  );
}

function StepFrame({
  title,
  about,
  children,
  actions,
}: {
  title: string;
  about: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <h1 id="setup-heading" className="spectra-setup-heading">
        {title}
      </h1>
      <p className="spectra-setup-about">{about}</p>
      {children ? <div className="spectra-setup-content">{children}</div> : null}
      {actions ? <div className="spectra-setup-actions">{actions}</div> : null}
    </>
  );
}

function Actions({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <>
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <span className="flex flex-wrap items-center justify-end gap-2">{children}</span>
    </>
  );
}

/* ── Classes ─────────────────────────────────────────────────────────── */

function ClassesStep({ phase, onDone, onBack }: { phase: string | undefined; onDone: () => void; onBack?: () => void }) {
  const listing = phase === "loading_classes";
  return (
    <StepFrame
      title="Choose this year's classes"
      about="Each class you pick becomes a workspace in your Library, and its tasks and deadlines come in from ManageBac."
      actions={
        listing ? (
          <Actions onBack={onBack}>
            <Button variant="ghost" onClick={onDone}>
              Choose later
            </Button>
          </Actions>
        ) : onBack ? (
          <Actions onBack={onBack}>{null}</Actions>
        ) : undefined
      }
    >
      {listing ? (
        <p className="spectra-setup-waiting" role="status">
          <span aria-hidden className="spectra-setup-pulse" />
          Finding your classes in ManageBac. This takes a moment the first time.
        </p>
      ) : (
        <ClassShelfChoice active onCompleted={onDone} />
      )}
    </StepFrame>
  );
}

/* ── Bridge ──────────────────────────────────────────────────────────── */

function BridgeStep({ platform, ready, onDone, onBack }: { platform: BridgePlatform; ready: boolean; onDone: () => void; onBack?: () => void }) {
  const pairing = devicePairing();
  const pairingState = useSyncExternalStore(pairing.subscribe, pairing.get, pairing.get);
  const requestPairing = useMutation(api.bridge.requestPairing);
  const permission = useNetworkPermission();
  const [skipping, setSkipping] = useState(false);
  const connecting = pairingState.phase !== "idle" && pairingState.phase !== "paired";
  const computer = platform === "macos" ? "Mac" : "computer";

  const connect = () => {
    setBridgeRemovedHere(false);
    void pairing.start(requestPairing);
  };
  // Paired: the store settles back to idle for the next time.
  useEffect(() => {
    if (pairingState.phase !== "paired") return;
    const settle = window.setTimeout(() => pairing.reset(), 600);
    return () => window.clearTimeout(settle);
  }, [pairing, pairingState.phase]);

  return (
    <StepFrame
      title={ready ? `Spectra Bridge is on this ${computer}` : `Put Spectra Bridge on this ${computer}`}
      about={
        ready
          ? "Spectra can now keep the folders you choose in sync, open files on this computer, and run Codex or Claude Code for you."
          : "A small app that lets Spectra reach the folders you choose on this computer, keep their files in your Library, and run Codex or Claude Code on your own subscription. It only ever sees what you allow."
      }
      actions={
        <Actions onBack={onBack}>
          {ready ? (
            <Button variant="primary" onClick={onDone}>
              Continue
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setSkipping(true)}>
                Not now
              </Button>
              {connecting ? null : (
                <Button variant="primary" onClick={connect}>
                  Set up Bridge
                </Button>
              )}
            </>
          )}
        </Actions>
      }
    >
      {ready ? (
        <p className="spectra-setup-done" role="status">
          <span aria-hidden className="spectra-setup-check" />
          Connected
        </p>
      ) : connecting ? (
        <PairingPanel state={pairingState} onCancel={() => pairing.cancel()} onRetry={connect} />
      ) : (
        <div className="spectra-setup-note">
          <p>Setting it up takes about a minute:</p>
          <BridgeInstallSteps platform={platform} />
          <p className="text-micro text-[var(--text-tertiary)]">Spectra notices Bridge by itself once it&apos;s running, then shows a code to confirm.</p>
        </div>
      )}
      {!ready && permission === "denied" ? (
        <p className="device-problem mt-3" role="alert">
          Your browser is blocking Spectra from reaching Bridge. {NETWORK_PERMISSION_FIX}
        </p>
      ) : null}
      <ConfirmDialog
        open={skipping}
        title="Set up Bridge later?"
        detail="Without it, Spectra can't reach files on this computer or run Codex and Claude Code. You can set it up any time from Devices."
        confirmLabel="Not now"
        cancelLabel="Set it up"
        onCancel={() => setSkipping(false)}
        onConfirm={() => {
          setSkipping(false);
          pairing.cancel();
          onDone();
        }}
      />
    </StepFrame>
  );
}

/* ── Where artifacts are kept ────────────────────────────────────────── */

function StorageStep({ onDone, onBack }: { onDone: () => void; onBack?: () => void }) {
  const choose = useMutation(api.deviceWorks.choose);
  const [only, setOnly] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const pick = only === null ? null : only ? ("device_backup" as const) : ("cloud" as const);
  return (
    <StepFrame
      title="Is this your only computer?"
      about="It decides where your artifacts are kept. They look and work the same either way, and you can change it on Devices."
      actions={
        <Actions onBack={onBack}>
          <Button
            variant="primary"
            disabled={!pick || saving}
            onClick={() => {
              if (!pick) return;
              setSaving(true);
              void choose({ storage: pick })
                .then(onDone)
                .finally(() => setSaving(false));
            }}
          >
            {saving ? "Saving…" : "Continue"}
          </Button>
        </Actions>
      }
    >
      <div role="radiogroup" aria-label="Is this your only computer?" className="spectra-setup-answers">
        <button type="button" role="radio" aria-checked={only === true} onClick={() => setOnly(true)}>
          Yes, I mostly use this one
        </button>
        <button type="button" role="radio" aria-checked={only === false} onClick={() => setOnly(false)}>
          No, I use more than one
        </button>
      </div>
      {pick ? (
        <div className="mt-4">
          <p className="mb-2 text-caption text-[var(--text-secondary)]">
            {only ? "Then keep them here, with a daily backup:" : "Then keep them online, so every computer has them:"}
          </p>
          <WorkHomeChoice compact only={pick} />
        </div>
      ) : null}
    </StepFrame>
  );
}

/* ── AI subscription ─────────────────────────────────────────────────── */

function SubscriptionsStep({ onDone, onBack }: { onDone: () => void; onBack?: () => void }) {
  const { status } = useAgentRuntime();
  const [skipping, setSkipping] = useState(false);
  const ready = status?.codex?.state === "ready" || status?.claude?.state === "ready";
  return (
    <StepFrame
      title="Pay for ChatGPT or Claude?"
      about="Spectra can run on your own subscription through Codex or Claude Code, with all the same tools. Spectra installs them and opens their log-in for you."
      actions={
        <Actions onBack={onBack}>
          {ready ? null : (
            <Button variant="ghost" onClick={() => setSkipping(true)}>
              Skip
            </Button>
          )}
          <Button variant="primary" disabled={!ready} onClick={onDone}>
            Continue
          </Button>
        </Actions>
      }
    >
      <div className="spectra-setup-card">
        <SubscriptionSetup compact />
      </div>
      <ConfirmDialog
        open={skipping}
        title="Skip your subscription?"
        detail="You'll use Spectra's own model. You can connect Codex or Claude Code later from Devices or the model menu on the island."
        confirmLabel="Use Spectra's model"
        cancelLabel="Go back"
        onCancel={() => setSkipping(false)}
        onConfirm={() => {
          setSkipping(false);
          onDone();
        }}
      />
    </StepFrame>
  );
}

/* ── The island and the settings worth choosing now ──────────────────── */

const THEME_OPTIONS = [
  { value: "system", label: "Match computer" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const CENTRE_OPTIONS = [
  { value: "screen", label: "Middle of the screen" },
  { value: "page", label: "Middle of the page" },
] as const;

/** Spectra's light rises once from the real island below when this step opens, and again where it lands when it moves. */
function useIslandLight(centre: string) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const composer = document.querySelector("[data-island-composer]");
      if (!composer) return;
      const box = composer.getBoundingClientRect();
      life.pulse(box.left + box.width / 2, box.top + box.height / 2, 0.6, "spectrum");
    }, 560);
    return () => window.clearTimeout(timer);
  }, [centre]);
}

function IslandStep({ onDone, onBack, last }: { onDone: () => void; onBack?: () => void; last: boolean }) {
  const { preferences, update } = useSpectraPreferences();
  const { ai, appearance, notifications } = preferences;
  const { setTheme } = useTheme();
  useIslandShowcase();
  useIslandLight(ai.islandCentre);
  // As Settings does: the account keeps the choice, and the page takes it at once.
  const chooseTheme = (theme: (typeof THEME_OPTIONS)[number]["value"]) => {
    update("appearance", { theme });
    setTheme(theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme);
  };
  return (
    <StepFrame
      title="Everything starts at the island"
      about="The bar below is on every page. Ask it anything, hand it a task or drop in a file. Each conversation keeps a tab above it, and + starts a new one. Try it now."
      actions={
        <Actions onBack={onBack}>
          <Button variant="primary" onClick={onDone}>
            {last ? "Finish" : "Continue"}
          </Button>
        </Actions>
      }
    >
      <dl className="spectra-setup-settings">
        <div>
          <dt>Where the island sits</dt>
          <dd>
            <Segmented
              size="compact"
              label="Where the island sits"
              value={ai.islandCentre}
              options={CENTRE_OPTIONS}
              onChange={(islandCentre) => update("ai", { islandCentre })}
            />
          </dd>
        </div>
        <div>
          <dt>Look</dt>
          <dd>
            <Segmented size="compact" label="Look" value={appearance.theme} options={THEME_OPTIONS} onChange={chooseTheme} />
          </dd>
        </div>
        <div>
          <dt>
            Open the conversation when I send
            <small>Off, the answer peeks from its tab while you keep working.</small>
          </dt>
          <dd>
            <Switch
              aria-label="Open the conversation when I send"
              checked={ai.openConversationAfterSend}
              onCheckedChange={(openConversationAfterSend) => update("ai", { openConversationAfterSend })}
            />
          </dd>
        </div>
        <div>
          <dt>
            Reminders at
            <small>For anything dated that day without a time.</small>
          </dt>
          <dd>
            <TimeField label="Reminders at" className="w-[120px]" value={notifications.reminderTime} onChange={(time) => time && update("notifications", { reminderTime: time })} />
          </dd>
        </div>
      </dl>
    </StepFrame>
  );
}

/* ── What keeps coming in from ManageBac ─────────────────────────────── */

const MODE_OPTIONS = (["auto", "manual", "off"] as const).map((value) => ({ value, label: MODE_LABEL[value] }));

type SyncKindRow = { kind: SchoolSyncKind; label: string; mode: SchoolSyncMode; available: boolean; choice: boolean };
const choosable = (kind: SyncKindRow) => kind.available && kind.choice;

function SyncsStep({ onDone, onBack }: { onDone: () => void; onBack?: () => void }) {
  const preferences = useQuery(api.school.preferences, {}) as { kinds: SyncKindRow[] } | null | undefined;
  const setMode = useMutation(api.school.setMode);
  const kinds = preferences?.kinds.filter(choosable) ?? [];
  return (
    <StepFrame
      title="What comes in from ManageBac"
      about={`${MODE_LABEL.auto} keeps it up to date in the background, ${MODE_LABEL.manual} only when you press Sync now. Past tasks always come in. You can change any of this in School.`}
      actions={
        <Actions onBack={onBack}>
          <Button variant="primary" onClick={onDone}>
            Finish
          </Button>
        </Actions>
      }
    >
      {preferences === undefined ? (
        <p className="spectra-setup-waiting" role="status">
          <span aria-hidden className="spectra-setup-pulse" />
          Loading what syncs.
        </p>
      ) : (
        <ul className="spectra-setup-syncs">
          {kinds.map((kind) => (
            <li key={kind.kind}>
              <span>
                <strong>{kind.label}</strong>
                <small>{SCHOOL_SYNC_KIND_INFO[kind.kind].description}</small>
              </span>
              <Segmented size="compact" label={`${kind.label} sync`} value={kind.mode} options={MODE_OPTIONS} onChange={(mode) => void setMode({ kind: kind.kind, mode })} />
            </li>
          ))}
        </ul>
      )}
    </StepFrame>
  );
}
