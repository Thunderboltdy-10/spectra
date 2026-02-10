import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  requestId: string;
  path: string;
  method: string;
  userId?: string;
  [key: string]: unknown;
};

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
};

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

function redactSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...obj };
  const sensitiveKeys = ["password", "token", "secret", "apiKey", "api_key", "authorization", "Authorization"];
  
  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      redacted[key] = "[REDACTED]";
    }
  }
  
  return redacted;
}

export class StructuredLogger {
  private _context: Partial<LogContext>;
  
  get context(): Partial<LogContext> {
    return this._context;
  }
  
  constructor(context: Partial<LogContext> = {}) {
    this._context = context;
  }
  
  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>, error?: Error) {
    if (!shouldLog(level)) return;
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this._context as LogContext,
      metadata: metadata ? redactSensitiveData(metadata) : undefined,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      } : undefined,
    };
    
    // In production, you'd send this to a logging service
    if (process.env.NODE_ENV === "production") {
      // Send to logging service
      console.log(JSON.stringify(entry));
    } else {
      // Pretty print for development
      const colors: Record<LogLevel, string> = {
        debug: "\x1b[36m", // cyan
        info: "\x1b[32m",  // green
        warn: "\x1b[33m",  // yellow
        error: "\x1b[31m", // red
      };
      const reset = "\x1b[0m";
      
      console.log(
        `${colors[level]}[${level.toUpperCase()}]${reset} ${entry.timestamp} ${entry.context.requestId} ${message}`
      );
      
      if (metadata && Object.keys(metadata).length > 0) {
        console.log("  Metadata:", JSON.stringify(metadata, null, 2));
      }
      
      if (error) {
        console.log("  Error:", error.message);
      }
    }
  }
  
  debug(message: string, metadata?: Record<string, unknown>) {
    this.log("debug", message, metadata);
  }
  
  info(message: string, metadata?: Record<string, unknown>) {
    this.log("info", message, metadata);
  }
  
  warn(message: string, metadata?: Record<string, unknown>) {
    this.log("warn", message, metadata);
  }
  
  error(message: string, error: Error, metadata?: Record<string, unknown>) {
    this.log("error", message, metadata, error);
  }
  
  child(additionalContext: Partial<LogContext>): StructuredLogger {
    return new StructuredLogger({ ...this._context, ...additionalContext });
  }
}

export function createRequestLogger(request: NextRequest): StructuredLogger {
  const requestId = randomUUID().slice(0, 8);
  
  return new StructuredLogger({
    requestId,
    path: request.nextUrl.pathname,
    method: request.method,
  });
}

export function logAPIRequest(params: {
  logger: StructuredLogger;
  body?: Record<string, unknown>;
  model?: string;
  mode?: string;
}) {
  const { logger, body, model, mode } = params;
  
  logger.info("API request started", {
    mode,
    model,
    bodyKeys: body ? Object.keys(body) : undefined,
    hasMessage: body?.message ? (body.message as string).length : 0,
  });
}

export function logAPIResponse(params: {
  logger: StructuredLogger;
  status: number;
  duration: number;
  modelUsed?: string;
  error?: Error;
}) {
  const { logger, status, duration, modelUsed, error } = params;
  
  if (error) {
    logger.error("API request failed", error, {
      status,
      duration: `${duration}ms`,
      modelUsed,
    });
  } else {
    logger.info("API request completed", {
      status,
      duration: `${duration}ms`,
      modelUsed,
    });
  }
}

export function logOpenRouterCall(params: {
  logger: StructuredLogger;
  model: string;
  operation: "chat" | "embedding" | "models";
  statusCode?: number;
  error?: string;
  duration?: number;
}) {
  const { logger, model, operation, statusCode, error, duration } = params;
  
  if (error) {
    logger.warn(`OpenRouter ${operation} failed`, {
      model,
      statusCode,
      error,
      duration: duration ? `${duration}ms` : undefined,
    });
  } else {
    logger.debug(`OpenRouter ${operation} successful`, {
      model,
      statusCode,
      duration: duration ? `${duration}ms` : undefined,
    });
  }
}
