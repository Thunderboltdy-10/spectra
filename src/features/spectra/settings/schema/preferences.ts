import { z } from "zod";
import { PERMISSION_CATEGORIES } from "./ai-permissions";

export const PREFERENCE_SCHEMA_VERSION = 2;
export const preferenceScopeSchema = z.enum([
  "account",
  "workspace",
  "work_type",
  "device",
]);
export type PreferenceScope = z.infer<typeof preferenceScopeSchema>;

const generalSchema = z.object({
  locale: z.string().min(2).max(24).default("en-GB"),
  dateFormat: z.enum(["locale", "day_month_year", "month_day_year", "year_month_day"]).default("locale"),
  timeFormat: z.enum(["locale", "12_hour", "24_hour"]).default("locale"),
  startPage: z.enum(["workspace", "library", "calendar", "chat"]).default("workspace"),
  spellcheck: z.boolean().default(true),
  keyboardShortcuts: z.boolean().default(true),
  globalCommandBehaviour: z.enum(["search_and_commands", "commands_first", "search_first"]).default("search_and_commands"),
});

const aiSchema = z.object({
  continueCurrentConversation: z.boolean().default(true),
  /** "Open the thread when I send" (LAUNCH-REVIEW D3): the card opens over its tab at send; off, the answer peeks from the tab. */
  openConversationAfterSend: z.boolean().default(false),
  showLiveDockProgress: z.boolean().default(true),
  /** The island at rest: the prism (default), or nothing until the pointer reaches the bottom edge. */
  islandWake: z.enum(["prism", "edge"]).default("prism"),
  /** The middle the island keeps to: of the page between the columns, or of the whole screen. */
  islandCentre: z.enum(["page", "screen"]).default("screen"),
  autoRouteSpecialists: z.boolean().default(true),
  parallelSafeReads: z.boolean().default(true),
  researchDepth: z.enum(["automatic", "quick", "verified", "deep"]).default("automatic"),
  /** Whose inference runs this person's work: Spectra's, or their own Codex or Claude Code. */
  runtime: z.enum(["spectra", "codex", "claude"]).default("spectra"),
  /** False until this person picks one, so their own subscription can become the default when it's found. */
  runtimeChosen: z.boolean().default(false),
  /** What to try, in order, when the chosen runtime can't answer. Empty stops the run. */
  runtimeThen: z.array(z.enum(["codex", "claude", "spectra"])).max(3).default(["spectra"]),
  /** Empty is the CLI's default for this account. */
  codexModel: z.string().max(120).default(""),
  claudeModel: z.string().max(120).default(""),
  thinking: z.enum(["low", "medium", "high"]).default("medium"),
  /** How fast the work plays on this person's screen. The edit is saved either way. */
  workSpeed: z.enum(["slow", "medium", "fast"]).default("fast"),
  followSpeed: z.enum(["slow", "medium", "fast"]).default("fast"),
  reversibleLowRiskAutonomy: z.boolean().default(true),
  notifyRequiredInput: z.boolean().default(true),
  notifyRunCompletion: z.boolean().default(true),
  retainCompletedRunTabs: z.boolean().default(true),
  completedRunRetentionMinutes: z.number().int().min(5).max(1_440).default(30),
  expandRequiredInput: z.boolean().default(true),
  newThreadShortcut: z.enum(["modifier_enter", "shift_enter", "menu_only"]).default("modifier_enter"),
  showProviderDiagnostics: z.boolean().default(false),
  // Set only by the user: Settings, or "Always allow" on an approval. Deny wins.
  permissionFullControl: z.boolean().default(false),
  permissionAllow: z.array(z.enum(PERMISSION_CATEGORIES)).max(PERMISSION_CATEGORIES.length).default([]),
  permissionDeny: z.array(z.enum(PERMISSION_CATEGORIES)).max(PERMISSION_CATEGORIES.length).default([]),
});

