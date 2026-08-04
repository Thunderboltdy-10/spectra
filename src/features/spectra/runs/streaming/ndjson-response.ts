export type RunEventEmitter = (event: unknown) => void;

export function createNdjsonResponse(
  task: (emit: RunEventEmitter) => Promise<void>,
  mapError: (error: unknown) => string,
) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        let attached = true;
        const emit: RunEventEmitter = (event) => {
          if (!attached) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            attached = false;
          }
        };
        void task(emit)
          .catch((error) => emit({ type: "error", message: mapError(error) }))
          .finally(() => {
            try {
              controller.close();
            } catch {
              // The consumer may cancel after receiving a terminal event.
            }
          });
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
