"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Citation, RouteTrace } from "@/types";

export type PanelView = "settings" | "route-trace" | "sources" | null;

export type PanelData = {
  routeTrace?: RouteTrace;
  sources?: Citation[];
  whyThisResponse?: string;
  modelUsed?: string;
};

type PanelContextValue = {
  activeView: PanelView;
  panelData: PanelData;
  openPanel: (view: PanelView, data?: PanelData) => void;
  closePanel: () => void;
  togglePanel: (view: PanelView, data?: PanelData) => void;
};

const PanelContext = createContext<PanelContextValue | null>(null);

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [activeView, setActiveView] = useState<PanelView>(null);
  const [panelData, setPanelData] = useState<PanelData>({});

  const openPanel = useCallback((view: PanelView, data: PanelData = {}) => {
    setActiveView(view);
    setPanelData(data);
  }, []);

  const closePanel = useCallback(() => {
    setActiveView(null);
  }, []);

  const hasData = useCallback((data: PanelData) => {
    return Object.values(data).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null;
    });
  }, []);

  const togglePanel = useCallback((view: PanelView, data: PanelData = {}) => {
    if (activeView === view) {
      if (hasData(data)) {
        setPanelData((prev) => ({ ...prev, ...data }));
      } else {
        setActiveView(null);
      }
    } else {
      setActiveView(view);
      setPanelData(data);
    }
  }, [activeView, hasData]);

  return (
    <PanelContext.Provider
      value={{
        activeView,
        panelData,
        openPanel,
        closePanel,
        togglePanel,
      }}
    >
      {children}
    </PanelContext.Provider>
  );
}

export function usePanel() {
  const context = useContext(PanelContext);
  if (!context) {
    throw new Error("usePanel must be used within PanelProvider");
  }
  return context;
}
