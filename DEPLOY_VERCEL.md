# Deploying FE MANAGEMENT on Vercel

1. Import this repository in Vercel. `vercel.json` already sets install/build commands and the `.vercel/output` folder (Vercel Build Output API, produced by Nitro's `vercel` preset).
2. Project Settings → Environment Variables (Production + Preview):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (same values as above)
   - `SUPABASE_SERVICE_ROLE_KEY` — only needed for the admin "reset SR password" feature; not available from Lovable Cloud, so that feature stays unavailable on Vercel.
3. Add your Vercel domain to the backend's allowed auth redirect URLs.
4. Deploy. Offline mode (service worker + `/_shell.html`) is generated automatically.
