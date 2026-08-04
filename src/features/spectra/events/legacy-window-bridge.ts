import { spectraBus } from ".";

const LEGACY_EVENTS = {
  "spectra:open-work": "work.open",
  "spectra:reveal-anchor": "work.revealAnchor",
  "spectra:open-run": "run.openConversation",
  "spectra:insert-reference": "reference.insert",
  "spectra:begin-context-picking": "context.beginPicking",
} as const;

export function installLegacyWindowCommandBridge(target: Window = window) {
  const cleanups = Object.entries(LEGACY_EVENTS).map(
    ([legacyName, commandName]) => {
      const listener = (event: Event) => {
        if (!(event instanceof CustomEvent)) return;
        spectraBus.command(commandName, event.detail as never);
      };
      target.addEventListener(legacyName, listener);
      return () => target.removeEventListener(legacyName, listener);
    },
  );
  return () => cleanups.forEach((cleanup) => cleanup());
}
