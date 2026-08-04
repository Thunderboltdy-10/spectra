"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Accessibility,
  Bell,
  Bot,
  ChevronDown,
  CloudCog,
  Command,
  Cpu,
  ExternalLink,
  FileText,
  Keyboard,
  LockKeyhole,
  MonitorCog,
  Palette,
  RotateCcw,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/theme-provider";
import { useSpectraPreferences } from "../preference-store";
import type {
  PreferenceSection,
  SpectraPreferences,
} from "../schema";
import { spectraBus } from "../../events";
import { clearSpectraMemory, exportSpectraMemory } from "../../data/api";

const SECTIONS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "ai", label: "AI and runs", icon: Bot },
  { id: "writing", label: "Writing and autocomplete", icon: Sparkles },
  { id: "collaboration", label: "Collaboration", icon: Users },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "compute", label: "Local compute and files", icon: Cpu },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "privacy", label: "Privacy and data", icon: LockKeyhole },
  { id: "integrations", label: "Integrations", icon: CloudCog },
  { id: "accessibility", label: "Accessibility", icon: Accessibility },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];
const isSection = (value: string): value is SectionId =>
  SECTIONS.some((section) => section.id === value);

function SettingGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-[var(--border-default)] bg-[var(--bg-primary)]">
      <div className="border-b border-[var(--border-subtle)] px-5 py-4 sm:px-6">
        <h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--text-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex min-h-[68px] items-center gap-4 px-5 py-3.5 sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-[var(--text-primary)]">{label}</div>
        {description ? (
          <div className="mt-0.5 max-w-2xl text-[12px] leading-[18px] text-[var(--text-secondary)]">
            {description}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SettingRow
      label={label}
      description={description}
      control={
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-label={label}
        />
      }
    />
  );
}

function SelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <SettingRow
      label={label}
      description={description}
      control={
        <label className="relative block">
          <span className="sr-only">{label}</span>
          <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-9 min-w-[150px] appearance-none rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-secondary)] py-0 pl-3 pr-8 text-[12px] font-medium text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
        </label>
      }
    />
  );
}

function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-[18px] border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-[13px] font-semibold text-[var(--text-primary)] sm:px-6">
        Advanced
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[var(--border-subtle)]">{children}</div>
    </details>
  );
}

function GeneralSettings({ p, update }: SectionProps<"general">) {
  return (
    <SettingGroup title="General" description="Language, time, navigation and everyday input behaviour.">
      <SelectRow label="Language and locale" value={p.locale} options={[{ value: "en-GB", label: "English (UK)" }, { value: "en-US", label: "English (US)" }, { value: "es-ES", label: "Español (España)" }]} onChange={(locale) => update({ locale })} />
      <SelectRow label="Date format" value={p.dateFormat} options={[{ value: "locale", label: "Use locale" }, { value: "day_month_year", label: "31/12/2026" }, { value: "month_day_year", label: "12/31/2026" }, { value: "year_month_day", label: "2026-12-31" }]} onChange={(dateFormat) => update({ dateFormat: dateFormat as typeof p.dateFormat })} />
      <SelectRow label="Time format" value={p.timeFormat} options={[{ value: "locale", label: "Use locale" }, { value: "12_hour", label: "12 hour" }, { value: "24_hour", label: "24 hour" }]} onChange={(timeFormat) => update({ timeFormat: timeFormat as typeof p.timeFormat })} />
      <SelectRow label="Default start page" value={p.startPage} options={[{ value: "workspace", label: "Workspace" }, { value: "library", label: "Library" }, { value: "calendar", label: "Calendar" }, { value: "chat", label: "Chat" }]} onChange={(startPage) => update({ startPage: startPage as typeof p.startPage })} />
      <ToggleRow label="Spellcheck" checked={p.spellcheck} onCheckedChange={(spellcheck) => update({ spellcheck })} />
      <ToggleRow label="Keyboard shortcuts" checked={p.keyboardShortcuts} onCheckedChange={(keyboardShortcuts) => update({ keyboardShortcuts })} />
      <SelectRow label="Global command" description="Choose how search and commands are prioritised." value={p.globalCommandBehaviour} options={[{ value: "search_and_commands", label: "Search and commands" }, { value: "commands_first", label: "Commands first" }, { value: "search_first", label: "Search first" }]} onChange={(globalCommandBehaviour) => update({ globalCommandBehaviour: globalCommandBehaviour as typeof p.globalCommandBehaviour })} />
      <SettingRow label="Account controls" description="Profile, authentication, connected identities and account removal." control={<Button size="sm" variant="secondary" onClick={() => spectraBus.command("settings.manageAccount", {})}>Manage account</Button>} />
    </SettingGroup>
  );
}

