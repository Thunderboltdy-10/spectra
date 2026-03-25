"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

type Props = { children: ReactNode; chatId?: string };
type State = { hasError: boolean; error?: Error };

export class ChatErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ChatErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error boundary when chat changes
    if (prevProps.chatId !== this.props.chatId && this.state.hasError) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-secondary)]">
            <RefreshCw size={24} className="text-[var(--text-tertiary)]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--text-primary)]">Something went wrong</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              This conversation encountered an error. Try switching to another chat or refreshing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-2 text-xs text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
