"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { LifeKey } from "@/components/ui/life-moments";
import type { BarCommand } from "@/components/ui/adaptive-bar";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSideHeld } from "@/components/ui/side-panel";
import { SelectField } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { IsolatedErrorBoundary } from "@/components/global-error-boundary";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";
import { knownCapabilityIds } from "../../capabilities/catalog";
import { useSpectraPreferences } from "../preference-store";
import { preferenceSaveStatus } from "../preference-save-status";
import type { PreferenceSection, SpectraPreferences } from "../schema";
import { clearSpectraMemory, exportSpectraMemory } from "../../data/api";
import { downloadDocumentBlob } from "../../components/artifact-studio-file-utils";
import { COMMAND_TABS } from "../../commands";
import { SMART_COMPLETION_TARGET } from "../../actions/protocol/semantic-action";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_CATEGORY_DESCRIPTIONS,
  PERMISSION_CATEGORY_LABELS,
  PERMISSION_CHOICE_OPTIONS,
  fullControlPatch,
  permissionChoice,
  permissionChoicePatch,
  type PermissionChoice,
} from "../schema/ai-permissions";
import { registerSettingsToggleControl } from "../../collaboration/settings-toggle-control";

const SECTIONS = [
  { id: "ai", label: "Spectra AI", icon: "agent" },
  { id: "writing", label: "Writing", icon: "edit" },
  { id: "day", label: "Your day", icon: "clock" },
  { id: "appearance", label: "Appearance", icon: "theme" },
  { id: "workbar", label: "Workbars", icon: "tool" },
  { id: "privacy", label: "Privacy and data", icon: "locked" },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName }>;

const ISLAND_WAKE_OPTIONS = [
  { value: "prism", label: "Always show the dock" },
  { value: "edge", label: "Show it from the edge" },
];

const RETENTION_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "240", label: "4 hours" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];
const isSection = (value: string): value is SectionId =>
  SECTIONS.some((section) => section.id === value);

function SettingGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
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