function AiSettings({ p, update }: SectionProps<"ai">) {
  return <>
    <SettingGroup title="AI and runs" description="Helpful defaults keep work moving without forcing open a conversation.">
      <ToggleRow label="Continue current conversation" checked={p.continueCurrentConversation} onCheckedChange={(continueCurrentConversation) => update({ continueCurrentConversation })} />
      <ToggleRow label="Open side conversation after send" description="Off by default. Runs stay compact in Live Dock until you open them." checked={p.openConversationAfterSend} onCheckedChange={(openConversationAfterSend) => update({ openConversationAfterSend })} />
      <ToggleRow label="Show Live Dock summaries" checked={p.showLiveDockProgress} onCheckedChange={(showLiveDockProgress) => update({ showLiveDockProgress })} />
      <ToggleRow label="Route to specialist agents when confident" checked={p.autoRouteSpecialists} onCheckedChange={(autoRouteSpecialists) => update({ autoRouteSpecialists })} />
      <ToggleRow label="Parallel safe reads" description="Independent read tools may run together; mutations still serialize safely." checked={p.parallelSafeReads} onCheckedChange={(parallelSafeReads) => update({ parallelSafeReads })} />
      <SelectRow label="Research depth" value={p.researchDepth} options={[{ value: "automatic", label: "Automatic" }, { value: "quick", label: "Quick" }, { value: "verified", label: "Verified" }, { value: "deep", label: "Deep" }]} onChange={(researchDepth) => update({ researchDepth: researchDepth as typeof p.researchDepth })} />
      <SelectRow label="Reasoning profile" value={p.reasoningProfile} options={[{ value: "configured_maximum", label: "Configured maximum" }, { value: "balanced", label: "Balanced" }, { value: "fast", label: "Fast" }]} onChange={(reasoningProfile) => update({ reasoningProfile: reasoningProfile as typeof p.reasoningProfile })} />
      <ToggleRow label="Reversible low-risk actions" description="Allows safe actions that can be undone without repeated approval." checked={p.reversibleLowRiskAutonomy} onCheckedChange={(reversibleLowRiskAutonomy) => update({ reversibleLowRiskAutonomy })} />
      <ToggleRow label="Notify when input is required" checked={p.notifyRequiredInput} onCheckedChange={(notifyRequiredInput) => update({ notifyRequiredInput })} />
      <ToggleRow label="Notify when a run completes" checked={p.notifyRunCompletion} onCheckedChange={(notifyRunCompletion) => update({ notifyRunCompletion })} />
    </SettingGroup>
    <Advanced>
      <ToggleRow label="Retain completed run tabs" checked={p.retainCompletedRunTabs} onCheckedChange={(retainCompletedRunTabs) => update({ retainCompletedRunTabs })} />
      <SettingRow label="Completed-run retention" control={<input aria-label="Completed-run retention" type="number" min={5} max={1440} value={p.completedRunRetentionMinutes} onChange={(event) => update({ completedRunRetentionMinutes: Math.max(5, Math.min(1440, Number(event.target.value) || 30)) })} className="h-9 w-24 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[12px] text-[var(--text-primary)]" />} />
      <ToggleRow label="Expand required input automatically" checked={p.expandRequiredInput} onCheckedChange={(expandRequiredInput) => update({ expandRequiredInput })} />
      <SelectRow label="New-thread shortcut" value={p.newThreadShortcut} options={[{ value: "modifier_enter", label: "⌘/Ctrl + Enter" }, { value: "shift_enter", label: "Shift + Enter" }, { value: "menu_only", label: "Menu only" }]} onChange={(newThreadShortcut) => update({ newThreadShortcut: newThreadShortcut as typeof p.newThreadShortcut })} />
      <ToggleRow label="Provider diagnostics" description="Shows model/provider identity for development and troubleshooting only." checked={p.showProviderDiagnostics} onCheckedChange={(showProviderDiagnostics) => update({ showProviderDiagnostics })} />
    </Advanced>
  </>;
}

