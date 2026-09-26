"use client";

import { SMART_COMPLETION_TARGET } from "../actions/protocol/semantic-action";

export type SettingsToggleActionPoint = {
  signal: AbortSignal;
  /** Paces the already-claimed operation and resolves only after the transport
   * has read its canonical receipt. Does not invoke the human settings writer. */
  reachActionPoint: () => Promise<void>;
};

export type SettingsToggleControl = {
  element: HTMLButtonElement;
  perform: (action: SettingsToggleActionPoint) => Promise<void>;
};

const controls = new Map<HTMLButtonElement, SettingsToggleControl>();

/** The actual mounted Switch registers its handler. Looking up a selector or
 * dispatching a synthetic click cannot stand in for this control contract. */
export function registerSettingsToggleControl(
  element: HTMLButtonElement,
  refreshConfirmedPreferences: () => Promise<void>,
): () => void {
  const lifetime = new AbortController();
  const control: SettingsToggleControl = {
    element,
    async perform(action) {
      const assertCurrent = () => {
        if (action.signal.aborted || lifetime.signal.aborted ||
          !element.isConnected || controls.get(element) !== control)
          throw new Error("SETTINGS_CONTROL_UNAVAILABLE");
      };
      assertCurrent();
      await action.reachActionPoint();
      // A terminal run event can abort its local performer in the same feed
      // batch as the canonical receipt. Still refresh the mounted control's
      // accepted state; cancellation must not suppress a successful save.
      if (lifetime.signal.aborted || !element.isConnected || controls.get(element) !== control)
        throw new Error("SETTINGS_CONTROL_UNAVAILABLE");
      // Read accepted server state; never set `checked` from the offered value
      // and never call the human writeLayer path after an AI receipt.
      await refreshConfirmedPreferences();
    },
  };
  controls.set(element, control);
  return () => {
    lifetime.abort();
    if (controls.get(element) === control) controls.delete(element);
  };
}

export function settingsToggleControls(): readonly SettingsToggleControl[] {
  return [...controls.values()].filter(({ element }) =>
    element.isConnected && element.dataset.spectraAiTarget === SMART_COMPLETION_TARGET,
  );
}
