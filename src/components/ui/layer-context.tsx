"use client";

import * as React from "react";
import { LAYERS, type SpectraLayer } from "./layers";

/**
 * The layer of the surface a control sits in.
 *
 * A menu, popover or select list portals to the body, so it cannot inherit
 * stacking from the dialog or sheet it was opened from. The layer contract
 * used to ask every call site to pass the host's layer by hand; the ones that
 * forgot opened their list *behind* the dialog (a `dropdown` list under a
 * `modal` veil), where it could not be seen or used. Dialog and Sheet now
 * publish their layer here, and every floating primitive opens at the higher
 * of that layer and `dropdown` unless it names one explicitly. Same-layer
 * portals paint in open order, so the list floats over its host.
 */
const HostLayerContext = React.createContext<SpectraLayer | null>(null);

export function HostLayer({
  layer,
  children,
}: {
  layer: SpectraLayer;
  children: React.ReactNode;
}) {
  return (
    <HostLayerContext.Provider value={layer}>
      {children}
    </HostLayerContext.Provider>
  );
}

export function resolveFloatingLayer(
  explicit: SpectraLayer | undefined,
  host: SpectraLayer | null,
): SpectraLayer {
  if (explicit) return explicit;
  if (host && LAYERS.indexOf(host) > LAYERS.indexOf("dropdown")) return host;
  return "dropdown";
}

export function useFloatingLayer(explicit?: SpectraLayer): SpectraLayer {
  return resolveFloatingLayer(explicit, React.useContext(HostLayerContext));
}

type AutoFocusHandler = (event: Event) => void;

/**
 * Focus return for a controlled modal surface.
 *
 * Radix returns focus only to a `Dialog.Trigger`. Spectra opens most dialogs
 * and sheets from state (a row action, a command, a confirmation), with no
 * trigger, so closing one dropped focus on <body> and a keyboard user lost
 * their place. This remembers what held focus when the surface opened and
 * returns it on close, unless the consumer handled close focus itself.
 */
export function useFocusReturn(
  onOpenAutoFocus?: AutoFocusHandler,
  onCloseAutoFocus?: AutoFocusHandler,
): { onOpenAutoFocus: AutoFocusHandler; onCloseAutoFocus: AutoFocusHandler } {
  const returnTo = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      const active = document.activeElement;
      returnTo.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const target = returnTo.current;
      returnTo.current = null;
      if (!target?.isConnected) return;
      event.preventDefault();
      target.focus({ preventScroll: true });
    },
  };
}
