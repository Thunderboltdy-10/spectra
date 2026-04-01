const MODEL_REQUEST_PATTERN =
  /\b(?:use|with|via|switch to|try|run with|select)\s+([\w\s./:-]+(?:\s+[\w\s./:-]+){0,5}?)(?:\s+(?:model|for(?:\s+(?:this|now|the))?|to)\b|[.,!?]|$)/i;

const MODEL_KEYWORD_PATTERN =
  /\b(?:anthropic|claude|cohere|command-r|deepseek|gemini|gemma|google|gpt|haiku|kimi|llama|magistral|mercury|meta|minimax|mistral|mimo|moonshot|nemotron|nvidia|o1|o3|o4|openai|openrouter|opus|perplexity|phi|qwen|sonar|sonnet|xai|grok)\b/i;

const GPT_VARIANT_PATTERN = /\bgpt[- ]?\d+(?:\.\d+)?\b/i;

export const MODEL_ALIAS_QUERIES: Record<string, string> = {
  "claude": "anthropic claude sonnet",
  "claude sonnet": "anthropic claude sonnet",
  "claude opus": "anthropic claude opus",
  "claude haiku": "anthropic claude haiku",
  "gpt-4": "openai gpt-4o",
  "gpt4": "openai gpt-4o",
  "gpt 4": "openai gpt-4o",
  "gpt-4o": "openai gpt-4o",
  "gemini": "google gemini",
  "gemini pro": "google gemini pro",
  "gemini flash": "google gemini flash",
  "o3": "openai o3",
  "o4-mini": "openai o4 mini",
  "deepseek": "deepseek",
  "llama": "meta llama",
  "perplexity": "perplexity sonar",
};

export function normalizeModelPhrase(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”"']/g, "")
    .trim();
}

export function looksLikeModelRequestPhrase(phrase: string) {
  const normalizedPhrase = normalizeModelPhrase(phrase);
  if (!normalizedPhrase) return false;
  if (MODEL_ALIAS_QUERIES[normalizedPhrase]) return true;
  if (normalizedPhrase.includes("/") && /[a-z]/i.test(normalizedPhrase)) return true;
  return MODEL_KEYWORD_PATTERN.test(normalizedPhrase) || GPT_VARIANT_PATTERN.test(normalizedPhrase);
}

export function extractRequestedModelPhrase(message: string) {
  const requested = message.match(MODEL_REQUEST_PATTERN)?.[1]?.trim();
  if (!requested || !looksLikeModelRequestPhrase(requested)) {
    return undefined;
  }
  return requested;
}
