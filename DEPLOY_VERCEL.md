# Deploying FE MANAGEMENT on Vercel

1. Import this repository in Vercel. `vercel.json` already sets install/build commands and the `.vercel/output` folder (Vercel Build Output API, produced by Nitro's `vercel` preset).
2. Project Settings → Environment Variables (Production + Preview):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (same values as above)
   - `SUPABASE_SERVICE_ROLE_KEY` — only needed for the admin "reset SR password" feature; not available from Lovable Cloud, so that feature stays unavailable on Vercel.
3. Add your Vercel domain to the backend's allowed auth redirect URLs.
4. Deploy. Offline mode (service worker + `/_shell.html`) is generated automatically.

## Company logo

The company logo uses the public, CORS-enabled absolute Lovable asset URL shared in `src/lib/company-brand.ts`. Vercel does not serve the relative `/__l5e/assets-v1/` gateway. No rewrite or secret is needed; pages, PDF/Excel exports and offline precaching use the same image. Favicon and installed-app icons remain local files in `public/`. Redeploy after pulling this fix; offline branding updates when the generated worker updates online.
