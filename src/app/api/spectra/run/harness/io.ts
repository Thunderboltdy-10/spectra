import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";

export function withJsExtension(functionName: string) {
  const [moduleName, exportName] = functionName.split(":");
  return !moduleName || !exportName || moduleName.endsWith(".js")
    ? functionName
    : `${moduleName}.js:${exportName}`;
}

export function missingFunction(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("FunctionPathNotFound") ||
    message.includes("Could not find public function")
  );
}

export async function query<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  try {
    return await convexQuery<TArgs, TResult>(name, args);
  } catch (error) {
    if (!missingFunction(error)) throw error;
    return convexQuery<TArgs, TResult>(withJsExtension(name), args);
  }
}

export async function readQuery<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
  resource: string,
) {
  try {
    return {
      ok: true as const,
      value: await query<TArgs, TResult>(name, args),
    };
  } catch {
    return {
      ok: false as const,
      code: "context_read_unavailable" as const,
      message: `Spectra could not read ${resource} right now. Use the existing context or try one bounded read again.`,
      retryable: true as const,
    };
  }
}

/** Two writes met on the same row. Neither was saved, so sending it again is safe. */
const WRITE_CONFLICT = /optimistic ?concurrency|OCC|changed while this mutation|write conflict/i;
const CONFLICT_RETRIES = 5;

export async function mutate<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await convexMutation<TArgs, TResult>(name, args);
    } catch (error) {
      if (missingFunction(error)) return convexMutation<TArgs, TResult>(withJsExtension(name), args);
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= CONFLICT_RETRIES || !WRITE_CONFLICT.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 80 + Math.random() * 120));
    }
  }
}

export async function act<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  try {
    return await convexAction<TArgs, TResult>(name, args);
  } catch (error) {
    if (!missingFunction(error)) throw error;
    return convexAction<TArgs, TResult>(withJsExtension(name), args);
  }
}

export function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "string" && item.length > 4_000)
      return `${item.slice(0, 4_000)}…`;
    if (Array.isArray(item) && item.length > 200)
      return [...item.slice(0, 200), "…"];
    return item;
  });
}
