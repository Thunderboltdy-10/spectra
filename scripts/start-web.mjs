process.env.NODE_ENV = "production";
process.env.NEXT_PUBLIC_SPECTRA_COLLAB_URL ??=
  `ws://localhost:${process.env.SPECTRA_WEB_PORT ?? "3000"}/_spectra/realtime`;

await import("./next-dev-server.mjs");
