// A bounded transport envelope for the unchanged Hocuspocus/Yjs messages.
// Negotiated per socket; legacy sockets continue using the ordinary protocol.
export const FRAME_PROTOCOL = "spectra-fragments-v1";
export const FRAME_BYTES = 512 * 1024;
export const MAX_ASSEMBLED_BYTES = 256 * 1024 * 1024;
const HEADER = 16;
const MAGIC = 0x53394631;

export function* frameMessage(value) {
  const data = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (data.byteLength <= FRAME_BYTES) { yield data; return; }
  if (data.byteLength > MAX_ASSEMBLED_BYTES) throw new Error("COLLABORATION_FRAME_SIZE");
  for (let offset = 0; offset < data.length; offset += FRAME_BYTES - HEADER) {
    const body = data.subarray(offset, offset + FRAME_BYTES - HEADER);
    const frame = new Uint8Array(HEADER + body.length);
    const header = new DataView(frame.buffer);
    header.setUint32(0, MAGIC); header.setUint32(4, data.length);
    header.setUint32(8, offset); header.setUint32(12, body.length);
    frame.set(body, HEADER);
    yield frame;
  }
}

export function createMessageAssembler({ allowLarge = () => true, now = () => Date.now(), onExpire = () => {} } = {}) {
  let pending = null;
  let offset = 0;
  let started = 0;
  let timer = null;
  const reset = () => { pending = null; offset = 0; clearTimeout(timer); timer = null; };
  return {
    reset,
    accept(value) {
      const data = value instanceof Uint8Array ? value : new Uint8Array(value);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (data.length < HEADER || view.getUint32(0) !== MAGIC) {
        if (pending) throw new Error("COLLABORATION_FRAME_INCOMPLETE");
        return data;
      }
      const total = view.getUint32(4), at = view.getUint32(8), length = view.getUint32(12);
      if (!allowLarge() || total <= FRAME_BYTES || total > MAX_ASSEMBLED_BYTES ||
        data.length > FRAME_BYTES || length !== data.length - HEADER || length === 0 ||
        at + length > total || at !== offset || (pending && (pending.length !== total || now() - started > 30_000)))
        throw new Error("COLLABORATION_FRAME_INVALID");
      if (!pending) {
        pending = new Uint8Array(total); started = now();
        timer = setTimeout(() => { reset(); onExpire(); }, 30_000);
        timer.unref?.();
      }
      pending.set(data.subarray(HEADER), offset); offset += length;
      if (offset !== total) return null;
      const complete = pending; reset();
      return complete;
    },
  };
}

export function framedWebSocket(Base) {
  return class FramedWebSocket extends Base {
    constructor(url) {
      super(url, FRAME_PROTOCOL);
      this.spectraAssembler = createMessageAssembler({ onExpire: () => this.close(4409, "COLLABORATION_FRAME_EXPIRED") });
      this.spectraListeners = new Map();
      super.addEventListener("close", () => this.spectraAssembler.reset());
    }
    send(data) {
      if (typeof data === "string") return super.send(data);
      for (const frame of frameMessage(data)) super.send(frame);
    }
    addEventListener(type, listener, options) {
      if (type !== "message") return super.addEventListener(type, listener, options);
      const wrapped = event => {
        let data;
        try {
          data = this.spectraAssembler.accept(event.data);
        } catch { this.spectraAssembler.reset(); this.close(4409, "COLLABORATION_FRAME_INVALID"); return; }
        if (data) listener({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
      };
      this.spectraListeners.set(listener, wrapped);
      super.addEventListener(type, wrapped, options);
    }
    removeEventListener(type, listener, options) {
      const wrapped = this.spectraListeners.get(listener);
      this.spectraListeners.delete(listener);
      super.removeEventListener(type, wrapped ?? listener, options);
    }
  };
}

/** Install fragmentation around the existing Hocuspocus connection. */
export function installServerFraming(server, allowLarge) {
  const handleConnection = server.hocuspocus.handleConnection.bind(server.hocuspocus);
  server.hocuspocus.handleConnection = (socket, request, context) => {
    const framed = request.headers.get("sec-websocket-protocol")?.split(",").map(value => value.trim()).includes(FRAME_PROTOCOL);
    if (framed) {
      const send = socket.send.bind(socket);
      socket.send = data => {
        if (typeof data === "string") return send(data);
        for (const frame of frameMessage(data)) send(frame);
      };
    }
    const connection = handleConnection(socket, request, context);
    if (framed) {
      const assembler = createMessageAssembler({ allowLarge: () => allowLarge(request), onExpire: () => socket.close(4409, "COLLABORATION_FRAME_EXPIRED") });
      const handle = connection.handleMessage.bind(connection);
      connection.handleMessage = data => {
        try {
          const message = assembler.accept(data);
          if (message) return handle(message);
        } catch {
          assembler.reset();
          socket.close(4409, "COLLABORATION_FRAME_INVALID");
        }
      };
      const close = connection.handleClose.bind(connection);
      connection.handleClose = event => { assembler.reset(); return close(event); };
    }
    return connection;
  };
}

export function selectFrameProtocol(protocols) {
  return protocols.has(FRAME_PROTOCOL) ? FRAME_PROTOCOL : false;
}
