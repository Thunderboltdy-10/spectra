export type WorkerTaskHandle<T> = {
  result: Promise<T>;
  cancel: () => void;
};

export function runIsolatedWorkerTask<I, O>({
  workerUrl,
  input,
  timeoutMs,
  name,
}: {
  workerUrl: string | URL;
  input: I;
  timeoutMs: number;
  name: string;
}): WorkerTaskHandle<O> {
  const worker = new Worker(workerUrl, { type: "module", name });
  let settled = false;
  let rejectTask: (reason?: unknown) => void = () => {};
  const cleanup = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker.terminate();
  };
  const result = new Promise<O>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<{ ok: boolean; output?: O; error?: string }>) => {
      if (event.data?.ok) resolve(event.data.output as O);
      else reject(new Error(event.data?.error || "The isolated worker task failed."));
      cleanup();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || "The isolated worker stopped unexpectedly."));
      cleanup();
    };
    worker.postMessage(input);
  });
  const timer = setTimeout(() => {
    rejectTask(new Error(`The ${name} worker exceeded its ${timeoutMs} ms safety limit.`));
    cleanup();
  }, timeoutMs);
  return {
    result,
    cancel: () => {
      rejectTask(new DOMException("The worker task was cancelled.", "AbortError"));
      cleanup();
    },
  };
}
