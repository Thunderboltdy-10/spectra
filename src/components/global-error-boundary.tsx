"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { readConvexError } from "../../shared/convex-error.mjs";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";

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

/** Full-screen recovery shared by the client boundary and the app router's
 * error.tsx, so a server-rendered failure looks the same as a client one. */
export function ErrorScreen({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  // React lazy and the module runtime retain failed imports. Resetting a
  // boundary or refetching a route cannot replace that rejected module payload.
  const needsReload =
    (error instanceof Error && error.name === "ChunkLoadError") ||
    /^(?:Failed to load chunk\b|Loading (?:CSS )?chunk\b.*\bfailed\b|Failed to fetch dynamically imported module\b|Importing a module script failed\b|error loading dynamically imported module\b)/i.test(
      readConvexError(error).message || "",
    );
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-[var(--bg-primary)] p-8 text-[var(--text-primary)]">
      <span aria-hidden className="grid size-10 place-items-center text-[var(--danger)]" data-icon-host>
        <Icon name="problem" size={24} />
      </span>
      <div className="max-w-md text-center">
        <h1 className="text-title font-semibold">Something went wrong</h1>
        <p className="mt-2 text-ui leading-6 text-[var(--text-secondary)]">
          {needsReload
            ? "Part of Spectra could not load. Reconnect, then reload the page."
            : humanizePublicFailure(error)}
        </p>
      </div>
      <div className="flex gap-2">
        {!needsReload && (
          <Button variant="primary" size="lg" onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button variant={needsReload ? "primary" : "secondary"} size="lg" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    </div>
  );
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
      return (
        <ErrorScreen
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false })}
        />
      );
    }
    return this.props.children;
  }
}
