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
