import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lobehub/icons", "@lobehub/ui", "es-toolkit"],
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