function SettingRow({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div className="group flex min-h-[68px] items-center gap-4 rounded-card px-3.5 py-3 transition-colors hover:bg-[var(--bg-secondary)] sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-[var(--text-primary)]">{label}</div>
        {description ? <div className="mt-0.5 max-w-2xl text-micro leading-[18px] text-[var(--text-secondary)]">{description}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description?: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <SettingRow label={label} description={description} control={<Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />} />;
}

function SelectRow({ label, description, value, options, onChange }: { label: string; description?: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <SettingRow label={label} description={description} control={
      <SelectField ariaLabel={label} value={value} onChange={onChange} options={options} />
    } />
  );
}

type SectionProps<K extends PreferenceSection> = {
  p: SpectraPreferences[K];
  update: (patch: Partial<SpectraPreferences[K]>) => void;
};

function ConversationSettings({ p, update }: SectionProps<"ai">) {
  return (
    <SettingGroup title="Conversations and the island" description="How new messages continue, and how the island at the bottom of every page waits for you.">
      <ToggleRow label="Continue the current conversation" description="When off, an unassigned send begins a new conversation. Explicitly selected conversations still continue." checked={p.continueCurrentConversation} onCheckedChange={(continueCurrentConversation) => update({ continueCurrentConversation })} />
      <SettingRow label="The dock at rest" description="Show it from the edge keeps the dock hidden until the pointer reaches the bottom of the screen, or you press Ctrl+J. Spectra still shows it when it has a question for you." control={<SelectField ariaLabel="The dock at rest" value={p.islandWake} onChange={(islandWake) => update({ islandWake: islandWake as "prism" | "edge" })} options={ISLAND_WAKE_OPTIONS} />} />
      <ToggleRow label="Open requests for input" description="Required questions expand automatically while the run waits for you." checked={p.expandRequiredInput} onCheckedChange={(expandRequiredInput) => update({ expandRequiredInput })} />
      <ToggleRow label="Keep completed runs nearby" checked={p.retainCompletedRunTabs} onCheckedChange={(retainCompletedRunTabs) => update({ retainCompletedRunTabs })} />
      {p.retainCompletedRunTabs ? <SettingRow label="Keep completed runs for" control={<SelectField ariaLabel="Keep completed runs for" value={String(p.completedRunRetentionMinutes)} onChange={(next) => update({ completedRunRetentionMinutes: Number(next) })} options={RETENTION_OPTIONS} />} /> : null}
    </SettingGroup>
  );
}

/*
 * Settings → Spectra AI → Permissions. Only the user changes these: the AI's
 * settings command refuses any patch that touches them (see ai-permissions.ts).
 */
function PermissionSettings({ p, update }: SectionProps<"ai">) {
  const stored = { permissionFullControl: p.permissionFullControl, permissionAllow: p.permissionAllow, permissionDeny: p.permissionDeny };
  return (
    <SettingGroup title="Permissions" description="Reading and ordinary edits always run and can be undone. Choose what Spectra may do that cannot be undone, or that changes your settings, sharing and connections.">
      <ToggleRow label="Give Spectra full control" description="Allow every category below without asking. Turning this off sets every category back to Ask." checked={p.permissionFullControl} onCheckedChange={(on) => update(fullControlPatch(on))} />
      {PERMISSION_CATEGORIES.map((category) => {
        const label = PERMISSION_CATEGORY_LABELS[category];
        return (
          <SelectRow
            key={category}
            label={label.charAt(0).toUpperCase() + label.slice(1)}
            description={PERMISSION_CATEGORY_DESCRIPTIONS[category]}
            value={permissionChoice(stored, category)}
            options={PERMISSION_CHOICE_OPTIONS}
            onChange={(choice) => update(permissionChoicePatch(stored, category, choice as PermissionChoice))}
          />
        );
      })}
    </SettingGroup>
  );
}

function SmartCompletionControl({ checked, onCheckedChange, refreshConfirmedPreferences }: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  refreshConfirmedPreferences: () => Promise<void>;
}) {
  const control = useRef<HTMLButtonElement>(null);
  const refresh = useRef(refreshConfirmedPreferences);
  refresh.current = refreshConfirmedPreferences;
  useEffect(() => {
    if (!control.current) return;
    return registerSettingsToggleControl(control.current, () => refresh.current());
  }, []);
  return <Switch ref={control} checked={checked} onCheckedChange={onCheckedChange} aria-label="Smart completion" data-spectra-ai-target={SMART_COMPLETION_TARGET} />;
}

function WritingSettings({ p, update, refreshConfirmedPreferences }: SectionProps<"writing"> & {
  refreshConfirmedPreferences: () => Promise<void>;
}) {
  return (
    <SettingGroup title="Writing suggestions" description="Short phrase completions appear as you type. They never insert text until you accept them.">
      <SettingRow label="Smart completion" control={<SmartCompletionControl checked={p.smartCompletion} onCheckedChange={(smartCompletion) => update({ smartCompletion })} refreshConfirmedPreferences={refreshConfirmedPreferences} />} />
      <ToggleRow label="Quick Chat suggestions" checked={p.quickChatSuggestions} onCheckedChange={(quickChatSuggestions) => update({ quickChatSuggestions })} />
      <ToggleRow label="Document suggestions" checked={p.longFormSuggestions} onCheckedChange={(longFormSuggestions) => update({ longFormSuggestions })} />
      <SettingRow label="Suggestion delay" description={`${p.delayMs} ms after you pause`} control={<input aria-label="Suggestion delay" type="range" min={120} max={1200} step={20} value={p.delayMs} onChange={(event) => update({ delayMs: Number(event.target.value) })} />} />
    </SettingGroup>
  );
}

function DaySettings({ p, update }: SectionProps<"notifications">) {
  return (
    <SettingGroup title="Reminders and brief" description="When Spectra nudges you about the work you have dated, and the brief it writes each morning.">
      <SettingRow
        label="Reminder time"
        description="A task with a day but no time reminds you at this time, on the day or the days before, as you choose on the task."
        control={
          <Input
            type="time"
            aria-label="Reminder time"
            className="h-9 w-[124px]"
            value={p.reminderTime}
            onChange={(event) => event.target.value && update({ reminderTime: event.target.value })}
          />
        }
      />
      <ToggleRow
        label="Morning brief"
        description="When you wake, Home has yesterday in a few lines and what to do today, each one press away: work to make or pick up, tasks to open or add."
        checked={p.dailyBrief}
        onCheckedChange={(dailyBrief) => update({ dailyBrief })}
      />
      {p.dailyBrief ? (
        <SettingRow
          label="Wake-up time"
          description="Your brief is ready by this time each morning."
          control={
            <Input
              type="time"
              aria-label="Wake-up time"
              className="h-9 w-[124px]"
              value={p.dailyBriefTime}
              onChange={(event) => event.target.value && update({ dailyBriefTime: event.target.value })}
            />
          }
        />
      ) : null}
    </SettingGroup>
  );
}

function AppearanceSettings({ p, update }: SectionProps<"appearance">) {
  const { setTheme } = useTheme();
  const applyTheme = (value: string) => {
    const theme = value as typeof p.theme;
    update({ theme });
    setTheme(theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme);
  };
  return (
    <SettingGroup title="Reading comfort" description="Text and motion preferences apply across every work type through the shared Spectra shell.">
      <SelectRow label="Theme" value={p.theme} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={applyTheme} />
      <SelectRow label="Editor text" value={p.editorTextScale} options={[{ value: "small", label: "Small" }, { value: "default", label: "Default" }, { value: "large", label: "Large" }, { value: "extra_large", label: "Extra large" }]} onChange={(editorTextScale) => update({ editorTextScale: editorTextScale as typeof p.editorTextScale })} />
      <SelectRow label="Interface text" value={p.interfaceTextScale} options={[{ value: "default", label: "Default" }, { value: "large", label: "Large" }]} onChange={(interfaceTextScale) => update({ interfaceTextScale: interfaceTextScale as typeof p.interfaceTextScale })} />
      <ToggleRow label="Reduced motion" description="Removes decorative transitions while preserving state changes." checked={p.reducedMotion} onCheckedChange={(reducedMotion) => update({ reducedMotion, motionLevel: reducedMotion ? "reduced" : "full" })} />
    </SettingGroup>
  );
}

const WORKBAR_TYPES = [
  "document", "sheets", "presentation", "quiz", "flashcard_deck",
  "planner_task", "timetable", "code", "whiteboard", "agent",
] as const;

const KNOWN_COMMAND_IDS = knownCapabilityIds();

function workbarCommandName(commandId: string) {
  const leaf = commandId.split(".").at(-1) ?? commandId;
  return leaf.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replace(/^\w/, (letter) => letter.toUpperCase());
}

function WorkbarSettings({ p, update }: SectionProps<"workbar">) {
  const [type, setType] = useState<(typeof WORKBAR_TYPES)[number]>("document");
  const layout = p[type] ?? {};
  const commandOverrides = Object.entries(layout.commands ?? {}).filter(([commandId]) =>
    KNOWN_COMMAND_IDS.has(commandId),
  );
  const tabs = layout.tabOrder ?? [...COMMAND_TABS[type]];
  const save = (next: typeof layout) => update({ [type]: next });
  const saveCommand = (commandId: string, override: NonNullable<typeof layout.commands>[string] | undefined) => {
    const commands = { ...layout.commands };
    if (!override || !Object.values(override).some((value) => value !== undefined)) {
      commands[commandId] = {};
    } else {
      commands[commandId] = override;
    }
    save({ ...layout, commands });
  };
  return (
    <SettingGroup title="Workbar layout" description="Layouts follow your account and update open editors without reloading them.">
      <SelectRow
        label="Work type"
        value={type}
        options={WORKBAR_TYPES.map((value) => ({ value, label: value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) }))}
        onChange={(value) => setType(value as typeof type)}
      />
      {tabs.map((tab, index) => (
        <SettingRow key={tab} label={`${tab} tab`} description="Tab order" control={<div className="flex items-center gap-1"><Button aria-label={`Move ${tab} earlier`} size="sm" variant="ghost" disabled={index === 0} onClick={() => { const next = [...tabs]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; save({ ...layout, tabOrder: next }); }}>←</Button><Button aria-label={`Move ${tab} later`} size="sm" variant="ghost" disabled={index === tabs.length - 1} onClick={() => { const next = [...tabs]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; save({ ...layout, tabOrder: next }); }}>→</Button></div>} />
      ))}
      {commandOverrides.map(([commandId, override]) => {
        const shippedName = workbarCommandName(commandId);
        return (
          <div key={commandId} className="rounded-card px-3.5 py-3">
            <LifeKey id={`command-override:${commandId}`} />
            <div className="text-ui font-medium text-[var(--text-primary)]">{override.label ?? shippedName}</div>
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              <Input
                aria-label={`Name on the workbar for ${shippedName}`}
                className="h-8 min-w-[140px] max-w-[220px]"
                maxLength={48}
                value={override.label ?? ""}
                placeholder={shippedName}
                onChange={(event) => {
                  const label = event.target.value.slice(0, 48);
                  saveCommand(commandId, { ...override, label: label.length ? label : undefined });
                }}
              />
              <Button size="sm" variant="ghost" onClick={() => saveCommand(commandId, { ...override, pinned: !override.pinned })}>{override.pinned ? "Unpin" : "Pin"}</Button>
              <Button size="sm" variant="ghost" onClick={() => saveCommand(commandId, { ...override, hidden: !override.hidden })}>{override.hidden ? "Restore" : "Remove"}</Button>
            </div>
          </div>
        );
      })}
      <SettingRow label="Restore the shipped layout" description="Clears renamed labels, moved commands, the order of tabs, groups and commands, and hidden controls for this work type." control={<Button size="sm" variant="secondary" onClick={() => save({})}>Reset workbar</Button>} />
    </SettingGroup>
  );
}

