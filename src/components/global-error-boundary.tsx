"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";

type Props = { children: ReactNode; resetKey?: string | null };
type State = { hasError: boolean; error?: Error };

/** Swallows a subtree failure so a bad query cannot blank the whole product. */
export class IsolatedErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidMount() {
    window.addEventListener("online", this.recover);
  }

  componentWillUnmount() {
    window.removeEventListener("online", this.recover);
  }

  recover = () => {
    if (this.state.failed) this.setState({ failed: false });
  };

  render() {
    if (this.state.failed) {
      return (
        this.props.fallback ?? (
          <p className="px-4 py-6 text-caption text-[var(--text-secondary)]" role="status">
            This device is offline. You can keep working; Spectra will reconnect when it can.
          </p>
        )
      );
    }
    return this.props.children;
  }
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(previousProps: Props) {
    if (
      this.state.hasError &&
      previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      const spoken = humanizePublicFailure(this.state.error);
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--bg-primary)] p-8 text-[var(--text-primary)]">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--bg-secondary)]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--danger)]">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="max-w-md text-center">
            <h1 className="text-lg font-medium">Something went wrong</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {spoken}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-2.5 text-sm transition hover:bg-[var(--bg-hover)]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-[var(--accent-cyan)] px-5 py-2.5 text-sm text-white transition hover:opacity-90"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
