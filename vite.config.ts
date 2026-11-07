// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA, type VitePluginPWAAPI } from 'vite-plugin-pwa';
import { existsSync } from 'node:fs';
// Vercel builds (NITRO_PRESET=vercel) publish static files from .vercel/output/static.
// Outside Lovable builds, the vercel preset writes client files and the prerendered shell there.
const clientDir = process.env['NITRO_PRESET'] === 'vercel' && !process.env['LOVABLE_SANDBOX'] && !process.env['DEV_SERVER__PROJECT_PATH'] ? '.vercel/output/static' : 'dist/client';
import { companyLogoUrl, companyLogoRevision } from './src/lib/company-brand';

export default defineConfig({
  vite: {
    plugins: [VitePWA({
      integration: { closeBundleOrder: 'post' },
      strategies: 'generateSW', filename: 'sw.js', registerType: 'autoUpdate', injectRegister: null,
      outDir: clientDir,
      devOptions: { enabled: false }, manifest: false,
      includeAssets: ['icons/*.png', 'manifest.webmanifest', 'offline.html'],
      workbox: {
        additionalManifestEntries: [{ url: companyLogoUrl, revision: companyLogoRevision }],
        globPatterns: ['**/*.{js,css,woff2,png,ico}', '_shell.html'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Only the NetworkFirst rule handles navigations; its fallback is the anonymous shell.
        navigateFallback: null,
        runtimeCaching: [
          { urlPattern: ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin && !url.pathname.startsWith('/~oauth') && !url.pathname.startsWith('/api/'), handler: 'NetworkFirst', options: { cacheName: 'fe-navigation', networkTimeoutSeconds: 3, precacheFallback: { fallbackURL: '/_shell.html' }, plugins: [{ cacheWillUpdate: async () => null }] } },
          { urlPattern: ({ url }) => url.origin === self.location.origin && /\/assets\/.*-[A-Za-z0-9_-]{6,}\.(js|css|woff2)$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'fe-assets', expiration: { maxEntries: 250 } } },
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'fe-fonts', expiration: { maxEntries: 30 } } },
        ],
      },
    }), {
      name: 'fe-pwa-after-prerender',
      apply: 'build',
      enforce: 'post',
      buildApp: { order: 'post', async handler(builder) {
        const plugin = builder.config.plugins.find(p => p.name === 'vite-plugin-pwa');
        const api = plugin?.api as VitePluginPWAAPI | undefined;
        // Preview development builds may intentionally omit all prerendered pages.
        if (!existsSync(`${clientDir}/_shell.html`) && builder.config.mode === 'development') return;
        if (!existsSync(`${clientDir}/_shell.html`)) throw new Error('Offline anonymous shell was not generated');
        if (api) await api.generateSW();
      } },
    }],
  },
  tanstackStart: {
    spa: { enabled: true, maskPath: '/auth', prerender: { outputPath: '/_shell' } },
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
