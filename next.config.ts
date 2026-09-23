import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// Pin every bundler to the ESM build. Mixing `yjs.mjs` with `yjs.cjs`
// redefines constructors and prints "Yjs was already imported".
// Turbopack on Windows cannot resolve `C:\...` alias targets
// ("windows imports are not implemented yet"), so the turbopack alias stays
// a project-relative POSIX path.
const yjsEsmRelative = "./node_modules/yjs/dist/yjs.mjs";
const yjsEsmAbsolute = resolve(projectRoot, "node_modules/yjs/dist/yjs.mjs");

const nextConfig: NextConfig = {
  // Durable Office bodies are streamed through the Next proxy before the API
  // route applies its own 256 MiB bound. Keep the proxy cap aligned with that
  // route limit so large saved versions are not silently truncated at 10 MiB.
  experimental: {
    proxyClientMaxBodySize: 256 * 1024 * 1024,
  },
  // Browser evidence is taken against the development server, but framework
  // diagnostics are not part of Spectra's product chrome.
  devIndicators: false,
  transpilePackages: ["@lobehub/icons", "@lobehub/ui", "es-toolkit"],
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "esbuild"],
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      yjs: yjsEsmRelative,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      yjs: yjsEsmAbsolute,
    };
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
