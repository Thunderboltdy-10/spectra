import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

const workerToken = new AsyncLocalStorage<string>();

export function withWorkerConvexToken<T>(token: string, task: () => Promise<T>) {
  return workerToken.run(token, task);
}

export function getWorkerConvexToken() {
  return workerToken.getStore();
}
