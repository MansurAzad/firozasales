import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { VitePWA, type VitePluginPWAAPI } from "vite-plugin-pwa";
import { existsSync } from "node:fs";
const clientDir =
  process.env["NITRO_PRESET"] === "vercel" ? ".vercel/output/static" : ".output/public";

export default defineConfig({
  plugins: [
    tanstackStart({
      spa: { enabled: true, maskPath: "/auth", prerender: { outputPath: "/_shell" } },
      server: { entry: "server" },
    }),
    viteReact(),
    tailwindcss(),
    nitro(),
    VitePWA({
      integration: { closeBundleOrder: "post" },
      strategies: "generateSW",
      filename: "sw.js",
      registerType: "autoUpdate",
      injectRegister: null,
      outDir: clientDir,
      devOptions: { enabled: false },
      manifest: false,
      includeAssets: ["icons/*.png", "manifest.webmanifest", "offline.html"],
      workbox: {
        globPatterns: ["**/*.{js,css,woff2,png,ico}", "_shell.html"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Only the NetworkFirst rule handles navigations; its fallback is the anonymous shell.
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              url.origin === self.location.origin &&
              !url.pathname.startsWith("/~oauth") &&
              !url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "fe-navigation",
              networkTimeoutSeconds: 3,
              precacheFallback: { fallbackURL: "/_shell.html" },
              plugins: [{ cacheWillUpdate: async () => null }],
            },
          },
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              /\/assets\/.*-[A-Za-z0-9_-]{6,}\.(js|css|woff2)$/.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "fe-assets", expiration: { maxEntries: 250 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "fe-fonts", expiration: { maxEntries: 30 } },
          },
        ],
      },
    }),
    {
      name: "fe-pwa-after-prerender",
      apply: "build",
      enforce: "post",
      buildApp: {
        order: "post",
        async handler(builder) {
          const plugin = builder.config.plugins.find((p) => p.name === "vite-plugin-pwa");
          const api = plugin?.api as VitePluginPWAAPI | undefined;
          if (!existsSync(`${clientDir}/_shell.html`) && builder.config.mode === "development")
            return;
          if (!existsSync(`${clientDir}/_shell.html`))
            throw new Error("Offline anonymous shell was not generated");
          if (api) await api.generateSW();
        },
      },
    },
  ],
  resolve: { tsconfigPaths: true },
});
