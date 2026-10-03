/* Spectra reads its model, provider and reasoning level only from the environment
 * (see src/features/spectra/ai/model-config.ts). Tests pin a known configuration so a
 * developer's shell or .env.local cannot change what the suites assert. */
Object.assign(process.env, {
  SPECTRA_MODEL_ID: "openai/gpt-5.6",
  SPECTRA_FALLBACK_MODEL_ID: "openai/gpt-5.6-luna",
  SPECTRA_REASONING_PROFILE: "xhigh",
  SPECTRA_MODEL_PROVIDER: "OpenAI",
  SPECTRA_FALLBACK_PROVIDERS: "OpenAI",
  SPECTRA_EMBEDDING_MODEL: "openai/text-embedding-3-small",
  SPECTRA_EMBEDDING_PROVIDER: "OpenAI",
});

type MediaListener = (event: MediaQueryListEvent) => unknown;

const createMatchMediaList = (query: string): MediaQueryList => {
  let listener: MediaListener | null = null;
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: (next: MediaListener) => {
      listener = next;
    },
    removeListener: (next: MediaListener) => {
      if (listener === next) listener = null;
    },
    addEventListener: (_type: string, next: EventListenerOrEventListenerObject | null) => {
      listener = typeof next === "function" ? next as MediaListener : null;
    },
    removeEventListener: (_type: string, next: EventListenerOrEventListenerObject | null) => {
      if (listener === next) listener = null;
    },
    dispatchEvent: (event) => {
      listener?.(event as MediaQueryListEvent);
      return true;
    },
  };
};

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: createMatchMediaList,
  });
}

export {};
