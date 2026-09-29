/*
 * Spectra's model configuration comes only from the environment (.env.local in
 * development, the host's environment in production). Nothing here picks a
 * model, provider or reasoning level on its own: a missing or malformed value
 * fails loudly instead of silently running something else.
 *
 *   SPECTRA_MODEL_ID              OpenRouter model id for every Spectra turn
 *   SPECTRA_REASONING_PROFILE     none | minimal | low | medium | high | xhigh
 *   SPECTRA_MODEL_PROVIDER        OpenRouter provider that serves the model
 *   SPECTRA_FALLBACK_MODEL_ID     optional; model used on the recovery route
 *   SPECTRA_FALLBACK_PROVIDERS    optional; comma-separated recovery providers
 *   SPECTRA_ALLOW_PROVIDER_FALLBACKS  "false" disables the recovery route
 */

export const SPECTRA_REASONING_PROFILES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export type SpectraReasoningProfile =
  (typeof SPECTRA_REASONING_PROFILES)[number];

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:/-]*$/i;

export type ModelProfile = {
  route: string;
  reasoningProfile: SpectraReasoningProfile;
  input: { text: boolean; image: boolean; pdf: boolean };
  tools: boolean;
  structuredOutput: boolean;
  serverTools: boolean;
};

function configured(name: string) {
  return process.env[name]?.trim() || "";
}

function configError(name: string, problem: string): Error {
  return new Error(
    `SPECTRA_MODEL_CONFIG_INVALID: ${name} ${problem}. Set it in .env.local (see .env.example).`,
  );
}

function modelIdFromEnvironment(name: string) {
  const value = configured(name);
  if (!value) return "";
  if (!MODEL_ID_PATTERN.test(value))
    throw configError(name, `must be an OpenRouter model id like "vendor/model"`);
  return value;
}

export function getSpectraModelId() {
  const value = modelIdFromEnvironment("SPECTRA_MODEL_ID");
  if (!value) throw configError("SPECTRA_MODEL_ID", "is not set");
  return value;
}

/** The recovery route's model: the configured fallback, else the primary. */
export function getSpectraFallbackModelId() {
  return (
    modelIdFromEnvironment("SPECTRA_FALLBACK_MODEL_ID") || getSpectraModelId()
  );
}

export function getSpectraReasoningProfile(): SpectraReasoningProfile {
  const value = configured("SPECTRA_REASONING_PROFILE").toLowerCase();
  if (!value) throw configError("SPECTRA_REASONING_PROFILE", "is not set");
  if (!(SPECTRA_REASONING_PROFILES as readonly string[]).includes(value))
    throw configError(
      "SPECTRA_REASONING_PROFILE",
      `must be one of ${SPECTRA_REASONING_PROFILES.join(", ")}`,
    );
  return value as SpectraReasoningProfile;
}

export function getSpectraPrimaryProvider() {
  const value = configured("SPECTRA_MODEL_PROVIDER");
  if (!value) throw configError("SPECTRA_MODEL_PROVIDER", "is not set");
  return value;
}

/** Recovery providers, in order; defaults to the primary provider alone. */
export function getSpectraFallbackProviders() {
  const listed = configured("SPECTRA_FALLBACK_PROVIDERS")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  return listed.length > 0 ? listed : [getSpectraPrimaryProvider()];
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

export function getSpectraProviderRouting(
  mode: "primary" | "fallback" = "primary",
) {
  if (mode === "fallback") {
    const providers = getSpectraFallbackProviders();
    return {
      order: [...providers],
      only: [...providers],
      allow_fallbacks: true,
      require_parameters: true,
    } as const;
  }
  const primary = getSpectraPrimaryProvider();
  return {
    order: [primary],
    only: [primary],
    allow_fallbacks: false,
  } as const;
}

export function allowSpectraProviderFallbacks() {
  return process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS !== "false";
}

export function assertPrimarySpectraRouting(
  routing: ReturnType<typeof getSpectraProviderRouting>,
) {
  const primary = getSpectraPrimaryProvider();
  if (
    routing.order[0] !== primary ||
    routing.only[0] !== primary ||
    routing.only.length !== 1 ||
    routing.allow_fallbacks !== false
  )
    throw new Error(
      `Spectra primary requests must use the configured OpenRouter model through ${primary} without provider substitution.`,
    );
}

