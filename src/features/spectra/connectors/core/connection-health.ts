import type { ConnectionStatus } from "./types";

export const CONNECTION_COMPENSATION_TABLE = {
  connected: {
    exits: ["expired", "rate_limited", "revoked", "error"],
    compensation:
      "A health check or token-expiry sweep moves an unusable connection out of Connected.",
  },
  expired: {
    exits: ["connected", "revoked", "error"],
    compensation:
      "The provider worker refreshes the token. A stalled refresh becomes an actionable error.",
  },
  rate_limited: {
    exits: ["connected", "revoked", "error"],
    compensation:
      "The provider worker retries after the recorded deadline. A stalled retry becomes an actionable error.",
  },
  revoked: {
    exits: ["connected", "error"],
    compensation:
      "Only an explicit new authorization reconnects this provider; an interrupted authorization rests in Error.",
  },
  error: {
    exits: ["connected", "revoked", "rate_limited", "expired"],
    compensation:
      "A user retry or worker health check must either reconnect or leave a plain actionable error.",
  },
} as const satisfies Record<
  ConnectionStatus,
  { exits: readonly ConnectionStatus[]; compensation: string }
>;

export type ConnectionPresentation = {
  label: string;
  sentence: string;
  tone: "healthy" | "attention" | "failure" | "neutral";
  action: "none" | "retry" | "reconnect";
};

export function presentConnectionHealth(input: {
  status: ConnectionStatus;
  errorCode?: string;
  retryAt?: number;
}): ConnectionPresentation {
  if (input.status === "connected") {
    return {
      label: "Connected",
      sentence: "Spectra can use this connection.",
      tone: "healthy",
      action: "none",
    };
  }
  if (input.status === "expired") {
    return {
      label: "Sign-in expired",
      sentence: "Reconnect to let Spectra use this provider again.",
      tone: "attention",
      action: "reconnect",
    };
  }
  if (input.status === "rate_limited") {
    return {
      label: "Waiting to retry",
      sentence: input.retryAt
        ? "The provider asked Spectra to wait. Spectra will retry automatically."
        : "The provider asked Spectra to wait. Try again shortly.",
      tone: "attention",
      action: input.retryAt ? "none" : "retry",
    };
  }
  if (input.status === "revoked") {
    return {
      label: "Disconnected",
      sentence: "Spectra no longer has access through this connection.",
      tone: "neutral",
      action: "reconnect",
    };
  }
  if (input.errorCode === "not_configured") {
    return {
      label: "Not connected",
      sentence:
        "Connect this provider when you are ready to use it in Spectra.",
      tone: "neutral",
      action: "reconnect",
    };
  }
  if (input.errorCode === "checking_connection") {
    return {
      label: "Checking connection",
      sentence: "Spectra is confirming that this connection can be used.",
      tone: "neutral",
      action: "none",
    };
  }
  if (
    input.errorCode === "authorization_incomplete" ||
    input.errorCode === "token_refresh_stalled"
  ) {
    return {
      label: "Reconnect required",
      sentence:
        "Spectra could not finish renewing this connection. Reconnect to continue.",
      tone: "failure",
      action: "reconnect",
    };
  }
  return {
    label: "Needs attention",
    sentence: "Spectra could not use this connection. Try again or reconnect.",
    tone: "failure",
    action: "retry",
  };
}
