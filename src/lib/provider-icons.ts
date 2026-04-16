type ProviderPresentation = {
  key: string;
  label: string;
  initial: string;
  bgLight: string;
  bgDark: string;
  lightFill: string;
  darkFill: string;
};

const PROVIDER_PRESETS: Array<{
  key: string;
  match: RegExp;
  label: string;
  initial: string;
  bgLight: string;
  bgDark: string;
  lightFill: string;
  darkFill: string;
}> = [
  { key: "openai", match: /openai|gpt/i, label: "OpenAI", initial: "O", bgLight: "#eef6f3", bgDark: "#0c1613", lightFill: "#0f172a", darkFill: "#d8f3e8" },
  { key: "anthropic", match: /anthropic|claude/i, label: "Anthropic", initial: "A", bgLight: "#f5eee8", bgDark: "#1b140f", lightFill: "#623f2d", darkFill: "#f0dac9" },
  { key: "google", match: /google|gemini|gemma/i, label: "Google", initial: "G", bgLight: "#e8f0ff", bgDark: "#0d1b3b", lightFill: "#1a56db", darkFill: "#cfe0ff" },
  { key: "meta", match: /meta|llama/i, label: "Meta", initial: "M", bgLight: "#e8efff", bgDark: "#0d1735", lightFill: "#1144b6", darkFill: "#d6e1ff" },
  { key: "deepseek", match: /deepseek|r1/i, label: "DeepSeek", initial: "D", bgLight: "#ecf1ff", bgDark: "#121a36", lightFill: "#3456d1", darkFill: "#d7defb" },
  { key: "xai", match: /x\s?ai|grok/i, label: "xAI", initial: "X", bgLight: "#edf0f7", bgDark: "#151822", lightFill: "#111827", darkFill: "#e5e7eb" },
  { key: "cohere", match: /cohere/i, label: "Cohere", initial: "C", bgLight: "#f0f7ea", bgDark: "#142011", lightFill: "#345d1d", darkFill: "#d9efcb" },
  { key: "qwen", match: /qwen|alibaba/i, label: "Qwen", initial: "Q", bgLight: "#eef3ff", bgDark: "#131b33", lightFill: "#3556d6", darkFill: "#d9e4ff" },
  { key: "nous", match: /nous/i, label: "Nous", initial: "N", bgLight: "#f8ecff", bgDark: "#241334", lightFill: "#7b2cbf", darkFill: "#efd6ff" },
  { key: "01ai", match: /01\.ai|yi-/i, label: "01.AI", initial: "0", bgLight: "#ebf6ff", bgDark: "#132734", lightFill: "#0f6cbf", darkFill: "#ccecff" },
  { key: "databricks", match: /databricks/i, label: "Databricks", initial: "D", bgLight: "#ffedea", bgDark: "#341714", lightFill: "#c2410c", darkFill: "#ffd7cf" },
  { key: "ai21", match: /ai21/i, label: "AI21", initial: "A", bgLight: "#edf4f5", bgDark: "#142124", lightFill: "#256268", darkFill: "#d0eef2" },
  { key: "together", match: /together/i, label: "Together", initial: "T", bgLight: "#f1f1ff", bgDark: "#191933", lightFill: "#4043c8", darkFill: "#d7d9ff" },
  { key: "perplexity", match: /perplexity|sonar/i, label: "Perplexity", initial: "P", bgLight: "#e7f8f7", bgDark: "#102523", lightFill: "#0f766e", darkFill: "#bcebe7" },
  { key: "mistral", match: /mistral|mixtral/i, label: "Mistral", initial: "M", bgLight: "#fff0e8", bgDark: "#331d12", lightFill: "#c25514", darkFill: "#ffd9c2" },
  { key: "openrouter", match: /openrouter/i, label: "OpenRouter", initial: "R", bgLight: "#ecf7f5", bgDark: "#12231f", lightFill: "#0f766e", darkFill: "#bfe7df" },
  { key: "zai", match: /z-ai|glm/i, label: "Z-AI", initial: "Z", bgLight: "#eef2ff", bgDark: "#141935", lightFill: "#3949ab", darkFill: "#d6dcff" },
  { key: "moonshot", match: /moonshot|kimi/i, label: "Moonshot", initial: "K", bgLight: "#e9f5ff", bgDark: "#122433", lightFill: "#0a6bb5", darkFill: "#d3ecff" },
  { key: "nvidia", match: /nvidia|nemotron/i, label: "NVIDIA", initial: "N", bgLight: "#eff9e8", bgDark: "#14260f", lightFill: "#3a7d1c", darkFill: "#d8f5c8" },
  { key: "groq", match: /\bgroq\b/i, label: "Groq", initial: "G", bgLight: "#f1f5f9", bgDark: "#151a22", lightFill: "#0f172a", darkFill: "#e2e8f0" },
  { key: "cerebras", match: /cerebras/i, label: "Cerebras", initial: "C", bgLight: "#eaf3ff", bgDark: "#112136", lightFill: "#174ea6", darkFill: "#cfe0ff" },
  { key: "fireworks", match: /fireworks/i, label: "Fireworks", initial: "F", bgLight: "#fff1e8", bgDark: "#31190f", lightFill: "#c05621", darkFill: "#ffd8c4" },
  { key: "deepinfra", match: /deepinfra/i, label: "DeepInfra", initial: "D", bgLight: "#edf4ff", bgDark: "#121b31", lightFill: "#2f4fb0", darkFill: "#d8e4ff" },
  { key: "sambanova", match: /sambanova/i, label: "SambaNova", initial: "S", bgLight: "#f2f7ec", bgDark: "#192515", lightFill: "#406329", darkFill: "#d9ebcb" },
  { key: "minimax", match: /minimax/i, label: "MiniMax", initial: "M", bgLight: "#f0f1ff", bgDark: "#181a33", lightFill: "#4338ca", darkFill: "#c7d2fe" },
  { key: "stepfun", match: /stepfun/i, label: "Stepfun", initial: "S", bgLight: "#f5f3ff", bgDark: "#1e1b4b", lightFill: "#4f46e5", darkFill: "#e0e7ff" },
  { key: "bytedance", match: /bytedance|doubao/i, label: "ByteDance", initial: "B", bgLight: "#fdf4ff", bgDark: "#2e1065", lightFill: "#9333ea", darkFill: "#fae8ff" },
  { key: "arcee", match: /arcee/i, label: "Arcee", initial: "A", bgLight: "#fff1f2", bgDark: "#4c0519", lightFill: "#e11d48", darkFill: "#ffe4e6" },
];

export function inferProviderFromModel(modelId?: string) {
  if (!modelId) return "AI";
  return modelId.split("/")[0] || "AI";
}

export function getProviderPresentation(modelId?: string, providerHint?: string): ProviderPresentation {
  const source = `${providerHint ?? ""} ${modelId ?? ""}`.trim();
  const preset = PROVIDER_PRESETS.find((item) => item.match.test(source));
  if (preset) {
    return {
      key: preset.key,
      label: preset.label,
      initial: preset.initial,
      bgLight: preset.bgLight,
      bgDark: preset.bgDark,
      lightFill: preset.lightFill,
      darkFill: preset.darkFill,
    };
  }

  const provider = (providerHint || inferProviderFromModel(modelId)).trim();
  const initial = provider.slice(0, 1).toUpperCase() || "A";
  return {
    key: provider.toLowerCase(),
    label: provider || "AI",
    initial,
    bgLight: "#e2e8f0",
    bgDark: "#1e293b",
    lightFill: "#0f172a",
    darkFill: "#f1f5f9",
  };
}
