import type { LucideIcon } from "lucide-react";
import type { z } from "zod";
import type { WorkCapability, WorkSharingRole, WorkType } from "../work/registry";

export type CompatibilityProfile = "strict-native" | "enhanced" | "spectra-native";
export type FidelityClass = "NATIVE" | "EQUIVALENT" | "PRESERVED" | "EXTENSION";
export type CommandAvailability =
  | { state: "enabled" }
  | { state: "disabled"; reason: string }
  | { state: "hidden" };

export type CommandContext = {
  workType: WorkType;
  can: (capability: WorkCapability) => boolean;
  compatibilityProfile: CompatibilityProfile;
  fidelity: Readonly<Record<string, FidelityClass>>;
  selection: Readonly<{ kind?: string; ids: readonly string[] }>;
  permissions: Readonly<{ role: WorkSharingRole; editable: boolean }>;
  /** Shared semantic application dispatcher. App commands must use this
   * path so toolbar, shortcuts, and AI cannot drift into separate effects. */
  executeApplicationCommand?: (
    commandId: string,
    params: unknown,
  ) => void | Promise<void>;
};

export type CommandPresentation = {
  kind: "button" | "toggle" | "dropdown" | "field" | "segmented" | "color" | "numeric" | "menu";
  compact: { label?: string; iconOnly?: boolean };
  medium: { label?: string; iconOnly?: boolean };
  expanded?: { label?: string; description?: string };
};

export type Command<P = unknown> = {
  id: string;
  domain: `artifact:${WorkType}` | `app:${string}`;
  title: string;
  icon: LucideIcon;
  description: string;
  params?: z.ZodType<P>;
  execute: (ctx: CommandContext, params: P) => void | Promise<void>;
  availability: (ctx: CommandContext) => CommandAvailability;
  presentation: CommandPresentation;
  defaultPlacement: { tab: string; group: string; order: number };
  /** The shipped category before a command is pinned into General. */
  sourceTab?: string;
  contextualTab?: string;
  /** Shipped in the user's General favorites surface. */
  general?: boolean;
  /** Allows a command to render its honest compact/medium form. */
  controlSize?: "compact" | "medium";
  shortcut?: string;
  risk: "safe" | "confirm" | "always-confirm" | "destructive";
  undo: "yjs" | "operation-inverse" | "none(explain)";
  choreography?: { target: string; region?: string };
  aiAuthority?: "allowed" | "prohibited";
  prohibitionReason?: string;
};

export type CommandBinding = {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  priority?: "essential" | "secondary" | "advanced";
  active?: boolean;
  disabled?: boolean;
  keepLabel?: boolean;
  requires?: WorkCapability;
  hint?: string;
  tab?: string;
  group?: string;
  contextualTab?: string;
  /** Shipped in the user's General favorites surface. */
  general?: boolean;
  /** Honest rendering density for controls that support a larger form. */
  controlSize?: "compact" | "medium";
  /** Persisted workbar density override, applied by the shared renderer. */
  density?: "compact" | "medium";
  shortcut?: string;
  /** Native-format availability is declared per command. Unspecified means
   * the command is non-mutating or safely representable in every profile. */
  strictNative?: { available: boolean; reason?: string };
};

export type CommandLayout = {
  expanded?: boolean;
  tabOrder?: string[];
  commands?: Record<string, {
    tab?: string;
    order?: number;
    label?: string;
    density?: "compact" | "medium";
    hidden?: boolean;
    pinned?: boolean;
  }>;
};
