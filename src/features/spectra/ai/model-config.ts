export const SPECTRA_DEFAULT_MODEL_ID = "deepseek/deepseek-v4-pro";

export function getSpectraModelId() {
  return SPECTRA_DEFAULT_MODEL_ID;
}

// Raw OpenRouter API payload shape. The official SDK uses allowFallbacks,
// while the REST API used by Spectra requires allow_fallbacks.
export const SPECTRA_OPENROUTER_PROVIDER_ROUTING = {
  order: ["deepseek"],
  allow_fallbacks: true,
} as const;

// Provider identity stays tied to the model vendor. OpenRouter is only the gateway.
export const SPECTRA_MODEL_PROVIDER = "deepseek" as const;
export const SPECTRA_MODEL_GATEWAY = "openrouter" as const;
