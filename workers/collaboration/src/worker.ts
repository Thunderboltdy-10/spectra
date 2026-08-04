import { CollaborationRoom, type CollaborationEnv } from "./room";
import { roomName } from "./protocol";

export { CollaborationRoom };

type WorkerEnv = CollaborationEnv & {
  COLLABORATION_ROOMS: DurableObjectNamespace;
};

export default {
  async fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return Response.json({ ok: true, service: "spectra-collaboration", protocolVersion: 1 });
    const match = url.pathname.match(/^\/rooms\/([^/]+)(?:\/([^/]+))?$/);
    if (!match?.[1]) return new Response("Not found", { status: 404 });
    const name = roomName(decodeURIComponent(match[1]), match[2] ? decodeURIComponent(match[2]) : undefined);
    const id = env.COLLABORATION_ROOMS.idFromName(name);
    return env.COLLABORATION_ROOMS.get(id).fetch(request);
  },
};
