"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bot, Cable, LockKeyhole, Palette, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/theme-provider";
import { useSpectraPreferences } from "../preference-store";
import type { PreferenceSection, SpectraPreferences } from "../schema";
import { clearSpectraMemory, exportSpectraMemory } from "../../data/api";
import { ProductSectionNav } from "../../components/product-section-nav";
import { ProductPageHeader } from "../../components/product-page-header";
import { COMMAND_TABS } from "../../commands";
import { BridgeSettings } from "../../bridge/bridge-settings";

const SECTIONS = [
  { id: "ai", label: "Conversations", icon: Bot },
  { id: "writing", label: "Writing", icon: Sparkles },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "workbar", label: "Workbars", icon: SlidersHorizontal },
  { id: "devices", label: "Files and devices", icon: Cable },
  { id: "privacy", label: "Privacy and data", icon: LockKeyhole },
] as const;

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
    <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <header className="pt-2">
        <h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[var(--text-secondary)]">{description}</p>
      </header>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SettingRow({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div className="group flex min-h-[68px] items-center gap-4 rounded-[10px] px-3.5 py-3 transition-colors hover:bg-[var(--bg-secondary)] sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{label}</div>
        {description ? <div className="mt-0.5 max-w-2xl text-[11px] leading-[18px] text-[var(--text-secondary)]">{description}</div> : null}
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
      <SelectField ariaLabel={label} value={value} onChange={onChange} options={options} triggerClassName="min-w-[164px]" />
    } />
  );
}

type SectionProps<K extends PreferenceSection> = {
  p: SpectraPreferences[K];
  update: (patch: Partial<SpectraPreferences[K]>) => void;
};

function ConversationSettings({ p, update }: SectionProps<"ai">) {
  return (
    <SettingGroup title="Conversations and Live Dock" description="These controls change how new messages continue and how completed work stays visible.">
      <ToggleRow label="Continue the current conversation" description="When off, an unassigned send begins a new conversation. Explicitly selected conversations still continue." checked={p.continueCurrentConversation} onCheckedChange={(continueCurrentConversation) => update({ continueCurrentConversation })} />
      <ToggleRow label="Show progress in Live Dock" checked={p.showLiveDockProgress} onCheckedChange={(showLiveDockProgress) => update({ showLiveDockProgress })} />
      <ToggleRow label="Open requests for input" description="Required questions expand automatically while the run waits for you." checked={p.expandRequiredInput} onCheckedChange={(expandRequiredInput) => update({ expandRequiredInput })} />
      <ToggleRow label="Keep completed runs nearby" checked={p.retainCompletedRunTabs} onCheckedChange={(retainCompletedRunTabs) => update({ retainCompletedRunTabs })} />
      {p.retainCompletedRunTabs ? <SettingRow label="Keep completed runs for" control={<SelectField ariaLabel="Keep completed runs for" value={String(p.completedRunRetentionMinutes)} onChange={(next) => update({ completedRunRetentionMinutes: Number(next) })} options={RETENTION_OPTIONS} triggerClassName="min-w-[144px]" />} /> : null}
    </SettingGroup>
  );
}

