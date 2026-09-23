import type { NextConfig } from "next";

/**
 * Static export (spec §16): the same bundle runs under `next dev` for design
 * review and inside the Tauri webview on a phone. No SSR, no API routes.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  reactCompiler: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "radix-ui", "framer-motion", "@react-three/drei"],
  },
};

export default nextConfig;
