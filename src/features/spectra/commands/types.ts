import type { LucideIcon } from "lucide-react";
import type { z } from "zod";
import type { WorkCapability, WorkSharingRole, WorkType } from "../work/registry";

export type CompatibilityProfile = "strict-native" | "enhanced" | "spectra-native";
export type FidelityClass = "NATIVE" | "EQUIVALENT" | "PRESERVED" | "EXTENSION";

/**
 * The regions a command can touch inside a native package. A command declares
 * the regions it writes; the shared availability path compares each one against
 * the artifact's live fidelity map, so a control is disabled by *what it would
 * change* rather than by a per-studio guess. One vocabulary for DOCX, XLSX and
 * PPTX keeps the gate legible: `tables` means the same thing everywhere.
 */
export type FidelityRegionKey =
  | "body"
  | "styles"
  | "lists"
  | "tables"
  | "tableStructure"
  | "images"
  | "equations"
  | "headersFooters"
  | "footnotes"
  | "hyperlinks"
  | "fields"
  | "trackedChanges"
  | "sections"
  | "comments"
  | "macros"
  | "customXml"
  | "smartArt"
  | "ole"
  | "cells"
  | "formulas"
  | "numberFormats"
  | "merges"
  | "freezePanes"
  | "sheetStructure"
  | "dimensions"
  | "sheetViews"
  | "sheetMetadata"
  | "calculationSettings"
  | "sortFilter"
  | "charts"
  | "pivotTables"
  | "validation"
  | "conditionalFormat"
  | "namedRanges"
  | "slides"
  | "masters"
  | "layouts"
  | "transitions"
  | "animations"
  | "media"
  | "speakerNotes"
  | "shapes";

/**
 * The value a parameterized command receives. Controls in the bar (a font
 * picker, a size stepper, a colour well) are commands too — they carry one
 * scalar, which keeps the human path and the AI path on the same `execute`.
 */
export type CommandParam = string | number | boolean | null | undefined;

export type CommandParameterKind =
  | "text"
  | "textarea"
  | "toggle"
  | "select"
  | "destination"
  | "item";

export type CommandParameterSpec = {
  name: string;
  label: string;
  kind: CommandParameterKind;
  required?: boolean;
  placeholder?: string;
  options?: readonly { value: string; label: string }[];
};

export type CommandEffectKind = "navigate" | "open" | "toggle" | "mutate" | "select";

export type CommandEffectContract = {
  kind: CommandEffectKind;
  /** Existing confirmation semantics are explicit; safe actions execute now. */
  confirmation: "none" | "existing" | "required";
  /** The observable result a human can expect after execution. */
  outcome: string;
};

export type CommandExecutionStatus =
  | "completed"
  | "pending"
  | "needs-human"
  | "failed"
  | "cancelled"
  | "unavailable";

export type CommandExecutionResult = {
  commandId: string;
  status: CommandExecutionStatus;
  effect: CommandEffectKind;
  message: string;
  readiness?: import("../viewport-readiness").ViewportReadinessAcknowledgement;
  data?: unknown;
};

export type CommandControlOption = {
  value: string;
  label: string;
  icon?: LucideIcon;
  hint?: string;
  /** Renders the option in its own typeface — used by the font picker. */
  previewFontFamily?: string;
  disabled?: boolean;
};

/**
 * A command's in-bar shape. `button` and `toggle` are the default; the richer
 * kinds exist so that font family, size, colour and alignment are *registered
 * commands with a real control*, instead of loose editor chains living beside
 * the registry (C1).
 */
export type CommandControl =
  | { kind: "button" }
  | { kind: "toggle" }
  | {
      kind: "select";
      options: readonly CommandControlOption[];
      value?: string;
      placeholder?: string;
      /** CSS width for the trigger, e.g. "8.5rem". */
      width?: string;
    }
  | {
      kind: "numeric";
      value?: number;
      min?: number;
      max?: number;
      step?: number;
      suffix?: string;
      /** Discrete presets offered in the dropdown beside the stepper. */
      presets?: readonly number[];
    }
  | {
      kind: "color";
      value?: string;
      swatches?: readonly string[];
      /** Label for the "no colour" choice; omitted means the well cannot clear. */
      clearLabel?: string;
    }
  | {
      kind: "segmented";
      options: readonly CommandControlOption[];
      value?: string;
    }
  | {
      kind: "menu";
      options: readonly CommandControlOption[];
      value?: string;
    };

export type CommandControlKind = CommandControl["kind"];
export type CommandAvailability =
  | { state: "enabled" }
  | { state: "disabled"; reason: string }
  | { state: "hidden" };