function WritingSettings({ p, update }: SectionProps<"writing">) {
  return (
    <SettingGroup title="Local writing suggestions" description="Suggestions stay on this device and never insert text until you accept them.">
      <ToggleRow label="Smart completion" checked={p.smartCompletion} onCheckedChange={(smartCompletion) => update({ smartCompletion })} />
      <ToggleRow label="Quick Chat suggestions" checked={p.quickChatSuggestions} onCheckedChange={(quickChatSuggestions) => update({ quickChatSuggestions })} />
      <ToggleRow label="Document suggestions" checked={p.longFormSuggestions} onCheckedChange={(longFormSuggestions) => update({ longFormSuggestions })} />
      <SettingRow label="Suggestion delay" description={`${p.delayMs} ms after you pause`} control={<input aria-label="Suggestion delay" type="range" min={120} max={1200} step={20} value={p.delayMs} onChange={(event) => update({ delayMs: Number(event.target.value) })} />} />
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
  "planner_task", "code", "whiteboard", "agent",
] as const;

function WorkbarSettings({ p, update }: SectionProps<"workbar">) {
  const [type, setType] = useState<(typeof WORKBAR_TYPES)[number]>("document");
  const layout = p[type] ?? {};
  const commandOverrides = Object.entries(layout.commands ?? {});
  const tabs = layout.tabOrder ?? [...COMMAND_TABS[type]];
  const save = (next: typeof layout) => update({ ...p, [type]: next });
  return (
    <SettingGroup title="Workbar layout" description="Layouts follow your account and update open editors without reloading them.">
      <SelectRow
        label="Work type"
        value={type}
        options={WORKBAR_TYPES.map((value) => ({ value, label: value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) }))}
        onChange={(value) => setType(value as typeof type)}
      />
      <ToggleRow label="Expanded workbar" checked={layout.expanded === true} onCheckedChange={(expanded) => save({ ...layout, expanded })} />
      {tabs.map((tab, index) => (
        <SettingRow key={tab} label={`${tab} tab`} description="Tab order" control={<div className="flex items-center gap-1"><Button aria-label={`Move ${tab} earlier`} size="sm" variant="ghost" disabled={index === 0} onClick={() => { const next = [...tabs]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; save({ ...layout, tabOrder: next }); }}>←</Button><Button aria-label={`Move ${tab} later`} size="sm" variant="ghost" disabled={index === tabs.length - 1} onClick={() => { const next = [...tabs]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; save({ ...layout, tabOrder: next }); }}>→</Button></div>} />
      ))}
      {commandOverrides.map(([commandId, override]) => (
        <SettingRow
          key={commandId}
          label={override.label ?? commandId}
          description={`${override.tab ?? "Default tab"} · ${override.density ?? "Default density"}`}
          control={
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => save({ ...layout, commands: { ...layout.commands, [commandId]: { ...override, pinned: !override.pinned } } })}>{override.pinned ? "Unpin" : "Pin"}</Button>
              <Button size="sm" variant="ghost" onClick={() => save({ ...layout, commands: { ...layout.commands, [commandId]: { ...override, hidden: !override.hidden } } })}>{override.hidden ? "Restore" : "Remove"}</Button>
            </div>
          }
        />
      ))}
      <SettingRow label="Restore the shipped layout" description="Clears renamed labels, moved commands, tab order, densities, and hidden controls for this work type." control={<Button size="sm" variant="secondary" onClick={() => save({})}>Reset workbar</Button>} />
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
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "spectra-personal-context.json";
      anchor.click();
      URL.revokeObjectURL(href);
      toast.success("Personal context exported.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Personal context could not be exported.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <SettingGroup title="Personal context" description="Inspectable controls for the private context Spectra can use across conversations.">
      <SettingRow label="Export personal context" description="Download a JSON copy for review." control={<Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void exportContext()}>{busy === "export" ? "Preparing…" : "Export"}</Button>} />
      <SettingRow label="Clear personal context" description={confirmClear ? "This removes the private retrieval context Spectra has learned. Your work stays intact." : "Remove retrieval evidence without deleting your work."} control={confirmClear ? <div className="flex items-center gap-1"><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmClear(false)}>Cancel</Button><Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void clearContext()}>{busy === "clear" ? "Clearing…" : "Clear now"}</Button></div> : <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => setConfirmClear(true)}>Clear context</Button>} />
    </SettingGroup>
  );
}

export function SettingsApplication({ initialSection = "ai" }: { initialSection?: string }) {
  const [active, setActive] = useState<SectionId>(isSection(initialSection) ? initialSection : "ai");
  const { preferences, hydrated, update, reset } = useSpectraPreferences();
  useEffect(() => { if (isSection(initialSection)) setActive(initialSection); }, [initialSection]);
  const updateSection = <K extends PreferenceSection>(section: K) => (patch: Partial<SpectraPreferences[K]>) => update(section, patch);
  const body: Record<SectionId, ReactNode> = {
    ai: <ConversationSettings p={preferences.ai} update={updateSection("ai")} />,
    writing: <WritingSettings p={preferences.writing} update={updateSection("writing")} />,
    appearance: <AppearanceSettings p={preferences.appearance} update={updateSection("appearance")} />,
    workbar: <WorkbarSettings p={preferences.workbar} update={updateSection("workbar")} />,
    devices: <BridgeSettings />,
    privacy: <PrivacySettings />,
  };
  return (
    <main className="spectra-wave-y min-h-0 flex-1 overflow-auto bg-[var(--bg-primary)]">
      <div className="w-full px-4 pb-36 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <ProductPageHeader
          eyebrow="Preferences"
          title="Settings"
          description="Only controls that change Spectra appear here. Changes follow your account and take effect immediately on every open surface."
          actions={
            <Button aria-label="Restore defaults" title="Restore defaults" variant="ghost" size="icon" onClick={reset}>
              <RotateCcw className="size-4" />
            </Button>
          }
        />
        <section
          aria-label="Settings sections"
          className={`mt-5 min-w-0 transition-opacity ${hydrated ? "opacity-100" : "opacity-70"}`}
          aria-labelledby="settings-section-title"
        >
          <ProductSectionNav
            label="Settings sections"
            items={SECTIONS.map(({ id, label, icon }) => ({ key: id, label, icon }))}
            active={active}
            onChange={(id) => {
              setActive(id);
              window.history.replaceState(null, "", `/settings?section=${id}`);
            }}
          />
          <div className="max-w-[1080px] py-2">
            <h2 id="settings-section-title" className="sr-only">
              {SECTIONS.find((section) => section.id === active)?.label}
            </h2>
            {body[active]}
          </div>
        </section>
      </div>
    </main>
  );
}