function WritingSettings({ p, update }: SectionProps<"writing">) {
  return <>
    <SettingGroup title="Writing and autocomplete" description="Suggestions are generated locally. Spectra never falls back to cloud completion for partial fields.">
      <ToggleRow label="Smart completion" checked={p.smartCompletion} onCheckedChange={(smartCompletion) => update({ smartCompletion })} />
      <ToggleRow label="Quick Chat suggestions" checked={p.quickChatSuggestions} onCheckedChange={(quickChatSuggestions) => update({ quickChatSuggestions })} />
      <ToggleRow label="Long-form writing suggestions" checked={p.longFormSuggestions} onCheckedChange={(longFormSuggestions) => update({ longFormSuggestions })} />
      <ToggleRow label="Comments and descriptions" checked={p.commentAndDescriptionSuggestions} onCheckedChange={(commentAndDescriptionSuggestions) => update({ commentAndDescriptionSuggestions })} />
      <ToggleRow label="Plan notes" checked={p.planNoteSuggestions} onCheckedChange={(planNoteSuggestions) => update({ planNoteSuggestions })} />
      <ToggleRow label="Quiz and card text" checked={p.quizCardSuggestions} onCheckedChange={(quizCardSuggestions) => update({ quizCardSuggestions })} />
      <ToggleRow label="Slide text" checked={p.slideTextSuggestions} onCheckedChange={(slideTextSuggestions) => update({ slideTextSuggestions })} />
      <ToggleRow label="Agent Foundry fields" checked={p.agentFoundrySuggestions} onCheckedChange={(agentFoundrySuggestions) => update({ agentFoundrySuggestions })} />
    </SettingGroup>
    <Advanced>
      <SelectRow label="Accept full suggestion" value={p.acceptAllKey} options={[{ value: "tab", label: "Tab" }, { value: "modifier_enter", label: "⌘/Ctrl + Enter" }]} onChange={(acceptAllKey) => update({ acceptAllKey: acceptAllKey as typeof p.acceptAllKey })} />
      <SelectRow label="Accept next word" value={p.acceptWordKey} options={[{ value: "arrow_right", label: "Right Arrow" }, { value: "modifier_arrow_right", label: "⌘/Ctrl + Right" }]} onChange={(acceptWordKey) => update({ acceptWordKey: acceptWordKey as typeof p.acceptWordKey })} />
      <SettingRow label="Suggestion delay" description={`${p.delayMs} ms adaptive idle`} control={<input aria-label="Suggestion delay" type="range" min={120} max={2000} step={20} value={p.delayMs} onChange={(event) => update({ delayMs: Number(event.target.value) })} />} />
      <SelectRow label="Sensitivity" value={p.sensitivity} options={[{ value: "restrained", label: "Restrained" }, { value: "balanced", label: "Balanced" }, { value: "eager", label: "Eager" }]} onChange={(sensitivity) => update({ sensitivity: sensitivity as typeof p.sensitivity })} />
      <SettingRow label="Processing" description="Autocomplete is local only. When the device cannot support it, suggestions are disabled or deterministic." control={<span className="rounded-full bg-[color-mix(in_oklab,var(--success)_12%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--success)]">Local only</span>} />
      <SettingRow label="Code and formula completion" description="Code diagnostics and sheet formulas use their own deterministic/runtime settings." control={<Link href="/settings?section=compute" className="text-[12px] font-semibold text-[var(--accent)]">Open compute settings</Link>} />
    </Advanced>
  </>;
}

