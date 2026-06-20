export const SPECTRA_DEFAULT_MODEL_ID = "deepseek/deepseek-v4-pro";

export function getSpectraModelId() {
  return process.env.SPECTRA_MODEL_ID?.trim() || SPECTRA_DEFAULT_MODEL_ID;
}

// Provider identity stays tied to the model vendor. OpenRouter is only the gateway.
export const SPECTRA_MODEL_PROVIDER = "deepseek" as const;
export const SPECTRA_MODEL_GATEWAY = "openrouter" as const;