function PrivacySettings() {
  const [busy, setBusy] = useState<"clear" | "export" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  async function clearContext() {
    setBusy("clear");
    try {
      await clearSpectraMemory("CLEAR");
      toast.success("Personal context cleared.");
      setConfirmClear(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Personal context could not be cleared.");
    } finally {
      setBusy(null);
    }
  }
  async function exportContext() {
    setBusy("export");
    try {
      const result = await exportSpectraMemory();
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      // Revoking right after click() can cancel the download in Safari.
      downloadDocumentBlob("spectra-personal-context.json", blob);
      toast.success("Personal context exported.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Personal context could not be exported.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <SettingGroup title="Personal context" description="Inspectable controls for the private context Spectra can use across conversations.">
      <SettingRow label="Class shelves" description="Choose which ManageBac classes get their own workspace. Unchosen class work stays in General." control={<Button size="sm" variant="secondary" asChild><Link href="/school">Open School</Link></Button>} />
      <SettingRow label="Export personal context" description="Download a JSON copy for review." control={<Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void exportContext()}>{busy === "export" ? "Preparing…" : "Export"}</Button>} />
      <SettingRow label="Clear personal context" description={confirmClear ? "This removes the private retrieval context Spectra has learned. Your work stays intact." : "Remove retrieval evidence without deleting your work."} control={confirmClear ? <div className="flex items-center gap-1"><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmClear(false)}>Cancel</Button><Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void clearContext()}>{busy === "clear" ? "Clearing…" : "Clear now"}</Button></div> : <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => setConfirmClear(true)}>Clear context</Button>} />
    </SettingGroup>
  );
}

