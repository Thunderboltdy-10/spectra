export const SPECTRA_DEFAULT_MODEL_ID = "deepseek/deepseek-v4-pro";
/**
 * Vision is handled by MiMo V2.5 (Xiaomi). DeepSeek V4 Pro has no reliable
 * OpenRouter vision route through the native DeepSeek provider, so image
 * attachments are analysed by MiMo first; the text evidence packet is then
 * passed into the DeepSeek planning turn.
 */
export const SPECTRA_DEFAULT_VISION_MODEL_ID = "xiaomi/mimo-v2.5";
/** OpenRouter native provider slug for DeepSeek (must match provider.order/only). */
export const SPECTRA_PRIMARY_PROVIDER = "deepseek" as const;
/** OpenRouter provider slug for Spectra vision evidence (MiMo). */
export const SPECTRA_VISION_PROVIDER = "Xiaomi" as const;
/**
 * Emergency-only recovery routes for the same DeepSeek model id.
 * A fallback firing during normal acceptance tests is a defect to diagnose —
 * these routes must never mask primary DeepSeek provider failures.
 */
export const SPECTRA_FALLBACK_PROVIDERS = [
  "baidu",
  "streamlake",
  "deepinfra",
] as const;
/** Providers never eligible for Spectra production traffic. */
export const SPECTRA_BLOCKED_PROVIDERS = ["DigitalOcean"] as const;

function modelIdFromEnvironment(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value && /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:/-]*$/i.test(value)
    ? value
    : fallback;
}

export function getSpectraModelId() {
  return modelIdFromEnvironment("SPECTRA_MODEL_ID", SPECTRA_DEFAULT_MODEL_ID);
}

export function getSpectraVisionModelId() {
  return modelIdFromEnvironment(
    "SPECTRA_VISION_MODEL_ID",
    SPECTRA_DEFAULT_VISION_MODEL_ID,
  );
}

/**
 * Primary calls are restricted to the native DeepSeek OpenRouter route.
 * Fallback mode lists emergency providers that still serve the configured
 * DeepSeek model id after a genuine primary transport/provider failure.
 */
export function getSpectraProviderRouting(
  mode: "primary" | "fallback" = "primary",
) {
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

export function getSpectraVisionProviderRouting() {
  return {
    order: [SPECTRA_VISION_PROVIDER],
    only: [SPECTRA_VISION_PROVIDER],
    allow_fallbacks: false,
  } as const;
}

export function allowSpectraProviderFallbacks() {
  // Availability recovery keeps the configured model unchanged.
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
      "Spectra primary requests must use the native DeepSeek OpenRouter route and disable provider fallbacks on the primary call.",
    );
}

export const SPECTRA_MODEL_PROVIDER = "deepseek" as const;
export const SPECTRA_MODEL_GATEWAY = "openrouter" as const;
