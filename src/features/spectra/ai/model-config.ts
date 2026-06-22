export const SPECTRA_DEFAULT_MODEL_ID = "deepseek/deepseek-v4-pro";

export function getSpectraModelId() {
  return SPECTRA_DEFAULT_MODEL_ID;
}

// Raw OpenRouter API payload shape. The official SDK uses allowFallbacks,
// while the REST API used by Spectra requires allow_fallbacks.
export function getSpectraProviderRouting() {
  return {
    order: ["deepseek"],
    // DeepSeek is preferred, but a temporary native endpoint outage must not make
    // the entire product unavailable. Set the variable to "false" only for
    // diagnostics that intentionally require the native endpoint.
    allow_fallbacks: process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS !== "false",
    require_parameters: true,
  } as const;
}

// Provider identity stays tied to the model vendor. OpenRouter is only the gateway.
export const SPECTRA_MODEL_PROVIDER = "deepseek" as const;
export const SPECTRA_MODEL_GATEWAY = "openrouter" as const;
