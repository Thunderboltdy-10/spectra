type GuardrailModel = {
  modelId: string;
  name?: string;
  description?: string;
  provider?: string;
  createdAt?: number;
  releaseDate?: string;
  contextLength?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  tags?: string[];
  reasoningRating?: "low" | "medium" | "high";
  capabilities?: {
    reasoning?: number;
  };
};

const NON_TEXT_MODEL_PATTERN =
  /\b(audio|speech|voice|music|song|audio-song|tts|stt|transcrib|transcript|whisper|voiceover|lyria|lyra|gemini-lyra|text-to-speech|speech-to-text|text-to-video|video[-_ ]gen|video[-_ ]only|veo|sora|lip[-_ ]sync)\b/i;
const HARD_AUDIO_FAMILY_PATTERN =
  /\b(lyria|lyra|gemini-lyra|music|song[-_ ]?gen|audio[-_ ]?gen)\b/i;
const SMALL_MODEL_PATTERN = /\b(1b|2b|3b|4b|6b|7b|8b|9b|12b|14b|16b)\b/i;
const EXEMPT_SMALL_MODEL_PATTERN = /\b(gpt-oss-120b|qwen3-next-80b|kimi-k2|deepseek-r1)\b/i;
const FRONTIER_OPEN_SOURCE_PATTERN =
  /\b(qwen3|qwen2\.5|qwen-max|deepseek-r1|deepseek-v3|kimi-k2|glm-4\.5|glm-4\.6|gpt-oss-120b|llama-4|mistral-large)\b/i;

function normalizeModalities(values?: string[]) {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function supportsTextInOut(model: GuardrailModel) {
  const input = normalizeModalities(model.inputModalities);
  const output = normalizeModalities(model.outputModalities);
  if (input.size === 0 && output.size === 0) return null;
  return input.has("text") && output.has("text");
}

function modelBlob(model: GuardrailModel) {
  return `${model.modelId} ${model.name ?? ""} ${model.description ?? ""} ${(model.tags ?? []).join(" ")}`
    .toLowerCase();
}

export function isFrontierOpenSourceModel(model: GuardrailModel) {
  return FRONTIER_OPEN_SOURCE_PATTERN.test(modelBlob(model));
}

function reasoningStrength(model: GuardrailModel) {
  const numeric = model.capabilities?.reasoning;
  if (typeof numeric === "number" && Number.isFinite(numeric)) {
    return Math.max(0, Math.min(1, numeric / 10));
  }
  if (model.reasoningRating === "high") return 0.9;
  if (model.reasoningRating === "medium") return 0.6;
  if (model.reasoningRating === "low") return 0.25;
  return 0.45;
}

function parseModelTimestamp(model: GuardrailModel) {
  if (typeof model.createdAt === "number" && Number.isFinite(model.createdAt)) {
    return model.createdAt;
  }
  if (typeof model.releaseDate === "string" && model.releaseDate.trim()) {
    const parsed = Date.parse(model.releaseDate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function modelAgeDays(model: GuardrailModel) {
  const ts = parseModelTimestamp(model);
  if (typeof ts !== "number") return undefined;
  return Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
}

export function isFreshForAutoRouting(model: GuardrailModel, maxAgeDays = 90) {
  const age = modelAgeDays(model);
  // The hard cutoff applies to models proven older than the freshness window.
  // Missing catalog age metadata should not collapse auto routing to a generic fallback.
  if (typeof age !== "number") return true;
  return age <= maxAgeDays;
}

export function isNonTextOnlyModel(model: GuardrailModel) {
  const explicitText = supportsTextInOut(model);
  if (explicitText !== null) {
    return !explicitText;
  }
  return NON_TEXT_MODEL_PATTERN.test(modelBlob(model));
}

export function isHardAudioFamilyModel(model: GuardrailModel) {
  return HARD_AUDIO_FAMILY_PATTERN.test(modelBlob(model));
}

export function supportsDocumentReasoningModel(model: GuardrailModel) {
  return !isNonTextOnlyModel(model) && (model.contextLength ?? 0) >= 24_000;
}

export function failsTextQualityFloor(
  model: GuardrailModel,
  options?: {
    stakes?: "low" | "medium" | "high";
    mode?: string;
    messageLength?: number;
  },
) {
  const mode = (options?.mode ?? "").toLowerCase();
  if (mode === "image") return false;
  if (isNonTextOnlyModel(model)) return true;

  const blob = modelBlob(model);
  const contextLength = model.contextLength ?? 0;
  const reasoning = reasoningStrength(model);
  const stakes = options?.stakes ?? "medium";
  const shortPrompt = (options?.messageLength ?? 0) <= 400;
  const frontierOpenSource = isFrontierOpenSourceModel(model);
  const highStakeReasoningFloor = frontierOpenSource ? 0.48 : 0.55;
  const normalReasoningFloor = frontierOpenSource ? 0.36 : 0.42;
  const shortPromptReasoningFloor = frontierOpenSource ? 0.3 : 0.35;

  if (contextLength > 0 && contextLength < 12_000) return true;
  if (stakes === "high" && reasoning < highStakeReasoningFloor) return true;
  if (!shortPrompt && stakes !== "low" && reasoning < normalReasoningFloor) return true;
  if (shortPrompt && contextLength > 0 && contextLength < 24_000 && reasoning < shortPromptReasoningFloor) return true;

  if (SMALL_MODEL_PATTERN.test(blob) && !EXEMPT_SMALL_MODEL_PATTERN.test(blob) && !frontierOpenSource) {
    return true;
  }

  return false;
}
