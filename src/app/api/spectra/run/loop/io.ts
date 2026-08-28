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

export async function mutate<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  try {
    return await convexMutation<TArgs, TResult>(name, args);
  } catch (error) {
    if (!missingFunction(error)) throw error;
    return convexMutation<TArgs, TResult>(withJsExtension(name), args);
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
