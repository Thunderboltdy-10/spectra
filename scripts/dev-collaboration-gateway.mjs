// Keep the direct development entry on the same loader and ownership contract.
import { serveCollaborationGateway } from "./serve-collaboration-gateway.mjs";

serveCollaborationGateway({ args: ["--supervise", ...process.argv.slice(2)] })
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
