export const SPECTRA_DEFAULT_MODEL_ID = "xiaomi/mimo-v2.5-pro";
export const SPECTRA_DEFAULT_VISION_MODEL_ID = "xiaomi/mimo-v2.5";
export const SPECTRA_PRIMARY_PROVIDER = "Xiaomi" as const;
export const SPECTRA_FALLBACK_PROVIDERS = ["AtlasCloud"] as const;
export const SPECTRA_BLOCKED_PROVIDERS = ["DigitalOcean", "DeepInfra"] as const;

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

// The native Xiaomi route is kept stable for cache locality. AtlasCloud is
// used only after a genuine transport/provider failure and serves the exact
// same model. Expensive endpoints remain explicitly excluded as a second
// guard even though `only` already restricts the eligible route.
export function getSpectraProviderRouting(
  mode: "primary" | "fallback" = "primary",
) {
  const providers =
    mode === "fallback"
      ? [...SPECTRA_FALLBACK_PROVIDERS]
      : [SPECTRA_PRIMARY_PROVIDER];
  return {
    order: providers,
    only: providers,
    ignore: [...SPECTRA_BLOCKED_PROVIDERS],
    allow_fallbacks: false,
    require_parameters: true,
  } as const;
}

export function getSpectraVisionProviderRouting() {
  return {
    order: [SPECTRA_PRIMARY_PROVIDER],
    only: [SPECTRA_PRIMARY_PROVIDER],
    ignore: [...SPECTRA_BLOCKED_PROVIDERS],
    allow_fallbacks: false,
    require_parameters: true,
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
    routing.allow_fallbacks !== false ||
    SPECTRA_BLOCKED_PROVIDERS.some(
      (provider) => !routing.ignore.includes(provider),
    )
  )
    throw new Error(
      "Spectra primary requests must use the configured native provider and exclude blocked endpoints.",
    );
}

export const SPECTRA_MODEL_PROVIDER = "xiaomi" as const;
export const SPECTRA_MODEL_GATEWAY = "openrouter" as const;
