export const SPECTRA_DEFAULT_MODEL_ID = "deepseek/deepseek-v4-pro";

export function getSpectraModelId() {
  return process.env.SPECTRA_MODEL_ID?.trim() || SPECTRA_DEFAULT_MODEL_ID;
}

export const SPECTRA_MODEL_PROVIDER = "openrouter" as const;

