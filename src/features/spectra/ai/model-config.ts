export const SPECTRA_DEFAULT_MODEL_ID = "deepseek/deepseek-v4-pro";
export const SPECTRA_PRIMARY_PROVIDER = "deepseek" as const;
export const SPECTRA_FALLBACK_PROVIDERS = ["baidu", "streamlake", "deepinfra"] as const;

export function getSpectraModelId() {
  return SPECTRA_DEFAULT_MODEL_ID;
}

// Raw OpenRouter API payload shape. The native endpoint currently rejects the
// strict json_schema mode, so the primary call is provider-locked and validated
// by Spectra. A separate request policy is used only after a provider failure.
export function getSpectraProviderRouting(mode: "primary" | "fallback" = "primary") {
  if (mode === "fallback") {
    return {
      order: [...SPECTRA_FALLBACK_PROVIDERS],
      only: [...SPECTRA_FALLBACK_PROVIDERS],
      allow_fallbacks: true,
      require_parameters: true,
    } as const;
  }
  return {
    order: [SPECTRA_PRIMARY_PROVIDER],
    only: [SPECTRA_PRIMARY_PROVIDER],
    allow_fallbacks: false,
  } as const;
}

export function allowSpectraProviderFallbacks() {
  return process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS !== "false";
}

export function assertPrimarySpectraRouting(routing: ReturnType<typeof getSpectraProviderRouting>) {
  if (routing.order[0] !== SPECTRA_PRIMARY_PROVIDER || routing.only[0] !== SPECTRA_PRIMARY_PROVIDER || routing.only.length !== 1 || routing.allow_fallbacks !== false) {
    throw new Error("Spectra primary requests must be restricted to the native DeepSeek provider.");
  }
}

// Provider identity stays tied to the model vendor. OpenRouter is only the gateway.
export const SPECTRA_MODEL_PROVIDER = "deepseek" as const;
export const SPECTRA_MODEL_GATEWAY = "openrouter" as const;