function CollaborationSettings({ p, update }: SectionProps<"collaboration">) {
  return <SettingGroup title="Collaboration" description="Presence stays informative and automatically quiets down in busy rooms.">
    <ToggleRow label="Collaborator cursors" checked={p.collaboratorCursors} onCheckedChange={(collaboratorCursors) => update({ collaboratorCursors })} />
    <ToggleRow label="Remote selections" checked={p.remoteSelections} onCheckedChange={(remoteSelections) => update({ remoteSelections })} />
    <ToggleRow label="Compact collaborator labels" checked={p.compactLabels} onCheckedChange={(compactLabels) => update({ compactLabels })} />
    <ToggleRow label="Follow presenter behaviour" checked={p.followPresenter} onCheckedChange={(followPresenter) => update({ followPresenter })} />
    <SelectRow label="AI activity visibility" value={p.aiActivityVisibility} options={[{ value: "automatic", label: "Automatic" }, { value: "always", label: "Always" }, { value: "minimal", label: "Minimal" }]} onChange={(aiActivityVisibility) => update({ aiActivityVisibility: aiActivityVisibility as typeof p.aiActivityVisibility })} />
    <ToggleRow label="Collaboration sounds" checked={p.sounds} onCheckedChange={(sounds) => update({ sounds })} />
    <ToggleRow label="Haptics" checked={p.haptics} onCheckedChange={(haptics) => update({ haptics })} />
    <ToggleRow label="Reduce clutter with many collaborators" checked={p.reduceClutterAutomatically} onCheckedChange={(reduceClutterAutomatically) => update({ reduceClutterAutomatically })} />
    <ToggleRow label="Reconnect and offline indicators" checked={p.reconnectIndicators} onCheckedChange={(reconnectIndicators) => update({ reconnectIndicators })} />
  </SettingGroup>;
}

function AppearanceSettings({ p, update }: SectionProps<"appearance">) {
  const { setTheme } = useTheme();
  const setAppearanceTheme = (value: string) => {
    const theme = value as typeof p.theme;
    update({ theme });
    if (theme === "system") {
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    } else setTheme(theme);
  };
  return <SettingGroup title="Appearance" description="Tune reading comfort without shrinking functional surfaces.">
    <SelectRow label="Theme" value={p.theme} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={setAppearanceTheme} />
    <SelectRow label="Interface density" value={p.density} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} onChange={(density) => update({ density: density as typeof p.density })} />
    <SelectRow label="Editor text scale" value={p.editorTextScale} options={[{ value: "small", label: "Small" }, { value: "default", label: "Default" }, { value: "large", label: "Large" }, { value: "extra_large", label: "Extra large" }]} onChange={(editorTextScale) => update({ editorTextScale: editorTextScale as typeof p.editorTextScale })} />
    <SelectRow label="Interface text scale" value={p.interfaceTextScale} options={[{ value: "default", label: "Default" }, { value: "large", label: "Large" }]} onChange={(interfaceTextScale) => update({ interfaceTextScale: interfaceTextScale as typeof p.interfaceTextScale })} />
    <SelectRow label="Contrast" value={p.contrast} options={[{ value: "standard", label: "Standard" }, { value: "high", label: "High" }]} onChange={(contrast) => update({ contrast: contrast as typeof p.contrast })} />
    <ToggleRow label="Reduced motion" checked={p.reducedMotion} onCheckedChange={(reducedMotion) => update({ reducedMotion })} />
    <SelectRow label="Motion level" value={p.motionLevel} options={[{ value: "full", label: "Full" }, { value: "reduced", label: "Reduced" }, { value: "none", label: "None" }]} onChange={(motionLevel) => update({ motionLevel: motionLevel as typeof p.motionLevel })} />
    <ToggleRow label="Streaming reveal" checked={p.streamingReveal} onCheckedChange={(streamingReveal) => update({ streamingReveal })} />
    <ToggleRow label="Active-tail shimmer" checked={p.activeTailShimmer} onCheckedChange={(activeTailShimmer) => update({ activeTailShimmer })} />
    <SelectRow label="Sidebar default" value={p.sidebarDefault} options={[{ value: "remember", label: "Remember last state" }, { value: "expanded", label: "Expanded" }, { value: "collapsed", label: "Collapsed" }]} onChange={(sidebarDefault) => update({ sidebarDefault: sidebarDefault as typeof p.sidebarDefault })} />
  </SettingGroup>;
}