const writingSchema = z.object({
  smartCompletion: z.boolean().default(true),
  quickChatSuggestions: z.boolean().default(true),
  longFormSuggestions: z.boolean().default(true),
  commentAndDescriptionSuggestions: z.boolean().default(true),
  planNoteSuggestions: z.boolean().default(true),
  quizCardSuggestions: z.boolean().default(true),
  slideTextSuggestions: z.boolean().default(true),
  agentFoundrySuggestions: z.boolean().default(true),
  acceptAllKey: z.enum(["tab", "modifier_enter"]).default("tab"),
  acceptWordKey: z.enum(["arrow_right", "modifier_arrow_right"]).default("arrow_right"),
  delayMs: z.number().int().min(120).max(2_000).default(420),
  sensitivity: z.enum(["restrained", "balanced", "eager"]).default("balanced"),
  localOnly: z.literal(true).default(true),
});

const collaborationSchema = z.object({
  collaboratorCursors: z.boolean().default(true),
  remoteSelections: z.boolean().default(true),
  compactLabels: z.boolean().default(true),
  followPresenter: z.boolean().default(true),
  aiActivityVisibility: z.enum(["automatic", "always", "minimal"]).default("automatic"),
  sounds: z.boolean().default(false),
  haptics: z.boolean().default(true),
  reduceClutterAutomatically: z.boolean().default(true),
  reconnectIndicators: z.boolean().default(true),
});

const appearanceSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  editorTextScale: z.enum(["small", "default", "large", "extra_large"]).default("default"),
  interfaceTextScale: z.enum(["default", "large"]).default("default"),
  contrast: z.enum(["standard", "high"]).default("standard"),
  reducedMotion: z.boolean().default(false),
  motionLevel: z.enum(["full", "reduced", "none"]).default("full"),
  streamingReveal: z.boolean().default(true),
  activeTailShimmer: z.boolean().default(true),
  sidebarDefault: z.enum(["remember", "expanded", "collapsed"]).default("remember"),
  /** The sidebar's destinations in the order this person dragged them to; empty is Spectra's order. */
  railOrder: z.array(z.string().max(32)).max(20).default([]),
  /** Library's workspace tiles, the same way. */
  workspaceOrder: z.array(z.string().max(64)).max(300).default([]),
});

const computeSchema = z.object({
  local: z.enum(["auto", "prefer_local", "never"]).default("auto"),
  respectBatterySaver: z.boolean().default(true),
  respectDataSaver: z.boolean().default(true),
  localCacheMegabytes: z.number().int().min(64).max(4_096).default(512),
  localPdfInspection: z.boolean().default(true),
  localCodeExecution: z.boolean().default(true),
  localCodeBuild: z.boolean().default(true),
  automaticFileConversion: z.boolean().default(true),
  preserveOriginals: z.literal(true).default(true),
  uploadBehaviour: z.enum(["automatic", "ask_for_large_files", "always_ask"]).default("ask_for_large_files"),
});

const notificationsSchema = z.object({
  mentionsAndComments: z.boolean().default(true),
  sharing: z.boolean().default(true),
  runCompletion: z.boolean().default(true),
  requiredInput: z.boolean().default(true),
  schoolSourceChanges: z.boolean().default(true),
  deadlines: z.boolean().default(true),
  /** When a task with a date but no time reminds you, as "HH:MM" on the reminder's day. */
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
  /** Home's morning brief: yesterday in a few lines and what to do today. */
  dailyBrief: z.boolean().default(true),
  /** When the student wakes, as "HH:MM": the brief is ready by then. */
  dailyBriefTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("07:00"),
  browserPermission: z.enum(["not_requested", "granted", "denied"]).default("not_requested"),
});

const privacySchema = z.object({
  usePersonalContext: z.boolean().default(true),
  useWorkspaceContext: z.boolean().default(true),
  localProcessingPreference: z.enum(["automatic", "prefer_local", "cloud_allowed"]).default("automatic"),
  diagnostics: z.enum(["essential", "help_improve", "none"]).default("essential"),
});

const integrationsSchema = z.object({
  schoolDataEnabled: z.boolean().default(true),
  allowFutureProviders: z.boolean().default(true),
  connectionNotifications: z.boolean().default(true),
  classShelvesStatus: z.enum(["pending", "chosen", "skipped"]).default("pending"),
  classShelfRecordIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  /** Spectra's tour of the app: offered once after the school's first sync. */
  tourStatus: z.enum(["pending", "done"]).default("pending"),
  /** First-time tips already said (onboarding/first-tips), so none is said twice. */
  tipsSeen: z.array(z.string().min(1).max(64)).max(64).default([]),
});

