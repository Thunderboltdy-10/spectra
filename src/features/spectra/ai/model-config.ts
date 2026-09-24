export const SPECTRA_DEFAULT_MODEL_ID = "openai/gpt-5.6";
export const SPECTRA_DEFAULT_FALLBACK_MODEL_ID = "openai/gpt-5.6-luna";
export const SPECTRA_DEFAULT_REASONING_PROFILE = "high" as const;
export const SPECTRA_DEFAULT_VISION_MODEL_ID = "xiaomi/mimo-v2.5";
export const SPECTRA_PRIMARY_PROVIDER = "OpenAI" as const;
export const SPECTRA_VISION_PROVIDER = "Xiaomi" as const;
export const SPECTRA_FALLBACK_PROVIDERS = ["OpenAI"] as const;
export const SPECTRA_BLOCKED_PROVIDERS = ["DigitalOcean"] as const;

export type ModelAttachmentStrategy =
  "native" | "legacy_visual_prepass" | "automatic";
export type ModelProfile = {
  route: string;
  reasoningProfile: string;
  input: { text: boolean; image: boolean; pdf: boolean };
  tools: boolean;
  structuredOutput: boolean;
  serverTools: boolean;
};

function modelIdFromEnvironment(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value && /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:/-]*$/i.test(value)
    ? value
    : fallback;
}

export function getSpectraModelId() {
  return modelIdFromEnvironment("SPECTRA_MODEL_ID", SPECTRA_DEFAULT_MODEL_ID);
}

export function getSpectraFallbackModelId() {
  const primaryModelId = getSpectraModelId();
  const configuredFallbackModelId = modelIdFromEnvironment(
    "SPECTRA_FALLBACK_MODEL_ID",
    SPECTRA_DEFAULT_FALLBACK_MODEL_ID,
  );
  return resolveSpectraFallbackModelId(
    primaryModelId,
    configuredFallbackModelId,
  );
}

export function resolveSpectraFallbackModelId(
  primaryModelId: string,
  configuredFallbackModelId: string,
) {
  if (configuredFallbackModelId !== primaryModelId)
    return configuredFallbackModelId;
  return primaryModelId === SPECTRA_DEFAULT_MODEL_ID
    ? SPECTRA_DEFAULT_FALLBACK_MODEL_ID
    : SPECTRA_DEFAULT_MODEL_ID;
}

export function getSpectraReasoningProfile() {
  const value = process.env.SPECTRA_REASONING_PROFILE?.trim().toLowerCase();
  return value && ["low", "medium", "high"].includes(value)
    ? value
    : SPECTRA_DEFAULT_REASONING_PROFILE;
}

export function getSpectraModelProfile(): ModelProfile {
  return {
    route: getSpectraModelId(),
    reasoningProfile: getSpectraReasoningProfile(),
    input: { text: true, image: true, pdf: true },
    tools: true,
    structuredOutput: true,
    serverTools: true,
  };
}

export function getSpectraAttachmentStrategy(): ModelAttachmentStrategy {
  const value = process.env.SPECTRA_ATTACHMENT_STRATEGY?.trim();
  return value === "legacy_visual_prepass" || value === "automatic"
    ? value
    : "native";
}

export function getSpectraVisionModelId() {
  return modelIdFromEnvironment(
    "SPECTRA_VISION_MODEL_ID",
    SPECTRA_DEFAULT_VISION_MODEL_ID,
  );
}

export function getSpectraProviderRouting(
  mode: "primary" | "fallback" = "primary",
) {
  if (mode === "fallback")
    return {
      order: [...SPECTRA_FALLBACK_PROVIDERS],
      only: [...SPECTRA_FALLBACK_PROVIDERS],
      allow_fallbacks: true,
      require_parameters: true,
    } as const;
  return {
    order: [SPECTRA_PRIMARY_PROVIDER],
    only: [SPECTRA_PRIMARY_PROVIDER],
    allow_fallbacks: false,
  } as const;
}

export function getSpectraVisionProviderRouting() {
  return {
    order: [SPECTRA_VISION_PROVIDER],
    only: [SPECTRA_VISION_PROVIDER],
    allow_fallbacks: false,
  } as const;
}

export function allowSpectraProviderFallbacks() {
  return process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS !== "false";
}

export function assertPrimarySpectraRouting(
  routing: ReturnType<typeof getSpectraProviderRouting>,
) {
  if (
    routing.order[0] !== SPECTRA_PRIMARY_PROVIDER ||
    routing.only[0] !== SPECTRA_PRIMARY_PROVIDER ||
    routing.only.length !== 1 ||
    routing.allow_fallbacks !== false
  )
    throw new Error(
      "Spectra primary requests must use the configured OpenRouter model through OpenAI without provider substitution.",
    );
}

export const SPECTRA_MODEL_PROVIDER = SPECTRA_PRIMARY_PROVIDER;
export const SPECTRA_MODEL_GATEWAY = "openrouter" as const;
