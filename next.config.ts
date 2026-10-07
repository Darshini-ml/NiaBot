import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "tesseract.js", "better-sqlite3"],
};

export default nextConfig;
