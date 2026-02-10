type ProviderPresentation = {
  label: string;
  initial: string;
  background: string;
  foreground: string;
};

const PROVIDER_PRESETS: Array<{
  match: RegExp;
  label: string;
  initial: string;
  background: string;
  foreground: string;
}> = [
  { match: /openai/i, label: "OpenAI", initial: "O", background: "#0b0f1a", foreground: "#f3f6ff" },
  { match: /anthropic/i, label: "Anthropic", initial: "A", background: "#7a5c4b", foreground: "#fff5ed" },
  { match: /google|gemini/i, label: "Google", initial: "G", background: "#1a73e8", foreground: "#ffffff" },
  { match: /meta|llama/i, label: "Meta", initial: "M", background: "#0064e0", foreground: "#ffffff" },
  { match: /deepseek/i, label: "DeepSeek", initial: "D", background: "#2556f2", foreground: "#ffffff" },
  { match: /perplexity|sonar/i, label: "Perplexity", initial: "P", background: "#0f766e", foreground: "#ffffff" },
  { match: /mistral/i, label: "Mistral", initial: "M", background: "#f97316", foreground: "#111827" },
  { match: /x-ai|grok/i, label: "xAI", initial: "X", background: "#111827", foreground: "#f9fafb" },
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
      label: preset.label,
      initial: preset.initial,
      background: preset.background,
      foreground: preset.foreground,
    };
  }

  const provider = (providerHint || inferProviderFromModel(modelId)).trim();
  const initial = provider.slice(0, 1).toUpperCase() || "A";
  return {
    label: provider || "AI",
    initial,
    background: "#334155",
    foreground: "#f8fafc",
  };
}
