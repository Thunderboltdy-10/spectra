import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  StructuredLogger,
  createRequestLogger,
  logAPIResponse,
} from "./logging";
import type { NextRequest } from "next/server";

function normalizeErrorStatus(message: string) {
  const lower = message.toLowerCase();

  if (message.startsWith("AUTH_NOT_SIGNED_IN")) return 401;
  if (message.startsWith("AUTH_NO_ACCESS")) return 403;
  if (message.startsWith("AUTH_ORG_INACTIVE")) return 403;
  if (message.startsWith("AUTH_MISCONFIGURED")) return 500;
  if (message.startsWith("AUTH_PROFILE_UNAVAILABLE")) return 500;
  if (message.startsWith("AUTH_BOOTSTRAP_FAILED")) return 500;
  if (message.startsWith("INVITATION_EMAIL_FAILED")) return 502;
  if (lower.includes("unauthorized") || lower.includes("sign in")) return 401;
  if (lower.includes("super admin")) return 403;
  if (
    lower.includes("only admin") ||
    lower.includes("only teacher") ||
    lower.includes("permission")
  )
    return 403;
  if (lower.includes("not found")) return 404;
  if (
    lower.includes("source_changed") ||
    lower.includes("version_stale") ||
    lower.includes("conflict")
  )
    return 409;
  if (lower.includes("required") || lower.includes("invalid")) return 400;
  return 500;
}

/** User-facing 500 copy. Internal details stay in logs, never in `error.message`. */
export const PUBLIC_SERVER_FAILURE =
  "Spectra could not finish this request. Check your connection, then try again.";

function parseCodeAndMessage(rawMessage: string) {
  const [prefix, ...rest] = rawMessage.split(":");
  if (/^[A-Z0-9_]+$/.test(prefix) && rest.length > 0) {
    return {
      code: prefix,
      message: rest.join(":").trim(),
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: rawMessage,
  };
}

export async function withRouteErrorHandling<T>(
  handler: (logger: StructuredLogger) => Promise<T>,
  request?: NextRequest,
) {
  const startTime = Date.now();
  const logger = request
    ? createRequestLogger(request)
    : new StructuredLogger({
        requestId: randomUUID().slice(0, 8),
        path: "unknown",
        method: "unknown",
      });

  try {
    const result = await handler(logger);
    const status = result instanceof Response ? result.status : 200;

    // Log successful completion for API routes
    if (request) {
      logAPIResponse({
        logger,
        status,
        duration: Date.now() - startTime,
      });
    }

    return result;
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : PUBLIC_SERVER_FAILURE;
    const status = normalizeErrorStatus(rawMessage);
    const { code, message } = parseCodeAndMessage(rawMessage);
    const safeMessage = status >= 500 ? PUBLIC_SERVER_FAILURE : message;
    const requestId = logger.context.requestId || randomUUID().slice(0, 8);

    // Log the error with structured logger
    logAPIResponse({
      logger,
      status,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error : new Error(rawMessage),
    });

    return NextResponse.json(
      {
        ok: false,
        error: {
          code,
          message: safeMessage,
          status,
          requestId,
        },
      },
      { status },
    );
  }
}
