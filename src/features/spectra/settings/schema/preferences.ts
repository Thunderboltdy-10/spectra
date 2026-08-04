import { z } from "zod";

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
  openConversationAfterSend: z.boolean().default(false),
  showLiveDockProgress: z.boolean().default(true),
  autoRouteSpecialists: z.boolean().default(true),
  parallelSafeReads: z.boolean().default(true),
  researchDepth: z.enum(["automatic", "quick", "verified", "deep"]).default("automatic"),
  reasoningProfile: z.enum(["configured_maximum", "balanced", "fast"]).default("configured_maximum"),
  reversibleLowRiskAutonomy: z.boolean().default(true),
  notifyRequiredInput: z.boolean().default(true),
  notifyRunCompletion: z.boolean().default(true),
  retainCompletedRunTabs: z.boolean().default(true),
  completedRunRetentionMinutes: z.number().int().min(5).max(1_440).default(30),
  expandRequiredInput: z.boolean().default(true),
  newThreadShortcut: z.enum(["modifier_enter", "shift_enter", "menu_only"]).default("modifier_enter"),
  showProviderDiagnostics: z.boolean().default(false),
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
}).strict();

export type SpectraPreferences = z.infer<typeof spectraPreferencesSchema>;
export type PreferenceSection = Exclude<keyof SpectraPreferences, "version">;
type PartialSections = {
  [K in PreferenceSection]?: Partial<SpectraPreferences[K]>;
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

function mergeSection<T extends object>(current: T, next: Partial<T> | undefined): T {
  return next ? { ...current, ...next } : current;
}

export function resolvePreferences(layers: readonly ScopedPreferenceLayer[]): SpectraPreferences {
  const ordered = layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => {
      const scopeOrder =
        PREFERENCE_SCOPE_ORDER.indexOf(left.layer.scope) -
        PREFERENCE_SCOPE_ORDER.indexOf(right.layer.scope);
      return scopeOrder || left.index - right.index;
    });
  return ordered.reduce<SpectraPreferences>(
    (current, { layer }) => ({
      version: PREFERENCE_SCHEMA_VERSION,
      general: mergeSection(current.general, layer.values.general),
      ai: mergeSection(current.ai, layer.values.ai),
      writing: mergeSection(current.writing, layer.values.writing),
      collaboration: mergeSection(current.collaboration, layer.values.collaboration),
      appearance: mergeSection(current.appearance, layer.values.appearance),
      compute: mergeSection(current.compute, layer.values.compute),
      notifications: mergeSection(current.notifications, layer.values.notifications),
      privacy: mergeSection(current.privacy, layer.values.privacy),
      integrations: mergeSection(current.integrations, layer.values.integrations),
      accessibility: mergeSection(current.accessibility, layer.values.accessibility),
    }),
    DEFAULT_SPECTRA_PREFERENCES,
  );
}

export function updatePreference<K extends PreferenceSection>(
  preferences: SpectraPreferences,
  section: K,
  patch: Partial<SpectraPreferences[K]>,
): SpectraPreferences {
  return spectraPreferencesSchema.parse({
    ...preferences,
    [section]: { ...preferences[section], ...patch },
  });
}
