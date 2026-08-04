interface DurableObjectStorage {
  sql: {
    exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): Iterable<T>;
  };
  setAlarm(time: number | Date): Promise<void>;
  getAlarm(): Promise<number | null>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(tag?: string): WebSocket[];
}

interface WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