function ComputeSettings({ p, update }: SectionProps<"compute">) {
  return <>
    <div className="grid gap-3 sm:grid-cols-3">
      {[{ label: "Execution", value: typeof Worker === "undefined" ? "Server only" : "Worker ready", icon: Cpu }, { label: "Files", value: "Originals retained", icon: FileText }, { label: "Policy", value: p.local === "auto" ? "Capability aware" : p.local === "never" ? "Server preferred" : "Local preferred", icon: MonitorCog }].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-[16px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"><Icon className="size-4 text-[var(--accent)]" /><div className="mt-4 text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{label}</div><div className="mt-1 text-[13px] font-semibold text-[var(--text-primary)]">{value}</div></div>)}
    </div>
    <SettingGroup title="Local compute and files" description="Auto selects a safe worker, server, provider or truthful degraded path for this device.">
      <SelectRow label="Local compute" value={p.local} options={[{ value: "auto", label: "Auto" }, { value: "prefer_local", label: "Prefer local" }, { value: "never", label: "Never" }]} onChange={(local) => update({ local: local as typeof p.local })} />
      <ToggleRow label="Respect battery saver" checked={p.respectBatterySaver} onCheckedChange={(respectBatterySaver) => update({ respectBatterySaver })} />
      <ToggleRow label="Respect data saver" checked={p.respectDataSaver} onCheckedChange={(respectDataSaver) => update({ respectDataSaver })} />
      <SettingRow label="Local cache size" description={`${p.localCacheMegabytes} MB maximum with bounded per-work eviction`} control={<input aria-label="Local cache size" type="range" min={64} max={4096} step={64} value={p.localCacheMegabytes} onChange={(event) => update({ localCacheMegabytes: Number(event.target.value) })} />} />
      <ToggleRow label="Local PDF inspection" description="Classifies text and image pages; it does not claim OCR." checked={p.localPdfInspection} onCheckedChange={(localPdfInspection) => update({ localPdfInspection })} />
      <ToggleRow label="Local code execution" checked={p.localCodeExecution} onCheckedChange={(localCodeExecution) => update({ localCodeExecution })} />
      <ToggleRow label="Local code builds" checked={p.localCodeBuild} onCheckedChange={(localCodeBuild) => update({ localCodeBuild })} />
      <ToggleRow label="Automatic file conversion" checked={p.automaticFileConversion} onCheckedChange={(automaticFileConversion) => update({ automaticFileConversion })} />
      <SettingRow label="Preserve originals" description="Original uploads remain the canonical evidence and fallback." control={<span className="text-[12px] font-semibold text-[var(--success)]">Always on</span>} />
      <SelectRow label="Upload behaviour" value={p.uploadBehaviour} options={[{ value: "automatic", label: "Automatic" }, { value: "ask_for_large_files", label: "Ask for large files" }, { value: "always_ask", label: "Always ask" }]} onChange={(uploadBehaviour) => update({ uploadBehaviour: uploadBehaviour as typeof p.uploadBehaviour })} />
      <SettingRow label="Local cache" description="Clears downloaded runtime assets, generated indexes and replaceable previews. Original work remains safe." control={<Button variant="secondary" size="sm" onClick={() => spectraBus.command("settings.clearLocalComputeCache", {})}>Clear cache</Button>} />
    </SettingGroup>
  </>;
}

