import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import path from "path";
import { securityHeaders } from "./src/server/httpSecurity";

// https://tanstack.com/start
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [
    // File-based routing: routes live in src/routes and the plugin generates
    // src/routeTree.gen.ts consumed by src/router.tsx.
    tanstackStart({
      srcDirectory: "src",
    }),
    viteReact(),
    // Target Cloudflare Workers by default. Override with the SERVER_PRESET
    // env var (e.g. SERVER_PRESET=node-server) to build for another target.
    nitro({
      preset: process.env.SERVER_PRESET ?? "cloudflare-module",
      compatibilityDate: "2026-07-09",
      plugins: ["./src/server/plugins/securityHeaders.ts"],
      routeRules: {
        "/**": {
          headers: securityHeaders,
        },
        "/docs/**": { headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" } },
      },
    }),
  ],
});