export type CommandContext = {
  workType: WorkType;
  can: (capability: WorkCapability) => boolean;
  compatibilityProfile: CompatibilityProfile;
  fidelity: Readonly<Record<string, FidelityClass>>;
  /** The artifact the command acts on, when the surface knows it. */
  artifactId?: string;
  /** The linked native package's format, when the artifact is one. */
  nativeFormat?: string | null;
  selection: Readonly<{
    kind?: string;
    ids: readonly string[];
    /** Type-specific detail: an A1 range, block ids, slide object ids. */
    label?: string;
  }>;
  permissions: Readonly<{ role: WorkSharingRole; editable: boolean }>;
  /** Shared semantic application dispatcher. App commands must use this
   * path so toolbar, shortcuts, and AI cannot drift into separate effects. */
  executeApplicationCommand?: (
    commandId: string,
    params: unknown,
  ) => void | Promise<void | CommandExecutionResult>;
};

export type CommandPresentation = {
  kind: CommandControlKind;
  /** The live control spec when the command renders as more than a button. */
  control?: CommandControl;
  compact: { label?: string; iconOnly?: boolean };
  medium: { label?: string; iconOnly?: boolean };
  expanded?: { label?: string; description?: string };
};

export type Command<P = unknown> = {
  id: string;
  /** Stable capability IR identity, when this command is IR-derived. */
  capabilityId?: string;
  domain: `artifact:${WorkType}` | `app:${string}`;
  title: string;
  icon: LucideIcon;
  description: string;
  params?: z.ZodType<P>;
  execute: (ctx: CommandContext, params: P) =>
    | void
    | boolean
    | Promise<void | boolean | CommandExecutionResult>;
  /** Compact parameter UX for the universal palette and other app surfaces. */
  parameters?: readonly CommandParameterSpec[];
  /** Shared effect/result contract; workbar bindings derive a safe default. */
  effect?: CommandEffectContract;
  /** Internal descriptors stay auditable without being palette-visible. */
  visibility?: "public" | "internal";
  /** Native regions this command may write. Drives strict-native gating. */
  touches?: readonly FidelityRegionKey[];
  /** Canonical native lens delta used to materialize this capability. */
  nativeDelta?: string;
  /** Manifest/AI operation names this command implements. */
  manifestOps?: readonly string[];
  /** Copy boundary — an export copy never claims to be a native sync write. */
  exportBoundary?: "none" | "lossy-copy" | "native-sync";
  availability: (ctx: CommandContext) => CommandAvailability;
  presentation: CommandPresentation;
  defaultPlacement: { tab: string; group: string; order: number };
  /**
   * Where this command stands in the shedding order. Exposed on the resolved
   * command, not just the binding, because "would this land in the overflow
   * menu?" is a question audits, tests and the AI surface all need to ask — and
   * a command reached only through `⋯` owes an explanation beyond its label.
   */
  priority: "essential" | "secondary" | "advanced";
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
  /** Stable capability IR identity, projected into this workbar binding. */
  capabilityId?: string;
  /** Typed operation parameters generated from the capability definition. */
  params?: z.ZodType<CommandParam>;
  label: string;
  icon?: LucideIcon;
  /**
   * The one implementation of this operation. A plain `() => void` stays valid;
   * parameterized controls receive their scalar here, so the bar, a shortcut,
   * a menu and the AI dispatcher all land on this same function.
   */
  onSelect: (value?: CommandParam) => void | boolean | Promise<void | boolean>;
  /** Capability-owned availability, shared by UI and non-UI consumers. */
  availability?: (ctx: CommandContext) => CommandAvailability;
  /** Renders the command as a real control instead of a button. */
  control?: CommandControl;
  /** Native regions written by this command — compared against the fidelity map. */
  touches?: readonly FidelityRegionKey[];
  /** Canonical native lens delta used to materialize this capability. */
  nativeDelta?: string;
  /** Manifest/AI operation names this binding implements. */
  manifestOps?: readonly string[];
  /** Authority class. Defaults from priority when unset. */
  risk?: "safe" | "confirm" | "always-confirm" | "destructive";
  /** How the change is reversed. Defaults to the Yjs history stack. */
  undo?: "yjs" | "operation-inverse" | "none(explain)";
  /** Export/import copy semantics for honesty in the bar and in AI offers. */
  exportBoundary?: "none" | "lossy-copy" | "native-sync";
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
  shortcut?: string;
  /** Native-format availability is declared per command. Unspecified means
   * the command is non-mutating or safely representable in every profile. */
  strictNative?: { available: boolean; reason?: string };
  /** AI exposure and authority generated from the capability definition. */
  ai?: {
    exposed: boolean;
    description: string;
    riskClass: "safe" | "confirm" | "always-confirm" | "destructive";
  };
  choreography?: { target: string; region?: string };
  parameters?: readonly CommandParameterSpec[];
  effect?: CommandEffectContract;
  visibility?: "public" | "internal";
};

/**
 * One person's arrangement of one editor's workbar. Orders are per tab: the
 * groups in the order they chose, and the commands in the order they chose.
 * Which commands collapse, and how, is the editor's plan and is not stored.
 */
export type CommandLayout = {
  tabOrder?: string[];
  groupOrder?: Record<string, string[]>;
  commandOrder?: Record<string, string[]>;
  commands?: Record<string, {
    tab?: string;
    label?: string;
    hidden?: boolean;
    pinned?: boolean;
  }>;
};