function NotificationsSettings({ p, update }: SectionProps<"notifications">) {
  return <SettingGroup title="Notifications" description="Choose the events that deserve your attention.">
    <ToggleRow label="Mentions and comments" checked={p.mentionsAndComments} onCheckedChange={(mentionsAndComments) => update({ mentionsAndComments })} />
    <ToggleRow label="Sharing" checked={p.sharing} onCheckedChange={(sharing) => update({ sharing })} />
    <ToggleRow label="Run completion" checked={p.runCompletion} onCheckedChange={(runCompletion) => update({ runCompletion })} />
    <ToggleRow label="Required input" checked={p.requiredInput} onCheckedChange={(requiredInput) => update({ requiredInput })} />
    <ToggleRow label="School-source changes" checked={p.schoolSourceChanges} onCheckedChange={(schoolSourceChanges) => update({ schoolSourceChanges })} />
    <ToggleRow label="Deadlines" checked={p.deadlines} onCheckedChange={(deadlines) => update({ deadlines })} />
    <SettingRow label="Browser permission" description="Spectra asks only when a notification setting needs device permission." control={<span className="rounded-full border border-[var(--border-default)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">{p.browserPermission.replaceAll("_", " ")}</span>} />
  </SettingGroup>;
}

function PrivacySettings({ p, update }: SectionProps<"privacy">) {
  const [busyAction, setBusyAction] = useState<"clear" | "export" | null>(null);
  const clearContext = async () => {
    if (!window.confirm("Clear all private personal context? Shared work and its history are not changed.")) return;
    setBusyAction("clear");
    try {
      const result = await clearSpectraMemory("FORGET ALL");
      toast.success(`Cleared ${result.forgottenCount} private context ${result.forgottenCount === 1 ? "entry" : "entries"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Personal context could not be cleared.");
    } finally {
      setBusyAction(null);
    }
  };
  const exportData = async () => {
    setBusyAction("export");
    try {
      const payload = await exportSpectraMemory();
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "spectra-personal-context.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The data export could not be prepared.");
    } finally {
      setBusyAction(null);
    }
  };
  return <>
    <SettingGroup title="Privacy and data" description="Personal context works conservatively behind the scenes; there is no separate Memory workspace.">
      <ToggleRow label="Use personal context" checked={p.usePersonalContext} onCheckedChange={(usePersonalContext) => update({ usePersonalContext })} />
      <ToggleRow label="Use workspace context" checked={p.useWorkspaceContext} onCheckedChange={(useWorkspaceContext) => update({ useWorkspaceContext })} />
      <SelectRow label="Local processing" value={p.localProcessingPreference} options={[{ value: "automatic", label: "Automatic" }, { value: "prefer_local", label: "Prefer local" }, { value: "cloud_allowed", label: "Cloud allowed" }]} onChange={(localProcessingPreference) => update({ localProcessingPreference: localProcessingPreference as typeof p.localProcessingPreference })} />
      <SelectRow label="Diagnostics" value={p.diagnostics} options={[{ value: "essential", label: "Essential only" }, { value: "help_improve", label: "Help improve Spectra" }, { value: "none", label: "None" }]} onChange={(diagnostics) => update({ diagnostics: diagnostics as typeof p.diagnostics })} />
      <SettingRow label="Clear personal context" description="Remove personal retrieval evidence without affecting your work." control={<Button disabled={busyAction !== null} size="sm" variant="secondary" onClick={() => void clearContext()}>{busyAction === "clear" ? "Clearing…" : "Clear context"}</Button>} />
      <SettingRow label="Export your data" control={<Button disabled={busyAction !== null} size="sm" variant="secondary" onClick={() => void exportData()}>{busyAction === "export" ? "Preparing…" : "Export context"}</Button>} />
      <SettingRow label="Delete account data" description="Permanent deletion requires confirmation and the applicable retention window." control={<Button size="sm" variant="destructive" onClick={() => spectraBus.command("settings.manageAccount", {})}>Review deletion</Button>} />
    </SettingGroup>
  </>;
}

function IntegrationsSettings({ p, update }: SectionProps<"integrations">) {
  return <SettingGroup title="Integrations" description="Connections expose permissions, freshness and truthful capability status.">
    <ToggleRow label="School data connection" checked={p.schoolDataEnabled} onCheckedChange={(schoolDataEnabled) => update({ schoolDataEnabled })} />
    <ToggleRow label="Future school providers" description="Allow provider-neutral adapters after you approve their permissions." checked={p.allowFutureProviders} onCheckedChange={(allowFutureProviders) => update({ allowFutureProviders })} />
    <ToggleRow label="Connection-status notifications" checked={p.connectionNotifications} onCheckedChange={(connectionNotifications) => update({ connectionNotifications })} />
    <SettingRow label="School and ManageBac" description="Review connected identity, available capabilities, freshness and manual sync." control={<Button asChild size="sm" variant="secondary"><Link href="/school">Open School <ExternalLink className="size-3.5" /></Link></Button>} />
    <SettingRow label="Permissions" description="Connected providers receive only the capabilities shown before approval." control={<Button size="sm" variant="secondary">Review</Button>} />
    <SettingRow label="Disconnect" description="Stops future synchronization; already imported work retains source provenance." control={<Button size="sm" variant="ghost">Disconnect</Button>} />
  </SettingGroup>;
}

function AccessibilitySettings({ p, update }: SectionProps<"accessibility">) {
  return <SettingGroup title="Accessibility" description="Accessibility state updates independently from animation and AI completion.">
    <ToggleRow label="Reduced motion" checked={p.reducedMotion} onCheckedChange={(reducedMotion) => update({ reducedMotion })} />
    <ToggleRow label="High contrast" checked={p.highContrast} onCheckedChange={(highContrast) => update({ highContrast })} />
    <ToggleRow label="Always-visible focus" checked={p.alwaysVisibleFocus} onCheckedChange={(alwaysVisibleFocus) => update({ alwaysVisibleFocus })} />
    <ToggleRow label="Keyboard-only preference" checked={p.keyboardOnly} onCheckedChange={(keyboardOnly) => update({ keyboardOnly })} />
    <SelectRow label="Collaboration announcements" value={p.collaborationAnnouncements} options={[{ value: "important", label: "Important" }, { value: "all", label: "All" }, { value: "off", label: "Off" }]} onChange={(collaborationAnnouncements) => update({ collaborationAnnouncements: collaborationAnnouncements as typeof p.collaborationAnnouncements })} />
    <ToggleRow label="Autocomplete announcements" checked={p.autocompleteAnnouncements} onCheckedChange={(autocompleteAnnouncements) => update({ autocompleteAnnouncements })} />
    <SelectRow label="Screen-reader run status" value={p.runStatusAnnouncements} options={[{ value: "important", label: "Important changes" }, { value: "all", label: "All updates" }, { value: "off", label: "Off" }]} onChange={(runStatusAnnouncements) => update({ runStatusAnnouncements: runStatusAnnouncements as typeof p.runStatusAnnouncements })} />
    <SettingRow label="Keyboard shortcuts" control={<Button asChild size="sm" variant="secondary"><Link href="/settings?section=general"><Keyboard className="size-3.5" /> Review shortcuts</Link></Button>} />
  </SettingGroup>;
}

type SectionProps<K extends PreferenceSection> = {
  p: SpectraPreferences[K];
  update: (patch: Partial<SpectraPreferences[K]>) => void;
};

export function SettingsApplication({ initialSection = "general" }: { initialSection?: string }) {
  const [active, setActive] = useState<SectionId>(isSection(initialSection) ? initialSection : "general");
  const { preferences, hydrated, update, reset } = useSpectraPreferences();
  useEffect(() => {
    if (isSection(initialSection)) setActive(initialSection);
  }, [initialSection]);
  const current = useMemo(() => SECTIONS.find((section) => section.id === active)!, [active]);
  const updateSection = <K extends PreferenceSection>(section: K) =>
    (patch: Partial<SpectraPreferences[K]>) => update(section, patch);
  const body: Record<SectionId, ReactNode> = {
    general: <GeneralSettings p={preferences.general} update={updateSection("general")} />,
    ai: <AiSettings p={preferences.ai} update={updateSection("ai")} />,
    writing: <WritingSettings p={preferences.writing} update={updateSection("writing")} />,
    collaboration: <CollaborationSettings p={preferences.collaboration} update={updateSection("collaboration")} />,
    appearance: <AppearanceSettings p={preferences.appearance} update={updateSection("appearance")} />,
    compute: <ComputeSettings p={preferences.compute} update={updateSection("compute")} />,
    notifications: <NotificationsSettings p={preferences.notifications} update={updateSection("notifications")} />,
    privacy: <PrivacySettings p={preferences.privacy} update={updateSection("privacy")} />,
    integrations: <IntegrationsSettings p={preferences.integrations} update={updateSection("integrations")} />,
    accessibility: <AccessibilitySettings p={preferences.accessibility} update={updateSection("accessibility")} />,
  };
  return (
    <main className="min-h-0 flex-1 overflow-auto bg-[var(--bg-secondary)]">
      <div className="mx-auto grid w-full max-w-[1260px] gap-6 px-4 py-7 lg:grid-cols-[248px_minmax(0,1fr)] lg:px-8 lg:py-10">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="mb-5 flex items-end justify-between gap-4 lg:block">
            <div>
              <div className="text-micro font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Spectra controls</div>
              <h1 className="mt-2 font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">Settings</h1>
              <p className="mt-2 max-w-[230px] text-[12px] leading-5 text-[var(--text-secondary)]">Simple choices on the surface, capable policies underneath.</p>
            </div>
            <Button aria-label="Restore defaults" title="Restore defaults" variant="ghost" size="icon" onClick={reset}><RotateCcw className="size-4" /></Button>
          </div>
          <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto rounded-[14px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-1.5 lg:block lg:space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => { setActive(id); window.history.replaceState(null, "", `/settings?section=${id}`); }} aria-current={active === id ? "page" : undefined} className={`flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[12px] font-medium transition lg:w-full ${active === id ? "bg-[var(--text-primary)] text-[var(--bg-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}>
                <Icon className="size-3.5 shrink-0" />{label}
              </button>
            ))}
          </nav>
        </aside>
        <div className={`min-w-0 transition-opacity ${hydrated ? "opacity-100" : "opacity-70"}`}>
          <header className="mb-5 flex items-start gap-3">
            <span className="mt-0.5 grid size-9 place-items-center rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--accent)]"><current.icon className="size-4" /></span>
            <div><h2 className="font-display text-[24px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{current.label}</h2><p className="mt-1 text-[12px] text-[var(--text-tertiary)]">Saved on this device · scope overrides resolve predictably</p></div>
          </header>
          <div className="space-y-4">{body[active]}</div>
          <div className="mt-6 flex items-center gap-2 rounded-[14px] border border-[var(--border-subtle)] px-4 py-3 text-[11px] leading-5 text-[var(--text-tertiary)]"><Command className="size-3.5 shrink-0" /> Account, workspace and work-type overrides are applied before device-specific preferences.</div>
        </div>
      </div>
    </main>
  );
}
