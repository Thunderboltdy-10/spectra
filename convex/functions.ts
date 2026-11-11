import {
  action as generatedAction,
  internalAction as generatedInternalAction,
  internalMutation as generatedInternalMutation,
  internalQuery as generatedInternalQuery,
  mutation as generatedMutation,
  query as generatedQuery,
} from "./_generated/server";
import { toWordedConvexError } from "../shared/convex-error.mjs";
import { withReadOnce } from "./readOnce";

/*
 * Spectra's function builders. Every Convex function is defined with these, not
 * with `./_generated/server` (module-graph.test.ts enforces it).
 *
 * Production Convex redacts the message of any thrown error that is not a
 * `ConvexError`, so a worded `Error("CODE: sentence")` would reach the caller
 * as "Server Error". Each builder converts it at the function boundary (see
 * `shared/convex-error.ts`). Argument and return validation run outside the
 * handler and are unchanged. Internal functions convert too, so a failure keeps
 * its words through an action's `ctx.runQuery`/`runMutation`/`runAction`.
 */

type Handler = (ctx: unknown, ...args: unknown[]) => unknown;
type Definition = Handler | { handler: Handler };

function wordedHandler(handler: Handler): Handler {
  return async (ctx, ...args) => {
    try {
      return await handler(ctx, ...args);
    } catch (error) {
      throw toWordedConvexError(error);
    }
  };
}

function worded<Builder>(builder: Builder, wrap: (handler: Handler) => Handler = wordedHandler): Builder {
  const register = builder as unknown as (definition: Definition) => unknown;
  return ((definition: Definition) =>
    register(
      typeof definition === "function"
        ? wrap(definition)
        : { ...definition, handler: wrap(definition.handler) },
    )) as Builder;
}

/** Functions with a database read each document once (see readOnce.ts). */
const readingOnce = (handler: Handler): Handler =>
  wordedHandler((ctx, ...args) => handler(withReadOnce(ctx as { db: unknown }), ...args));

export const query = worded(generatedQuery, readingOnce);
export const internalQuery = worded(generatedInternalQuery, readingOnce);
export const mutation = worded(generatedMutation, readingOnce);
export const internalMutation = worded(generatedInternalMutation, readingOnce);
export const action = worded(generatedAction);
export const internalAction = worded(generatedInternalAction);
