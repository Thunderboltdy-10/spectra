"use client";

import { useRef, useCallback } from "react";
import { toast } from "sonner";

const ERROR_DEDUPE_WINDOW = 5000;
const ERROR_MESSAGE_COOLDOWN = new Map<string, number>();

export function useErrorHandling() {
  const lastErrorRef = useRef<string | null>(null);

  const handleError = useCallback((error: unknown, context?: string) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const key = context ? `${context}:${errorMessage}` : errorMessage;
    
    const now = Date.now();
    const lastShown = ERROR_MESSAGE_COOLDOWN.get(key);
    
    if (lastShown && now - lastShown < ERROR_DEDUPE_WINDOW) {
      return;
    }
    
    ERROR_MESSAGE_COOLDOWN.set(key, now);
    
    if (errorMessage.includes("401") || errorMessage.toLowerCase().includes("unauthorized")) {
      toast.error("Please sign in to continue", {
        duration: Infinity,
        action: {
          label: "Sign In",
          onClick: () => window.location.reload(),
        },
      });
      return;
    }
    
    if (errorMessage.includes("403") || errorMessage.toLowerCase().includes("permission")) {
      toast.error("You don't have permission for this action");
      return;
    }
    
    if (errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found")) {
      toast.error("The requested resource was not found");
      return;
    }
    
    if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
      toast.error("Too many requests. Please wait a moment.");
      return;
    }
    
    if (errorMessage.includes("BUDGET_EXCEEDED")) {
      toast.error("Daily token budget reached. Try again tomorrow.");
      return;
    }
    
    if (errorMessage.includes("AUTH")) {
      toast.error("Authentication error. Please sign in again.");
      return;
    }
    
    toast.error(errorMessage.length > 200 ? `${errorMessage.slice(0, 200)}...` : errorMessage);
  }, []);

  return { handleError, lastErrorRef };
}

export function useDeduplicatedToast() {
  const showDeduplicatedToast = useCallback(
    (message: string, type: "info" | "success" | "warning" | "error" = "info") => {
      const key = `${type}:${message}`;
      const now = Date.now();
      const lastShown = ERROR_MESSAGE_COOLDOWN.get(key);

      if (lastShown && now - lastShown < ERROR_DEDUPE_WINDOW) {
        return;
      }

      ERROR_MESSAGE_COOLDOWN.set(key, now);

      const duration = type === "error" ? 5000 : 3000;

      switch (type) {
        case "success":
          toast.success(message, { duration });
          break;
        case "warning":
          toast.warning(message, { duration });
          break;
        case "error":
          toast.error(message, { duration });
          break;
        default:
          toast(message, { duration });
      }
    },
    []
  );

  return { showDeduplicatedToast };
}

export function formatErrorForDisplay(error: unknown): { title: string; message: string; action?: string } {
  if (error instanceof Error) {
    if (error.message.includes("AUTH_NOT_SIGNED_IN")) {
      return {
        title: "Sign in required",
        message: "Please sign in to continue using AI School.",
        action: "Sign In",
      };
    }
    
    if (error.message.includes("BUDGET_EXCEEDED")) {
      return {
        title: "Budget limit reached",
        message: "Your organization has reached the daily token limit. Please try again tomorrow.",
      };
    }
    
    if (error.message.includes("fetch failed") || error.message.includes("network")) {
      return {
        title: "Connection issue",
        message: "Unable to reach the AI service. Please check your connection.",
      };
    }
    
    return {
      title: "Something went wrong",
      message: error.message.length > 200 ? `${error.message.slice(0, 200)}...` : error.message,
    };
  }

  return {
    title: "An error occurred",
    message: String(error),
  };
}
