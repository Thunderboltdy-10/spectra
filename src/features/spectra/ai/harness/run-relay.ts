import { createHmac } from "node:crypto";
import { collaborationGatewayUrl } from "@/lib/collaboration-token";

/*
 * The server side of the live relay (scripts/run-relay.mjs): the ticket a page
 * uses to listen to a run, and the sender a scheduled worker writes its events
 * to. Everything here is best effort. Without it a page reads the durable log.
 */

const TICKET_MS = 30 * 60_000;
const BATCH_MS = 40;
const MAX_FRAME_CHARS = 1_500_000;
/** Frames held while the socket opens; a relay this far behind is not live. */
const MAX_WAITING_CHARS = 4_000_000;

const secret = () => process.env.SPECTRA_COLLAB_TOKEN_SECRET?.trim() || null;
const channelId = (runId: string, executionId: string, relayId?: string) => `${runId}:${executionId}${relayId ? `:${relayId}` : ""}`;

function ticket(sub: string, role: "publish" | "watch") {
  const key = secret();
  if (!key) return null;
  const body = Buffer.from(
    JSON.stringify({ sub, role, exp: Date.now() + TICKET_MS, aud: "spectra-run-relay" }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

function relayBase(forBrowser: boolean) {
  const hub = forBrowser ? null : process.env.SPECTRA_AGENT_HUB_URL?.trim();
  const base = hub || collaborationGatewayUrl();
  return base.replace(/\/$/, "");
}

/** What the page needs to listen to this attempt. Null when there is no relay. */
export function runRelayInvite(runId: string, executionId: string, relayId?: string) {
  try {
    const watch = ticket(channelId(runId, executionId, relayId), "watch");
    if (!watch) return null;
    return { type: "live_relay" as const, url: `${relayBase(true)}/_spectra/run-relay/watch`, ticket: watch };
  } catch {
    return null;
  }
}

export type RunRelaySender = {
  send(event: unknown): void;
  connected(): boolean;
  /** Everything sent has gone out, then the socket closes. */
  close(): void;
};

export function openRunRelay(runId: string, executionId: string, relayId?: string): RunRelaySender | null {
  let socket: WebSocket;
  try {
    const publish = ticket(channelId(runId, executionId, relayId), "publish");
    if (!publish) return null;
    socket = new WebSocket(`${relayBase(false)}/_spectra/run-relay/publish`, ["spectra-run-relay", publish]);
  } catch {
    return null;
  }
  let open = false;
  let gone = false;
  let closing = false;
  let waiting: string[] = [];
  let waitingChars = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!open || !waiting.length) return;
    const frame = waiting.join("\n");
    waiting = [];
    waitingChars = 0;
    try {
      socket.send(frame);
    } catch {
      gone = true;
    }
  };
  socket.addEventListener("open", () => {
    open = true;
    flush();
    if (closing) socket.close();
  });
  socket.addEventListener("close", () => {
    open = false;
    gone = true;
    waiting = [];
  });
  socket.addEventListener("error", () => {
    gone = true;
  });

  return {
    send(event) {
      if (gone || closing) return;
      let line: string;
      try {
        line = JSON.stringify(event);
      } catch {
        return;
      }
      // A whole-document event is left to the durable log.
      if (line.length > MAX_FRAME_CHARS || waitingChars + line.length > MAX_WAITING_CHARS) return;
      waiting.push(line);
      waitingChars += line.length;
      if (!timer) timer = setTimeout(flush, BATCH_MS);
    },
    connected: () => open && !gone,
    close() {
      if (closing) return;
      closing = true;
      flush();
      if (open) socket.close();
      else if (!gone)
        // A socket that never opens must not hold the worker's process alive.
        setTimeout(() => {
          try {
            socket.close();
          } catch {
            // Already gone.
          }
        }, 2_000);
    },
  };
}
