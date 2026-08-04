import {
  browserComputeProfile,
  chooseComputePath,
  isConstrainedDevice,
  type DeviceComputeProfile,
} from "../broker";

export type AutocompleteSurface =
  | "quick_chat"
  | "document"
  | "comment"
  | "description"
  | "plan_note"
  | "quiz_card_text"
  | "slide_text"
  | "agent_foundry"
  | "prose";

export type AutocompleteContext = {
  value: string;
  cursor: number;
  surface: AutocompleteSurface;
  recentPhrases?: readonly string[];
  workspaceTerms?: readonly string[];
};

export type AutocompleteSuggestion = {
  text: string;
  tier: "deterministic" | "compact_local";
  localOnly: true;
};

const COMMON_CONTINUATIONS = [
  ["in order to", " clarify the expected outcome"],
  ["for example", ", the strongest evidence should be cited directly"],
  ["the next step is", " to verify the result and record any limitation"],
  ["this means", " the final decision remains easy to understand"],
  ["because", " the available evidence supports that conclusion"],
] as const;

export function deterministicSuggestion(
  context: AutocompleteContext,
): AutocompleteSuggestion | null {
  const before = context.value.slice(0, context.cursor);
  if (before.length < 8 || /(?:https?:\/\/|\b\d{4}-\d{2}-\d{2}|\b\w+@\w+)$/i.test(before)) return null;
  const lower = before.toLowerCase();
  const candidates = [
    ...(context.recentPhrases ?? []),
    ...(context.workspaceTerms ?? []),
  ]
    .map((value) => value.trim())
    .filter((value) => value.length >= 4 && value.length <= 100);
  const lastWords = lower.match(/[\p{L}\p{N}'’-]{2,}(?:\s+[\p{L}\p{N}'’-]{2,}){0,3}$/u)?.[0] ?? "";
  const repeated = candidates.find((candidate) => {
    const candidateLower = candidate.toLowerCase();
    return lastWords.length >= 3 && candidateLower.startsWith(lastWords) && candidateLower !== lastWords;
  });
  if (repeated) return { text: repeated.slice(lastWords.length), tier: "deterministic", localOnly: true };
  const continuation = COMMON_CONTINUATIONS.find(([prefix]) => lower.endsWith(prefix));
  return continuation
    ? { text: continuation[1], tier: "deterministic", localOnly: true }
    : null;
}

export function nextSuggestionWord(text: string) {
  const match = text.match(/^(\s*\S+\s*)/u);
  return match?.[1] ?? text;
}

export type AutocompleteSessionState = {
  suggestion: AutocompleteSuggestion | null;
  composing: boolean;
  remoteApplying: boolean;
  consecutiveDismissals: number;
};

export function createAutocompleteSession() {
  let state: AutocompleteSessionState = {
    suggestion: null,
    composing: false,
    remoteApplying: false,
    consecutiveDismissals: 0,
  };
  return {
    get state() {
      return state;
    },
    setComposition(composing: boolean) {
      state = { ...state, composing, ...(composing ? { suggestion: null } : {}) };
    },
    setRemoteApplying(remoteApplying: boolean) {
      state = { ...state, remoteApplying, ...(remoteApplying ? { suggestion: null } : {}) };
    },
    offer(suggestion: AutocompleteSuggestion | null) {
      state = {
        ...state,
        suggestion:
          state.composing || state.remoteApplying || state.consecutiveDismissals >= 3
            ? null
            : suggestion,
      };
      return state.suggestion;
    },
    dismiss() {
      state = {
        ...state,
        suggestion: null,
        consecutiveDismissals: state.consecutiveDismissals + 1,
      };
    },
    resetDismissals() {
      state = { ...state, consecutiveDismissals: 0 };
    },
    accept(value: string, mode: "word" | "all") {
      if (!state.suggestion) return value;
      const accepted = mode === "word"
        ? nextSuggestionWord(state.suggestion.text)
        : state.suggestion.text;
      const remaining = state.suggestion.text.slice(accepted.length);
      state = {
        ...state,
        suggestion: remaining
          ? { ...state.suggestion, text: remaining }
          : null,
        consecutiveDismissals: 0,
      };
      return `${value}${accepted}`;
    },
  };
}

export function autocompleteTier(device: DeviceComputeProfile) {
  if (!device.worker || !device.wasm) return 1 as const;
  return isConstrainedDevice(device) ? 1 as const : 2 as const;
}

export type LocalAutocompleteHandle = {
  result: Promise<AutocompleteSuggestion | null>;
  cancel: () => void;
  tier: 1 | 2 | 3;
};

export function requestLocalAutocomplete(
  context: AutocompleteContext,
  device = browserComputeProfile(),
): LocalAutocompleteHandle {
  const tier = autocompleteTier(device);
  const decision = chooseComputePath({
    task: "autocomplete",
    inputBytes: new TextEncoder().encode(context.value).byteLength,
    preference: "auto",
    device,
    privacy: "local_required",
    cancellable: true,
  });
  if (decision.path !== "local_worker") {
    return { result: Promise.resolve(null), cancel: () => {}, tier: 3 };
  }
  const worker = new Worker(new URL("./autocomplete.worker.ts", import.meta.url), {
    type: "module",
    name: "spectra-local-autocomplete",
  });
  let rejectTask: (reason?: unknown) => void = () => {};
  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
  };
  const result = new Promise<AutocompleteSuggestion | null>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<{ suggestion: string | null }>) => {
      resolve(event.data.suggestion ? { text: event.data.suggestion, tier: "compact_local", localOnly: true } : null);
      cleanup();
    };
    worker.onerror = () => {
      resolve(null);
      cleanup();
    };
    worker.postMessage({ ...context, tier });
  });
  return {
    result,
    tier: 2,
    cancel: () => {
      rejectTask(new DOMException("Autocomplete was cancelled.", "AbortError"));
      cleanup();
    },
  };
}