const accessibilitySchema = z.object({
  reducedMotion: z.boolean().default(false),
  highContrast: z.boolean().default(false),
  alwaysVisibleFocus: z.boolean().default(false),
  keyboardOnly: z.boolean().default(false),
  collaborationAnnouncements: z.enum(["important", "all", "off"]).default("important"),
  autocompleteAnnouncements: z.boolean().default(false),
  runStatusAnnouncements: z.enum(["important", "all", "off"]).default("important"),
});

/**
 * One person's arrangement of one editor's workbar (EDITORS.md, "Users can
 * reorder"): the tab order, and per tab the order of its groups and of its
 * commands. Which commands collapse, and how, belongs to the editor's plan and
 * is deliberately not stored. Older saved keys (`expanded`, per-command
 * `order` and `density`) are stripped on read.
 */
const ORDERED_IDS = z.array(z.string().min(1).max(160)).max(400);
export const workbarLayoutSchema = z.object({
  tabOrder: z.array(z.string()).optional(),
  groupOrder: z.record(z.string(), ORDERED_IDS).optional(),
  commandOrder: z.record(z.string(), ORDERED_IDS).optional(),
  commands: z
    .record(
      z.string(),
      z.object({
        tab: z.string().optional(),
        label: z.string().trim().min(1).max(48).optional(),
        hidden: z.boolean().optional(),
        pinned: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const preferenceLayerValuesSchema = z
  .object({
    general: generalSchema.partial().optional(),
    ai: aiSchema.partial().optional(),
    writing: writingSchema.partial().optional(),
    collaboration: collaborationSchema.partial().optional(),
    appearance: appearanceSchema.partial().optional(),
    compute: computeSchema.partial().optional(),
    notifications: notificationsSchema.partial().optional(),
    privacy: privacySchema.partial().optional(),
    integrations: integrationsSchema.partial().optional(),
    accessibility: accessibilitySchema.partial().optional(),
    workbar: z
      .record(
        z.string(),
        workbarLayoutSchema,
      )
      .optional(),
  })
  .strip();

export type PreferenceLayerValues = z.infer<typeof preferenceLayerValuesSchema>;

/**
 * The model sometimes paraphrases a preference label instead of using the
 * persisted schema. Normalize the small set of stable aliases before the
 * typed settings path runs; unsupported controls remain unsupported and are
 * removed by the schema rather than being reported as saved work.
 */
export function normalizeAiPreferencePatch(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const patch: Record<string, unknown> = { ...raw };
  const appearance =
    raw.appearance && typeof raw.appearance === "object" && !Array.isArray(raw.appearance)
      ? { ...(raw.appearance as Record<string, unknown>) }
      : {};
  const general =
    raw.general && typeof raw.general === "object" && !Array.isArray(raw.general)
      ? { ...(raw.general as Record<string, unknown>) }
      : {};
  if (
    (appearance.density === undefined || appearance.density === null) &&
    (raw.interfaceDensity === "compact" || raw.interfaceDensity === "comfortable")
  )
    appearance.density = raw.interfaceDensity;
  if (appearance.density === undefined &&
    (raw.density === "compact" || raw.density === "comfortable"))
    appearance.density = raw.density;
  const commandOrder =
    raw.globalBarOrder ??
    raw.commandBarOrder ??
    (raw.commandsFirst === true ? "commands_first" : undefined) ??
    (raw.commandActionsPosition === "before_search"
      ? "commands_first"
      : raw.commandActionsPosition === "after_search"
        ? "search_first"
        : raw.toolbarLayout &&
            typeof raw.toolbarLayout === "object" &&
            !Array.isArray(raw.toolbarLayout) &&
            (raw.toolbarLayout as Record<string, unknown>)
              .commandActionsBeforeSearch === true
          ? "commands_first"
          : raw.toolbarLayout &&
              typeof raw.toolbarLayout === "object" &&
              !Array.isArray(raw.toolbarLayout) &&
              (raw.toolbarLayout as Record<string, unknown>)
                .commandActionsBeforeSearch === false
            ? "search_first"
            : undefined);
  if (
    general.globalCommandBehaviour === undefined &&
    (commandOrder === "commands_first" ||
      commandOrder === "search_first" ||
      commandOrder === "search_and_commands")
  )
    general.globalCommandBehaviour = commandOrder;
  if (Object.keys(appearance).length) patch.appearance = appearance;
  if (Object.keys(general).length) patch.general = general;
  delete patch.interfaceDensity;
  delete patch.density;
  delete patch.globalBarOrder;
  delete patch.commandBarOrder;
  delete patch.commandActionsPosition;
  delete patch.commandsFirst;
  delete patch.toolbarLayout;
  // There is no persisted top/bottom command-bar setting. Keep this out of
  // the saved patch so a model cannot claim to have moved an unsupported UI.
  delete patch.commandBar;
  return patch;
}

export const spectraPreferencesSchema = z.object({
  version: z.literal(PREFERENCE_SCHEMA_VERSION),
  general: generalSchema.default(generalSchema.parse({})),
  ai: aiSchema.default(aiSchema.parse({})),
  writing: writingSchema.default(writingSchema.parse({})),
  collaboration: collaborationSchema.default(collaborationSchema.parse({})),
  appearance: appearanceSchema.default(appearanceSchema.parse({})),
  compute: computeSchema.default(computeSchema.parse({})),
  notifications: notificationsSchema.default(notificationsSchema.parse({})),
  privacy: privacySchema.default(privacySchema.parse({})),
  integrations: integrationsSchema.default(integrationsSchema.parse({})),
  accessibility: accessibilitySchema.default(accessibilitySchema.parse({})),
  workbar: z
    .record(
      z.string(),
      workbarLayoutSchema,
    )
    .default({}),
}).strict();

export type SpectraPreferences = z.infer<typeof spectraPreferencesSchema>;
export type PreferenceSection = Exclude<keyof SpectraPreferences, "version">;
type PartialSections = {
  [K in PreferenceSection]?: K extends "workbar"
    ? SpectraPreferences[K]
    : Partial<SpectraPreferences[K]>;
};
export type ScopedPreferenceLayer = {
  scope: PreferenceScope;
  values: PartialSections;
};

export const DEFAULT_SPECTRA_PREFERENCES = spectraPreferencesSchema.parse({
  version: PREFERENCE_SCHEMA_VERSION,
});

export const PREFERENCE_SCOPE_ORDER = [
  "account",
  "workspace",
  "work_type",
  "device",
] as const satisfies readonly PreferenceScope[];

export function migratePreferences(value: unknown): SpectraPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_SPECTRA_PREFERENCES;
  }
  const legacy = value as Record<string, unknown>;
  if (legacy.version === PREFERENCE_SCHEMA_VERSION) {
    return spectraPreferencesSchema.parse(legacy);
  }
  const legacyAi = legacy.ai && typeof legacy.ai === "object" ? legacy.ai : {};
  const legacyAppearance = legacy.appearance && typeof legacy.appearance === "object" ? legacy.appearance : {};
  const legacyCompute = legacy.compute && typeof legacy.compute === "object" ? legacy.compute : {};
  return spectraPreferencesSchema.parse({
    version: PREFERENCE_SCHEMA_VERSION,
    ai: {
      ...legacyAi,
      continueCurrentConversation:
        typeof legacy.continueThread === "boolean"
          ? legacy.continueThread
          : (legacyAi as Record<string, unknown>).continueCurrentConversation,
    },
    appearance: {
      ...legacyAppearance,
      theme:
        legacy.theme === "light" || legacy.theme === "dark" || legacy.theme === "system"
          ? legacy.theme
          : (legacyAppearance as Record<string, unknown>).theme,
      density:
        legacy.compact === true
          ? "compact"
          : (legacyAppearance as Record<string, unknown>).density,
    },
    compute: legacyCompute,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

/**
 * The one preference merge. Used by layer resolve, Convex writes, dispatcher
 * patches, and optimistic client applies. Nested objects merge; arrays replace;
 * an empty object in a patch replaces that key (workbar reset is `{ document: {} }`).
 */
export function mergePreferenceValues(current: unknown, patch: unknown): Record<string, unknown> {
  const base = objectRecord(current);
  const next = objectRecord(patch);
  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(next)) {
    if (patchValue === undefined) continue;
    const baseValue = base[key];
    if (Array.isArray(patchValue)) {
      result[key] = patchValue;
      continue;
    }
    if (isPlainObject(patchValue)) {
      if (Object.keys(patchValue).length === 0) {
        result[key] = {};
        continue;
      }
      if (isPlainObject(baseValue)) {
        result[key] = mergePreferenceValues(baseValue, patchValue);
        continue;
      }
    }
    result[key] = patchValue;
  }
  return result;
}

export function pruneWorkbarCommandOverrides(
  workbar: SpectraPreferences["workbar"] | undefined,
  knownCommandIds?: ReadonlySet<string>,
): SpectraPreferences["workbar"] {
  const result: SpectraPreferences["workbar"] = {};
  for (const [type, layout] of Object.entries(workbar ?? {})) {
    if (!layout) continue;
    const commands = layout.commands
      ? Object.fromEntries(
          Object.entries(layout.commands).filter(([id, override]) => {
            if (knownCommandIds && !knownCommandIds.has(id)) return false;
            return Boolean(override && Object.values(override).some((value) => value !== undefined));
          }),
        )
      : undefined;
    const nextLayout = { ...layout };
    if (commands && Object.keys(commands).length > 0) {
      nextLayout.commands = commands;
    } else {
      delete nextLayout.commands;
    }
    result[type] = nextLayout;
  }
  return result;
}

export type PreferenceMergeOptions = {
  knownCommandIds?: ReadonlySet<string>;
};

function withPrunedWorkbar(
  values: Record<string, unknown>,
  knownCommandIds?: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isPlainObject(values.workbar)) return values;
  return {
    ...values,
    workbar: pruneWorkbarCommandOverrides(
      values.workbar as SpectraPreferences["workbar"],
      knownCommandIds,
    ),
  };
}

export function applyPreferencePatch(
  current: SpectraPreferences,
  patch: unknown,
  options: PreferenceMergeOptions = {},
): SpectraPreferences {
  const raw = objectRecord(patch);
  const sectionPatch = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== "version" && key in DEFAULT_SPECTRA_PREFERENCES),
  );
  const merged = withPrunedWorkbar(
    mergePreferenceValues(current, sectionPatch),
    options.knownCommandIds,
  );
  return spectraPreferencesSchema.parse({
    ...merged,
    version: PREFERENCE_SCHEMA_VERSION,
  });
}

export function remotePreferenceLayersAreReady(
  layers: readonly unknown[] | undefined,
): layers is readonly unknown[] {
  return Array.isArray(layers) && layers.length > 0;
}

export function resolvePreferences(
  layers: readonly ScopedPreferenceLayer[],
  options: PreferenceMergeOptions = {},
): SpectraPreferences {
  const ordered = layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => {
      const scopeOrder =
        PREFERENCE_SCOPE_ORDER.indexOf(left.layer.scope) -
        PREFERENCE_SCOPE_ORDER.indexOf(right.layer.scope);
      return scopeOrder || left.index - right.index;
    });
  return ordered.reduce<SpectraPreferences>(
    (current, { layer }) => applyPreferencePatch(current, layer.values, options),
    options.knownCommandIds
      ? applyPreferencePatch(DEFAULT_SPECTRA_PREFERENCES, {}, options)
      : DEFAULT_SPECTRA_PREFERENCES,
  );
}

export function updatePreference<K extends PreferenceSection>(
  preferences: SpectraPreferences,
  section: K,
  patch: Partial<SpectraPreferences[K]>,
  options: PreferenceMergeOptions = {},
): SpectraPreferences {
  return applyPreferencePatch(preferences, { [section]: patch }, options);
}

export function restoreDefaultPreferences(
  current: SpectraPreferences,
): SpectraPreferences {
  return {
    ...DEFAULT_SPECTRA_PREFERENCES,
    integrations: {
      ...DEFAULT_SPECTRA_PREFERENCES.integrations,
      classShelvesStatus: current.integrations.classShelvesStatus,
      classShelfRecordIds: [...current.integrations.classShelfRecordIds],
      tourStatus: current.integrations.tourStatus,
      tipsSeen: [...current.integrations.tipsSeen],
    },
  };
}
