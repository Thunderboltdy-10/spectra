"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Citation, RouteTrace } from "@/types";
import type { ParsedQuizQuestion } from "@/lib/quiz-parser";

export type PanelView = "settings" | "route-trace" | "sources" | "orchestration" | "quiz" | null;

export type PanelQuizData = {
  panelId: string;
  questions: ParsedQuizQuestion[];
  answers: Record<string, string>;
  submitted: boolean;
  activeIndex: number;
  onSetIndex: (index: number) => void;
  onSelectAnswer: (questionId: string, letter: string) => void;
  onSubmit: () => void;
};

export type PanelData = {
  routeTrace?: RouteTrace;
  sources?: Citation[];
  whyThisResponse?: string;
  modelUsed?: string;
  quiz?: PanelQuizData;
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
  const activeViewRef = useRef<PanelView>(null);
  const panelDataRef = useRef<PanelData>({});

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);
  useEffect(() => {
    panelDataRef.current = panelData;
  }, [panelData]);

  const samePanelData = useCallback((a: PanelData, b: PanelData) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const left = a[key as keyof PanelData];
      const right = b[key as keyof PanelData];
      if (key === "quiz") {
        const leftQuiz = left as PanelQuizData | undefined;
        const rightQuiz = right as PanelQuizData | undefined;
        if (!leftQuiz && !rightQuiz) continue;
        if (!leftQuiz || !rightQuiz) return false;
        if (leftQuiz.panelId !== rightQuiz.panelId) return false;
        if (leftQuiz.submitted !== rightQuiz.submitted) return false;
        if (leftQuiz.activeIndex !== rightQuiz.activeIndex) return false;
        if (leftQuiz.questions.length !== rightQuiz.questions.length) return false;
        const leftQuestionSig = leftQuiz.questions.map((question) => question.id).join("|");
        const rightQuestionSig = rightQuiz.questions.map((question) => question.id).join("|");
        if (leftQuestionSig !== rightQuestionSig) return false;
        const leftAnswers = Object.entries(leftQuiz.answers).sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
        const rightAnswers = Object.entries(rightQuiz.answers).sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
        if (leftAnswers.length !== rightAnswers.length) return false;
        for (let index = 0; index < leftAnswers.length; index += 1) {
          const [leftKey, leftValue] = leftAnswers[index]!;
          const [rightKey, rightValue] = rightAnswers[index]!;
          if (leftKey !== rightKey || leftValue !== rightValue) return false;
        }
        continue;
      }
      if (left !== right) return false;
    }
    return true;
  }, []);

  const openPanel = useCallback((view: PanelView, data: PanelData = {}) => {
    const sameView = activeViewRef.current === view;
    if (sameView && samePanelData(panelDataRef.current, { ...panelDataRef.current, ...data })) {
      return;
    }
    if (typeof window !== "undefined" && view) {
      window.dispatchEvent(new CustomEvent("ai-school:panel-opened", { detail: { view } }));
    }
    setActiveView(view);
    setPanelData((prev) => {
      const next = view === activeViewRef.current ? { ...prev, ...data } : data;
      return samePanelData(prev, next) ? prev : next;
    });
  }, [samePanelData]);

  const closePanel = useCallback(() => {
    if (typeof window !== "undefined" && activeViewRef.current) {
      window.dispatchEvent(new CustomEvent("ai-school:panel-closed", { detail: { view: activeViewRef.current } }));
    }
    setActiveView(null);
    setPanelData({});
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
        setPanelData((prev) => {
          const next = { ...prev, ...data };
          return samePanelData(prev, next) ? prev : next;
        });
      } else {
        setActiveView(null);
        setPanelData({});
      }
    } else {
      if (activeViewRef.current !== view) {
        setActiveView(view);
      }
      setPanelData((prev) => (samePanelData(prev, data) ? prev : data));
    }
  }, [activeView, hasData, samePanelData]);

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