/** The only place in Spectra to leave a device signed out. */
function AccountSettings() {
  const { openUserProfile, signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <SettingGroup title="Account" description="Your sign-in details, and signing out of this device.">
      <SettingRow label="Account details" description="Name, email, password and sign-in methods." control={<Button size="sm" variant="secondary" onClick={() => openUserProfile()}>Manage account</Button>} />
      <SettingRow
        label="Sign out of this device"
        description="Your work stays in your account. Sign out on a shared or school computer."
        control={
          <Button
            size="sm"
            variant="secondary"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut({ redirectUrl: "/" }).catch(() => {
                setSigningOut(false);
                toast.error("Spectra could not sign you out. Try again.");
              });
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        }
      />
    </SettingGroup>
  );
}

export function SettingsApplication({ initialSection = "ai" }: { initialSection?: string }) {
  const [active, setActive] = useState<SectionId>(isSection(initialSection) ? initialSection : "ai");
  const { preferences, hydrated, saveError, saving, update, reset, refreshConfirmedPreferences } = useSpectraPreferences();
  const saveStatus = preferenceSaveStatus({ saving, saveError });
  // The section list folds into a popover while the Side holds work, or the window is narrow.
  const sideHeld = useSideHeld();
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, wideOnServer);
  const folded = sideHeld || narrow;
  const [sectionsOpen, setSectionsOpen] = useState(false);
  useEffect(() => { if (isSection(initialSection)) setActive(initialSection); }, [initialSection]);
  const updateSection = <K extends PreferenceSection>(section: K) => (patch: Partial<SpectraPreferences[K]>) => update(section, patch);
  const body: Record<SectionId, ReactNode> = {
    ai: (
      <div className="space-y-10">
        <ConversationSettings p={preferences.ai} update={updateSection("ai")} />
        <PermissionSettings p={preferences.ai} update={updateSection("ai")} />
      </div>
    ),
    writing: <WritingSettings p={preferences.writing} update={updateSection("writing")} refreshConfirmedPreferences={refreshConfirmedPreferences} />,
    day: <DaySettings p={preferences.notifications} update={updateSection("notifications")} />,
    appearance: <AppearanceSettings p={preferences.appearance} update={updateSection("appearance")} />,
    workbar: <WorkbarSettings p={preferences.workbar} update={updateSection("workbar")} />,
    privacy: <div className="space-y-10"><AccountSettings /><PrivacySettings /></div>,
  };
  const current = SECTIONS.find((section) => section.id === active) ?? SECTIONS[0];
  const choose = (id: SectionId) => {
    setActive(id);
    setSectionsOpen(false);
    window.history.replaceState(null, "", `/settings?section=${id}`);
  };
  const commands: BarCommand[] = [
    { id: "reset", icon: "undo", label: "Restore defaults", labelPolicy: "never", onSelect: reset },
  ];
  return (
    <main className="spectra-wave-y relative isolate h-full min-h-0 flex-1 overflow-auto" data-spectra-app-surface="true">
      <PageBody>
        <PageHeader
          title="Settings"
          commands={commands}
          barLabel="Settings commands"
          description="Changes follow your account and apply at once, everywhere you use Spectra."
        />
        <div className={`mt-6 flex min-w-0 gap-8 transition-opacity ${hydrated ? "opacity-100" : "opacity-70"}`}>
          {folded ? null : (
            <div className="w-48 shrink-0">
              <div className="sticky top-0">
                <SectionList active={active} onChange={choose} />
              </div>
            </div>
          )}
          <section
            className="@container/settings min-w-0 max-w-[1080px] flex-1"
            aria-labelledby="settings-section-title"
            data-spectra-ai-target={active}
          >
            {folded ? (
              <Popover open={sectionsOpen} onOpenChange={setSectionsOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="-ml-2 mb-4" aria-label={`${current.label}. Choose a settings section`}>
                    <Icon name={current.icon} size={16} />
                    {current.label}
                    <Icon name="chevronDown" size={14} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56">
                  <SectionList active={active} onChange={choose} />
                </PopoverContent>
              </Popover>
            ) : null}
            <h2 id="settings-section-title" className="sr-only">
              {current.label}
            </h2>
            <IsolatedErrorBoundary
              fallback={({ offline, retry }) =>
                offline ? (
                  <p className="py-6 text-caption text-[var(--text-secondary)]" role="status">
                    This device is offline. Settings that live on this computer still work; the rest come back when you reconnect.
                  </p>
                ) : (
                  <div role="alert" className="flex flex-wrap items-center gap-3 py-6">
                    <p className="text-caption text-[var(--text-secondary)]">These settings didn&apos;t load.</p>
                    <Button size="sm" onClick={retry}>
                      Try again
                    </Button>
                  </div>
                )
              }
            >
              {saveStatus ? (
                <p className="pb-4 text-ui leading-5 text-[var(--text-primary)]" role="status" aria-live="polite">
                  {saveStatus}
                </p>
              ) : null}
              {body[active]}
            </IsolatedErrorBoundary>
          </section>
        </div>
      </PageBody>
    </main>
  );
}

/** The sections, as a list beside the page or inside the folded popover. */
function SectionList({ active, onChange }: { active: SectionId; onChange: (id: SectionId) => void }) {
  return (
    <nav aria-label="Settings sections">
      <ul className="space-y-0.5">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              data-icon-host
              aria-current={section.id === active ? "page" : undefined}
              onClick={() => onChange(section.id)}
              className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-control px-2.5 text-left text-ui text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] aria-[current=page]:bg-[var(--bg-hover)] aria-[current=page]:font-medium aria-[current=page]:text-[var(--text-primary)]"
            >
              <Icon name={section.icon} size={16} />
              <span className="truncate">{section.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const NARROW = "(max-width: 899px)";
function subscribeNarrow(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(NARROW);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const isNarrow = () => typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
const wideOnServer = () => false;
