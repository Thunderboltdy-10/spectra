import { createServer, request as requestUpstream } from "node:http";
import { connect } from "node:net";
import next from "next";

const port = Number(process.env.SPECTRA_WEB_PORT || 3000);
const hostname = process.env.SPECTRA_WEB_HOST || "0.0.0.0";
const collaborationHost = process.env.SPECTRA_COLLAB_HOST || "127.0.0.1";
const collaborationPort = Number(process.env.SPECTRA_COLLAB_PORT || 1234);
const collaborationPrefix = "/_spectra/realtime";

function collaborationPath(url = "/") {
  const stripped = url.slice(collaborationPrefix.length);
  return stripped.startsWith("/") || stripped.startsWith("?")
    ? stripped || "/"
    : `/${stripped}`;
}

function isCollaborationRequest(url = "/") {
  return url === collaborationPrefix
    || url.startsWith(`${collaborationPrefix}/`)
    || url.startsWith(`${collaborationPrefix}?`);
}

function upstreamHeaders(request) {
  return {
    ...request.headers,
    host: `${collaborationHost}:${collaborationPort}`,
  };
}

function proxyCollaborationHttp(request, response) {
  const upstream = requestUpstream(
    {
      hostname: collaborationHost,
      port: collaborationPort,
      method: request.method,
      path: collaborationPath(request.url),
      headers: upstreamHeaders(request),
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "application/json" });
    }
    response.end(JSON.stringify({ error: "Collaboration gateway unavailable" }));
  });
  request.pipe(upstream);
}

function proxyCollaborationUpgrade(request, socket, head) {
  const upstream = connect(
    { host: collaborationHost, port: collaborationPort },
    () => {
      const headerLines = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index];
        const value = request.rawHeaders[index + 1];
        if (name.toLowerCase() !== "host") headerLines.push(`${name}: ${value}`);
      }
      upstream.write(
        `${request.method ?? "GET"} ${collaborationPath(request.url)} HTTP/${request.httpVersion}\r\n`
        + `Host: ${collaborationHost}:${collaborationPort}\r\n`
        + `${headerLines.join("\r\n")}\r\n\r\n`,
      );
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    },
  );
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

const app = next({ dev: true, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const handleUpgrade = app.getUpgradeHandler();

const server = createServer((request, response) => {
  if (isCollaborationRequest(request.url)) {
    proxyCollaborationHttp(request, response);
    return;
  }
  void handle(request, response);
});

server.on("upgrade", (request, socket, head) => {
  if (isCollaborationRequest(request.url)) {
    proxyCollaborationUpgrade(request, socket, head);
    return;
  }
  handleUpgrade(request, socket, head);
});

server.listen(port, hostname, () => {
  process.stdout.write(
    `Spectra web development server ready on http://localhost:${port} (realtime proxied to ${collaborationHost}:${collaborationPort})\n`,
  );
});

async function shutdown() {
  await new Promise((resolve) => server.close(resolve));
  await app.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
