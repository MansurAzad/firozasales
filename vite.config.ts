// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  vite: {
    plugins: [VitePWA({
      strategies: 'generateSW', filename: 'sw.js', registerType: 'autoUpdate', injectRegister: null,
      outDir: 'dist/client',
      devOptions: { enabled: false }, manifest: false,
      includeAssets: ['icons/*.png', 'manifest.webmanifest', 'offline.html'],
      workbox: {
        globPatterns: ['**/*.{js,css,woff2,png,ico}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: null,
        runtimeCaching: [
          { urlPattern: ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin && !url.pathname.startsWith('/~oauth') && !url.pathname.startsWith('/api/'), handler: 'NetworkFirst', options: { cacheName: 'fe-navigation', networkTimeoutSeconds: 3, expiration: { maxEntries: 1 }, precacheFallback: { fallbackURL: '/offline.html' }, plugins: [{ cacheKeyWillBeUsed: async ({ request }) => new URL('/__fe_shell', request.url).href }] } },
          { urlPattern: ({ url }) => url.origin === self.location.origin && /\/assets\/.*-[A-Za-z0-9_-]{6,}\.(js|css|woff2)$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'fe-assets', expiration: { maxEntries: 250 } } },
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'fe-fonts', expiration: { maxEntries: 30 } } },
        ],
      },
    })],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
