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
  ) => void | Promise<void>;
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
  domain: `artifact:${WorkType}` | `app:${string}`;
  title: string;
  icon: LucideIcon;
  description: string;
  params?: z.ZodType<P>;
  execute: (ctx: CommandContext, params: P) => void | Promise<void>;
  /** Native regions this command may write. Drives strict-native gating. */
  touches?: readonly FidelityRegionKey[];
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
  label: string;
  icon?: LucideIcon;
  /**
   * The one implementation of this operation. A plain `() => void` stays valid;
   * parameterized controls receive their scalar here, so the bar, a shortcut,
   * a menu and the AI dispatcher all land on this same function.
   */
  onSelect: (value?: CommandParam) => void;
  /** Renders the command as a real control instead of a button. */
  control?: CommandControl;
  /** Native regions written by this command — compared against the fidelity map. */
  touches?: readonly FidelityRegionKey[];
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
